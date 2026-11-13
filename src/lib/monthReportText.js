// v1.0.247 · Client monthly report — text safety + the facts the AI may use. PURE and import-free on
// purpose: the browser (preview/PDF) and the server (api/_month-report-ai.js) share this file.
//
// Hard rules (owner, 13/11/2026):
//   · never an end time, a duration or hours worked — in any text (PDF, screen, AI);
//   · never a value (what the client pays / what the employee earns);
//   · AI texts come ONLY from the real service data; when a fact is missing the text stays short.

// Sentences that could reveal hours worked, end time or money are dropped from client texts.
const RISKY = /(\d+(?:[.,]\d+)?\s*(?:時間|分間?|h(?:rs?|ours?)?\b|horas?\b|minutos?\b|minutes?\b|min\b))|[¥￥$]|円|\bR\$|\d{1,2}[:：]\d{2}\s*[〜~～\-–—]\s*\d{1,2}[:：]\d{2}|終了|作業時間|所要|duração|término|end time|finished at|terminou|料金|金額|valor|preço|price|給料|salário|pay\b/i
// AI / edited texts: also no clock time at all, no "hours" even without a number, no cost words.
const RISKY_AI = /\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*時(?!間)|\d\s*(?:a\.?m\.?|p\.?m\.?)\b|午前|午後|\bhours?\b|\bhoras?\b|\bminutes?\b|\bminutos?\b|長時間|短時間|時間をかけ|時間内|duration|durou|levou\s+\d|took\s+\d|\byen\b|\bcusto|\bcost|費用|請求|見積|invoice|fatura|orçamento/i

function splitSentences(s) {
  // a "." splits only when a space or the end follows (so "¥30.000" or "1.5" stay in one sentence)
  return s.split(/(?<=[。．!?！？\n])\s*|(?<=\.)(?:\s+|$)/).map(p => p.trim()).filter(Boolean)
}

/** Client-safe notes: removes any sentence with times, durations or money. Returns { text, removed }. */
export function safeNotes(raw) {
  const s = String(raw || '').replace(/\r/g, '').trim()
  if (!s) return { text: '', removed: 0 }
  const parts = splitSentences(s)
  const keep = parts.filter(p => !RISKY.test(p))
  return { text: keep.join(' ').replace(/\s+\n/g, '\n').trim(), removed: parts.length - keep.length }
}

/**
 * AI or admin-edited text → what may go to the client. Strips markdown, then drops every sentence
 * with a clock time, hours/minutes, duration or money. Returns { text, removed }.
 */
export function safeAiText(raw, max = 1600) {
  const s = String(raw || '').replace(/\r/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•・]\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (!s) return { text: '', removed: 0 }
  const lines = s.split(/\n+/)
  let removed = 0
  const out = lines.map(line => {
    const parts = splitSentences(line)
    const keep = parts.filter(p => !RISKY.test(p) && !RISKY_AI.test(p))
    removed += parts.length - keep.length
    return keep.join(line.match(/[。．]/) ? '' : ' ')
  }).filter(Boolean)
  return { text: out.join('\n').slice(0, max).trim(), removed }
}

/** True when a text would lose a sentence to the rules (used by tests and the editor warning). */
export const textBreaksRules = raw => safeAiText(raw).removed > 0

/**
 * General purpose of each kind of deep-cleaning task — the ONLY "why" the AI may give (and the
 * fallback texts use). It is the reason the service exists, never a claim about the visit.
 */
export const TASK_PURPOSE = {
  range_hood: {
    en: 'removes the grease that builds up in the hood, filters and duct, keeping the exhaust working well and lowering the fire risk',
    ja: 'フード・フィルター・ダクトに蓄積する油汚れを取り除き、排気性能の維持と火災リスクの低減を図るため',
    pt: 'retira a gordura acumulada na coifa, nos filtros e no duto, mantendo a exaustão eficiente e reduzindo o risco de incêndio',
  },
  grease_trap: {
    en: 'keeps the drainage flowing and prevents clogs, bad smells and pests',
    ja: '排水の流れを保ち、詰まり・悪臭・害虫の発生を防ぐため',
    pt: 'mantém o escoamento livre e evita entupimento, mau cheiro e pragas',
  },
  grating: {
    en: 'removes grease from the floor gratings, preventing slips and smells',
    ja: '床のグレーチングの油汚れを除去し、転倒や悪臭を防ぐため',
    pt: 'retira a gordura das grelhas do piso, evitando escorregões e mau cheiro',
  },
  stove: {
    en: 'removes burnt-on grease from the burners, for hygiene and safe use',
    ja: 'コンロ周りの焦げ付き・油汚れを除去し、衛生と安全な使用のため',
    pt: 'retira a gordura queimada do fogão, para higiene e uso seguro',
  },
  ac: {
    en: 'cleans the filters and indoor unit, keeping the air clean and the air conditioner efficient',
    ja: 'フィルターと室内機を清掃し、空気の清浄さと空調効率を保つため',
    pt: 'limpa os filtros e a unidade interna, mantendo o ar limpo e o ar-condicionado eficiente',
  },
  fryer: {
    en: 'removes old oil and residue from the fryer, for food quality and safety',
    ja: 'フライヤーの古い油と汚れを除去し、調理品質と安全を保つため',
    pt: 'retira o óleo velho e os resíduos da fritadeira, pela qualidade e segurança',
  },
  kitchen_equipment: {
    en: 'removes grease from tables, shelves and kitchen equipment, for hygiene',
    ja: '作業台・棚・厨房機器の油汚れを除去し、衛生を保つため',
    pt: 'retira a gordura de mesas, prateleiras e equipamentos, pela higiene',
  },
  fridge: { en: 'keeps the refrigerator hygienic inside and out', ja: '冷蔵庫の内外を衛生的に保つため', pt: 'mantém a geladeira higienizada por dentro e por fora' },
  walls: { en: 'removes grease from walls and tile joints', ja: '壁面・目地の油汚れを除去するため', pt: 'retira a gordura das paredes e do rejunte' },
  floor_scrub: { en: 'removes ingrained dirt from the floor, corners and under the equipment, preventing slips', ja: '床・隅・機器下の汚れを除去し、転倒を防ぐため', pt: 'retira a sujeira incrustada do piso, cantos e debaixo dos equipamentos, evitando escorregões' },
  floor_wax: { en: 'protects the floor surface and keeps it easy to clean', ja: '床面を保護し、日常清掃をしやすくするため', pt: 'protege o piso e facilita a limpeza do dia a dia' },
  drains: { en: 'keeps the drains flowing and odour-free', ja: '排水溝の流れを保ち、臭いを防ぐため', pt: 'mantém os ralos livres e sem cheiro' },
  restroom: { en: 'keeps the restroom hygienic for customers and staff', ja: 'お客様とスタッフのためにトイレを衛生的に保つため', pt: 'mantém o banheiro higienizado para clientes e equipe' },
  windows: { en: 'leaves the glass clean, inside and out', ja: 'ガラスを内外ともきれいに保つため', pt: 'deixa os vidros limpos por dentro e por fora' },
  ceiling: { en: 'removes dust and grease from the ceiling, lights and air outlets', ja: '天井・照明・吹出口のほこりと油汚れを除去するため', pt: 'retira poeira e gordura do teto, luminárias e saídas de ar' },
  seats: { en: 'keeps seats and sofas clean for customers', ja: 'お客様が使う椅子・ソファを清潔に保つため', pt: 'mantém cadeiras e sofás limpos para os clientes' },
}

/** Picks the visit/intro/closing texts: admin edit > AI > automatic, always passed through the rules. */
export function resolveTexts({ auto = {}, ai = {}, edits = {} } = {}) {
  const pick = (key, a, b, c) => {
    if (typeof c === 'string') return { ...safeAiText(c), source: 'edited' }
    if (typeof b === 'string' && b.trim()) {
      const s = safeAiText(b)
      if (s.text) return { ...s, source: 'ai' }
    }
    return { ...safeAiText(a || ''), source: 'auto', key }
  }
  const visits = {}
  const ids = new Set([...Object.keys(auto.visits || {}), ...Object.keys(ai.visits || {})])
  for (const id of ids) {
    if (!(id in (auto.visits || {}))) continue // AI text of a visit that is not in the report: ignored
    visits[id] = pick(id, auto.visits[id], ai.visits?.[id], edits.visits?.[id])
  }
  return {
    intro: pick('intro', auto.intro, ai.intro, edits.intro),
    closing: pick('closing', auto.closing, ai.closing, edits.closing),
    visits,
  }
}
