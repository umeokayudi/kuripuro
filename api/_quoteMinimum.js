import { createHmac, timingSafeEqual } from 'node:crypto'
import { geminiGenerate } from './_gemini.js'

// v1.0.77 · Minimum company price for a quote the seller sends straight to the client.
// The AI reads the company's own price history (company prices of past client quotes,
// spot contracts, the store's monthly contract) and the store size, and answers one number.
// The seller can only send at or above it; what they add on top is their commission.
// The number travels back to the browser signed, so the send cannot lower it (no new SQL).

const TTL_MS = 6 * 60 * 60 * 1000
const FLOOR = 5000
const FALLBACK = 30000

function secret() {
  const value = process.env.SALES_SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SALES_SESSION_SECRET deve ter pelo menos 32 caracteres.')
  return value
}
const mac = text => createHmac('sha256', secret()).update(`quote-min:${text}`).digest('base64url')

export function signMinimum(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TTL_MS })).toString('base64url')
  return `${body}.${mac(body)}`
}

/** The signed payload, or null when it was changed, is from someone else or expired. */
export function readMinimum(token, userId) {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) return null
  const want = Buffer.from(mac(body))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (payload.uid !== userId || !(payload.exp > Date.now()) || !(Number(payload.min) > 0)) return null
    return payload
  } catch {
    return null
  }
}

const storeBase = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim().toLowerCase()
const words = text => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3)
const median = list => {
  const s = list.filter(n => n > 0).sort((a, b) => a - b)
  if (!s.length) return 0
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const roundUp = n => Math.ceil(n / 1000) * 1000

/** Past prices the company charged, closest to this job first. */
async function priceHistory(db, { clientId, locationName, category, description }) {
  const [reqRes, spotRes, contractRes, modelRes] = await Promise.all([
    db.from('client_requests').select('category,description,location_name,base_amount,quote_amount,quote_status').eq('request_type', 'quote').not('base_amount', 'is', null).order('created_at', { ascending: false }).limit(200),
    db.from('spot_contracts').select('service_type,scope,location_name,price,service_date').gt('price', 0).order('service_date', { ascending: false }).limit(200),
    clientId ? db.from('service_contracts').select('location_name,service_type,price_per_visit,monthly_revenue,visits_per_month,hours_per_visit,is_active').eq('client_id', clientId) : { data: [] },
    clientId ? db.from('facility_models').select('location_name,layout').eq('client_id', clientId) : { data: [] },
  ])
  const key = new Set(words(`${category} ${description}`))
  const similar = text => words(text).some(w => key.has(w))
  const companyQuotes = (reqRes.data || []).map(r => ({ what: r.category || r.description, where: r.location_name, company_price: Number(r.base_amount) }))
  const spots = (spotRes.data || []).map(r => ({ what: r.service_type || r.scope, where: r.location_name, price: Number(r.price) }))
  const store = storeBase(locationName)
  const contracts = (contractRes.data || []).filter(c => !store || storeBase(c.location_name) === store)
  const model = (modelRes.data || []).find(m => !store || storeBase(m.location_name) === store)
  const layout = model?.layout
  const size = layout?.width && layout?.depth ? { width_m: layout.width, depth_m: layout.depth, m2: Math.round(layout.width * layout.depth * 10) / 10 } : null
  const counts = {}
  for (const el of layout?.elements || []) counts[el.kind] = (counts[el.kind] || 0) + 1
  const similarPrices = [
    ...companyQuotes.filter(q => similar(q.what)).map(q => q.company_price),
    ...spots.filter(s => similar(s.what)).map(s => s.price),
  ]
  return {
    companyQuotes: companyQuotes.slice(0, 40),
    spots: spots.slice(0, 40),
    contracts,
    size,
    equipment: counts,
    similarMedian: median(similarPrices),
    similarCount: similarPrices.length,
    anyMedian: median([...companyQuotes.map(q => q.company_price), ...spots.map(s => s.price)]),
  }
}

/** { min, reason, basis } — never throws; without the AI it uses the price history. */
export async function estimateMinimum(db, job) {
  const h = await priceHistory(db, job).catch(() => null)
  const fromHistory = h?.similarMedian || h?.anyMedian || FALLBACK
  const plain = {
    min: Math.max(FLOOR, roundUp(fromHistory)),
    reason: h?.similarCount
      ? `Mediana de ${h.similarCount} preço(s) da empresa para serviço parecido.`
      : h?.anyMedian ? 'Sem serviço parecido no histórico: mediana dos preços da empresa.' : 'Sem histórico de preços: valor padrão.',
    basis: 'history',
  }
  if (!h) return plain
  try {
    const result = await geminiGenerate({
      contents: [{ role: 'user', parts: [{ text: `You price professional cleaning jobs for a Japanese cleaning company (Tokyo, yen, tax excluded).
Give the MINIMUM price the company accepts for the job below: it must cover labour, chemicals, travel and a healthy margin. Base it on the company's own past prices; adjust for the store size and how many units of the equipment there are. Never go below past company prices for the same kind of job unless the job is clearly smaller.
Answer JSON only: {"min_price": integer yen, "reason": "one short sentence in Portuguese explaining the number"}.
JOB: ${JSON.stringify({ service: job.category, description: job.description, store: job.locationName, store_size: h.size, equipment_in_store: h.equipment })}
STORE CONTRACTS: ${JSON.stringify(h.contracts)}
PAST COMPANY PRICES OF CLIENT QUOTES: ${JSON.stringify(h.companyQuotes)}
PAST SPOT JOBS: ${JSON.stringify(h.spots)}
MEDIAN OF SIMILAR JOBS: ${h.similarMedian || 'none'}` }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2000, responseMimeType: 'application/json' },
    }, { timeoutMs: 15000 })
    const text = result?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    let min = Number(parsed.min_price)
    if (!Number.isFinite(min) || min <= 0) return plain
    // the AI may not undercut what the company itself charged for the same kind of job by much
    if (h.similarMedian) min = Math.max(min, h.similarMedian * 0.8)
    return { min: Math.max(FLOOR, roundUp(min)), reason: String(parsed.reason || '').slice(0, 300) || plain.reason, basis: 'ai' }
  } catch (error) {
    console.error('[quote-minimum]', error?.message || error)
    return plain
  }
}
