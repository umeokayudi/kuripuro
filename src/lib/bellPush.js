// v1.0.171 · One bell item → one push notification: short title (what happened), clean body
// (where · who · when) and the screen that resolves it. lang = 'pt' | 'en' | 'ja'.
import { exceptionInfo } from './exceptionText.js'

const L3 = lang => (en, ja, pt) => (lang === 'ja' ? ja : lang === 'pt' ? pt : en)

const dm = d => (d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')
const yen = v => (v ? `¥${Math.round(Number(v)).toLocaleString('ja-JP')}` : '')
const clean = (s, n = 110) => {
  const t = String(s || '').replace(/#job:\S+/g, '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const join = (...parts) => parts.filter(Boolean).join(' · ')
const job = x => clean(String(x.title || '').split(' — ')[0], 50)

// Kinds already pushed at once by the database triggers (no second notice from the bell).
export const BELL_SKIP_KINDS = new Set(['dayoff', 'quote'])
// Items in these groups are not the admin's to do right now.
export const BELL_SKIP_GROUPS = new Set(['waiting', 'later'])

/** { title, body, url, tag } for one bell item. */
export function bellNotice(x, lang = 'pt') {
  const L = L3(lang)
  const EXC = exceptionInfo(L)
  const when = x.date ? dm(String(x.date)) : ''
  const base = { tag: `bell-${x.id}`, url: '/?bell=1' }
  switch (x.kind) {
    case 'late': return { ...base, title: `⏰ ${L('Late', '遅れ', 'Atrasado')} · ${x.place || x.who || ''}`.trim(), body: join(EXC.late.title(x).replace(/^[^:]+:\s*/, ''), job(x), x.who), url: '/live' }
    case 'route': return { ...base, title: `🌙 ${x.startedAt ? L('Route started late', 'ルート開始が遅れました', 'Rota começou atrasada') : L('Route not started', 'ルート未開始', 'Rota não começou')}`, body: join('On The Planet', x.who || x.employeeName, x.startedAt ? L(`started ${x.startedAt}`, `${x.startedAt}開始`, `começou ${x.startedAt}`) : L('deadline 10:00', '期限10:00', 'prazo 10:00')), url: '/live' }
    case 'route_none': return { ...base, title: `🌙 ${L("Today's route has not started", '本日のルート未開始', 'Rota de hoje ainda não começou')}`, body: join(when, x.n ? L(`${x.n} services`, `${x.n}件`, `${x.n} serviços`) : '', L('nothing started', '未着手', 'nada iniciado')), url: '/live' }
    case 'free_uncovered': return { ...base, title: `⚠️ ${L('No cover', '担当不在', 'Sem cobertura')} · ${x.place || ''}`.trim(), body: join(job(x), when, L('nobody took it', '誰も取っていません', 'ninguém pegou')), url: '/schedule' }
    case 'eve_unconfirmed': return { ...base, title: `❔ ${L('No confirmation for tomorrow', '明日 未確認', 'Sem confirmação para amanhã')}`, body: join(x.who, when), url: '/' }
    case 'impossible': return { ...base, title: `⏱ ${L('Impossible route', '不可能なルート', 'Rota impossível')} · ${x.who || ''}`.trim(), body: join(when, x.n ? L(`${x.n} services`, `${x.n}件`, `${x.n} serviços`) : '', x.deadline ? L(`deadline ${x.deadline}`, `期限${x.deadline}`, `prazo ${x.deadline}`) : ''), url: '/schedule' }
    case 'cant': return { ...base, title: `✕ ${L("Can't work", '勤務不可', 'Não pode trabalhar')} · ${x.who || ''}`.trim(), body: join(when, (x.stores || []).join(', ')), url: '/live' }
    case 'no_person': return { ...base, title: `⚠️ ${L('Nobody assigned', '担当なし', 'Sem pessoa')} · ${x.place || ''}`.trim(), body: join(job(x), when, x.time), url: '/schedule' }
    case 'no_job': return { ...base, title: `📋 ${L('No job created', '作業未作成', 'Sem serviço criado')} · ${x.place || ''}`.trim(), body: join(L('contract day', '契約日', 'dia de contrato'), when, x.who ? L(`usually ${x.who}`, `通常 ${x.who}`, `costuma ser ${x.who}`) : ''), url: '/schedule' }
    case 'covered': return { ...base, title: `🔁 ${L('Covered by someone else', '他の人が実施', 'Coberto por outra pessoa')} · ${x.place || ''}`.trim(), body: join(L(`Done by ${x.by}`, `${x.by}が実施`, `Feito por ${x.by}`), L(`remove from ${x.who}?`, `${x.who}から外しますか？`, `retirar de ${x.who}?`), when) }
    case 'to_book': return { ...base, title: `📅 ${L('Quote accepted · book the date', '見積承認・日程を決めてください', 'Orçamento aceito · marque a data')}`, body: join(x.name, x.what, yen(x.total)), url: `/mitsumori?track=${x.ref || x.ref_id || ''}` }
    case 'flow_done': return { ...base, title: `🧾 ${L('Job done · invoice sent', '作業完了・請求書を送付', 'Serviço feito · nota enviada')}`, body: join(x.name, yen(x.total)), url: `/mitsumori?track=${x.ref || x.ref_id || ''}` }
    case 'payroll': return { ...base, title: `💴 ${L('Payroll closed automatically', '給与を自動で締めました', 'Folha fechada automaticamente')}`, body: join(x.period, L('check the payslips', '明細を確認してください', 'confira os holerites')), url: `/salary-periods?period=${x.period || ''}` }
    case 'offer': return { ...base, title: `🧽 ${L('Service to offer', '提案できる作業', 'Serviço para oferecer')}`, body: join(x.task_name, x.client_name || x.location, x.element_name), url: x.model_id ? `/facility?model=${x.model_id}` : '/?bell=1' }
    case 'taken': return { ...base, title: `⚡ ${L('Urgent job taken', '緊急作業が受注されました', 'Serviço urgente aceito')}`, body: join(job(x), x.who, when, x.time) }
    default: {
      const info = EXC[x.kind]
      if (!info) return { ...base, title: '🔔 KuriPuro', body: join(x.place, x.who, when) }
      if (x.group) return { ...base, title: `${info.icon} ${info.title({ ...x, minutes: 0, expected: 0, period: '' }).replace(/\s*\(.*\)$/, '')}`, body: L(`${x.items?.length || ''} items to review`, `${x.items?.length || ''}件 確認待ち`, `${x.items?.length || ''} itens para revisar`), url: '/?bell=1' }
      return { ...base, title: `${info.icon} ${clean(info.title(x), 60)}`, body: join(x.place, job(x), x.who, when), url: info.to?.(x) || '/?bell=1' }
    }
  }
}

/** Several new items at once (first run, schedule generator…) → one summary notice. */
export function bellSummary(items, lang = 'pt') {
  const L = L3(lang)
  const n = items.length
  const first = items.slice(0, 3).map(x => bellNotice(x, lang).title.replace(/^\S+\s/, '')).join(' · ')
  return { title: `🔔 ${L(`${n} new items waiting for you`, `新しい確認待ち ${n}件`, `${n} itens novos aguardando você`)}`, body: clean(first, 140), url: '/?bell=1', tag: 'bell-summary' }
}
