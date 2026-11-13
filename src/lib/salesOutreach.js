// v1.0.234 · Shared rules of the sales outreach (browser + server): what a target company is,
// how the call queue is ordered and what each one-tap call result does.

/** One tap after a call. `days` = when the company comes back to the queue (null = it does not). */
export const CALL_RESULTS = {
  no_answer: { tag: 'no_answer', sentiment: 'neutral', days: 2, pt: 'Não atendeu', en: 'No answer', ja: '不在' },
  call_later: { tag: 'timing', sentiment: 'neutral', days: 7, pt: 'Pediu para ligar depois', en: 'Call back later', ja: '後日かけ直し' },
  interested: { tag: 'interested', sentiment: 'positive', days: 1, promote: true, pt: 'Tem interesse', en: 'Interested', ja: '興味あり' },
  meeting: { tag: 'interested', sentiment: 'positive', days: 3, promote: true, pt: 'Reunião marcada', en: 'Meeting booked', ja: '面談予約' },
  asked_quote: { tag: 'asked_quote', sentiment: 'positive', days: 1, promote: true, pt: 'Pediu orçamento', en: 'Asked for a quote', ja: '見積依頼' },
  has_vendor: { tag: 'has_vendor', sentiment: 'neutral', days: 90, pt: 'Já tem fornecedor', en: 'Already has a vendor', ja: '他社利用中' },
  no_need: { tag: 'no_need', sentiment: 'negative', days: 180, pt: 'Sem interesse', en: 'Not interested', ja: '不要' },
}
export const CALL_RESULT_ORDER = ['no_answer', 'call_later', 'interested', 'meeting', 'asked_quote', 'has_vendor', 'no_need']

const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)

/**
 * Order of the day: promised call-backs first (the oldest promise on top), then companies already
 * in conversation, then interested ones, then the base never called. Returns the score and the
 * reason shown on the card.
 */
export function callPriority(row, today) {
  let score = 0
  let reason = 'base'
  const due = row.next_followup_date && row.next_followup_date <= today
  if (due) { score += 100 + Math.min(30, dayDiff(today, row.next_followup_date)); reason = dayDiff(today, row.next_followup_date) > 0 ? 'late' : 'due' }
  if (row.stage === 'negotiation') score += 40
  else if (row.stage === 'quote') score += 35
  else if (row.stage === 'followup') score += 25
  else if (row.stage === 'approach') score += 15
  if (/alta|high|hot|高/i.test(String(row.interest || ''))) score += 20
  if (!row.calls) { score += 10; if (!due && row.stage === 'target') reason = 'new' }
  else if (!due && row.last_call?.date) { score += Math.min(10, Math.max(0, dayDiff(today, row.last_call.date) / 7)); reason = 'again' }
  if (!due && row.stage !== 'target') reason = 'funnel'
  return { score: Math.round(score), reason }
}

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const digits = v => String(v || '').replace(/[^\d+]/g, '')

/** Same company twice = same name + same store (or same phone). */
export function targetKey(row) {
  const name = clean(row.company_name).toLowerCase().replace(/株式会社|有限会社|\(株\)|（株）|\s/g, '')
  const phone = digits(row.phone)
  return `${name}|${clean(row.site_name).toLowerCase()}|${phone.slice(-8)}`
}

export function normalizeTargetRow(input = {}) {
  const email = clean(input.email, 160).toLowerCase()
  return {
    company_name: clean(input.company_name), site_name: clean(input.site_name, 120) || null,
    phone: clean(input.phone, 40) || null, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    address: clean(input.address, 300) || null, industry: clean(input.industry, 80) || null, region: clean(input.region, 80) || null,
    website: clean(input.website, 300) || null, contact_name: clean(input.contact_name, 120) || null, notes: clean(input.notes, 1000) || null,
  }
}

const HEADERS = {
  company_name: /^(empresa|company|name|nome|会社|会社名|店名|店舗名|restaurante)$/i, site_name: /^(loja|site|store|店舗|支店)$/i,
  phone: /^(telefone|tel|phone|fone|電話|電話番号)$/i, email: /^(e-?mail|メール)$/i, address: /^(endere[cç]o|address|住所)$/i,
  industry: /^(ramo|segmento|industry|業種)$/i, region: /^(regi[aã]o|region|area|área|エリア|地域)$/i, website: /^(site web|website|url|web)$/i,
  contact_name: /^(contato|contact|respons[aá]vel|担当|担当者)$/i, notes: /^(obs|notas?|notes?|備考|メモ)$/i,
}

/**
 * Turns a pasted list into rows. Accepts a spreadsheet copy (tabs), CSV (comma or semicolon) with or
 * without a header line, or plain lines "Company, phone, e-mail, address".
 */
export function parseTargetText(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const sep = lines[0].includes('\t') ? '\t' : lines[0].split(';').length > lines[0].split(',').length ? ';' : ','
  const split = line => {
    if (sep === '\t') return line.split('\t').map(c => c.trim())
    const out = []; let cur = ''; let quoted = false
    for (const ch of line) {
      if (ch === '"') quoted = !quoted
      else if (ch === sep && !quoted) { out.push(cur.trim()); cur = '' } else cur += ch
    }
    out.push(cur.trim())
    return out
  }
  const first = split(lines[0])
  const map = first.map(h => Object.keys(HEADERS).find(k => HEADERS[k].test(h)) || null)
  const hasHeader = map.filter(Boolean).length >= 1 && map[0] === 'company_name'
  const rows = []
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = split(line)
    const row = {}
    if (hasHeader) map.forEach((k, i) => { if (k && cells[i]) row[k] = cells[i] })
    else {
      row.company_name = cells[0]
      for (const c of cells.slice(1)) {
        if (!c) continue
        if (!row.email && /@/.test(c)) row.email = c
        else if (!row.phone && /^[\d+()\-\s]{8,}$/.test(c)) row.phone = c
        else if (!row.website && /^https?:\/\//i.test(c)) row.website = c
        else if (!row.address) row.address = c
        else row.notes = row.notes ? `${row.notes} · ${c}` : c
      }
    }
    const n = normalizeTargetRow(row)
    if (n.company_name) rows.push(n)
  }
  return rows
}

/** {empresa} {contato} {vendedor} (and the Japanese / English names) inside subject and text. */
export function fillTemplate(text, lead = {}, user = {}) {
  const values = {
    empresa: lead.company_name || '', company: lead.company_name || '', 会社名: lead.company_name || '',
    contato: lead.contact_name || 'ご担当者', contact: lead.contact_name || 'ご担当者', 担当者: lead.contact_name || 'ご担当者',
    vendedor: user.name || '', seller: user.name || '', 営業担当: user.name || '',
    loja: lead.site_name || '', store: lead.site_name || '',
  }
  return String(text || '').replace(/\{([^{}]+)\}/g, (m, k) => (k.trim() in values ? values[k.trim()] : m))
}

export const EMAIL_TEMPLATES = {
  ja: {
    subject: '【KuriPuro】店舗清掃のご相談（15分のお打ち合わせのお願い）',
    body: `{会社名}\n{担当者} 様\n\n突然のご連絡失礼いたします。飲食店・店舗の清掃を専門に行っているKuriPuroの{営業担当}と申します。\n\n閉店後の日常清掃から、グリストラップ・エアコン・ダクトなどの定期清掃まで、写真付きの作業報告で毎回の仕上がりをご確認いただけます。\n\nもしよろしければ、15分ほどお時間をいただき、現在の清掃状況やお困りごとをお聞かせいただけないでしょうか。ご都合の良い日時を2〜3候補お知らせいただければ、こちらで調整いたします。\n\nどうぞよろしくお願いいたします。\n\n{営業担当}\nKuriPuro`,
  },
  pt: {
    subject: 'KuriPuro · limpeza do seu restaurante (15 minutos de conversa)',
    body: `Olá, {contato}.\n\nSou {vendedor}, da KuriPuro. Cuidamos da limpeza de restaurantes e lojas: a limpeza diária depois do fechamento e as limpezas periódicas (caixa de gordura, ar-condicionado, coifa), sempre com relatório e fotos de cada visita.\n\nPodemos conversar 15 minutos sobre como está a limpeza de {empresa} hoje? Se me passar dois ou três horários, eu me encaixo.\n\nObrigado,\n{vendedor}\nKuriPuro`,
  },
  en: {
    subject: 'KuriPuro · cleaning for your restaurant (a 15-minute talk)',
    body: `Hello {contact},\n\nI am {seller} from KuriPuro. We clean restaurants and shops: daily cleaning after closing and periodic deep cleaning (grease trap, air conditioning, hoods), always with a photo report of every visit.\n\nCould we talk for 15 minutes about how cleaning works at {company} today? Send me two or three times that suit you and I will fit in.\n\nThank you,\n{seller}\nKuriPuro`,
  },
}
