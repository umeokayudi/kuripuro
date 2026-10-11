import { escapeHtml } from './escapeHtml.js'
import { PRINT_DOC_CSS } from './printDoc.js'
import { printIssuer } from './quoteIssuer.js'

// v1.0.21 · Contrato spot = 業務委託契約書. A spot job created in Jobs → New Job also stores a
// contract with the location (table spot_contracts). Admin keeps them in Contracts → Spot
// contracts, prints them and collects the location's signature.
// The standard articles live in spotContractArticles() below — change the wording there.
// The per-contract `terms` field holds only 特記事項 (special terms) on top of the articles.

export const SPOT_CONTRACT_STATUS = ['draft', 'signed', 'cancelled']
export const DEFAULT_PAYMENT_DAY = 10

export function emptySpotContractForm() {
  return { enabled: true, client_address: '', client_representative: '', contact_name: '', contact_phone: '', price: '', tax_rate: 10, price_includes_tax: true, payment_day: DEFAULT_PAYMENT_DAY, scope: '', terms: '' }
}

/** Company data of 甲 (the location) prefilled from the clients row. */
export function contractPrefillFromClient(client) {
  if (!client) return {}
  return {
    client_address: client.address || '',
    client_representative: client.manager_name || client.contact_person || client.contact_name || '',
    contact_name: client.contact_person || client.contact_name || client.manager_name || '',
    contact_phone: client.phone || client.manager_phone || '',
  }
}

const clampDay = v => Math.max(1, Math.min(31, parseInt(v, 10) || DEFAULT_PAYMENT_DAY))

/** Row for spot_contracts from the New Job form + the job just inserted. */
export function buildSpotContractRow({ contract, job, form, location, client, employee }) {
  return {
    job_id: job?.id || null,
    client_id: form.client_id || null,
    client_name: client?.company_name || '',
    client_address: (contract.client_address || '').trim() || client?.address || null,
    client_representative: (contract.client_representative || '').trim() || null,
    location_id: form.location_id || null,
    location_name: (location?.name || form.title || '').trim() || 'Spot',
    location_address: form.address || location?.address || '',
    contact_name: (contract.contact_name || '').trim() || null,
    contact_phone: (contract.contact_phone || '').trim() || null,
    service_type: job?.title || form.title || '',
    service_date: form.scheduled_date || null,
    service_time: form.scheduled_time || null,
    employee_id: form.employee_id || null,
    employee_name: employee?.full_name || '',
    price: parseFloat(contract.price) || parseFloat(form.value) || 0,
    tax_rate: parseInt(contract.tax_rate, 10) || 0,
    price_includes_tax: contract.price_includes_tax !== false,
    payment_day: clampDay(contract.payment_day),
    employee_pay: parseFloat(form.spot_value) || 0,
    scope: (contract.scope || '').trim() || form.description || form.checklist_template || null,
    terms: (contract.terms || '').trim() || null,
    status: 'draft',
  }
}

/** Tax-excluded subtotal, tax and total for a contract price. */
export function spotContractTotals(c) {
  const price = Number(c?.price || 0)
  const rate = Number(c?.tax_rate || 0) / 100
  if (c?.price_includes_tax !== false) {
    const subtotal = Math.round(price / (1 + rate))
    return { subtotal, tax: price - subtotal, total: price }
  }
  const tax = Math.round(price * rate)
  return { subtotal: price, tax, total: price + tax }
}

const yen = n => `${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`

/** The contract articles (第1条…). Edit the wording here; values come from the contract row. */
export function spotContractArticles(c, lang = 'ja') {
  const t = spotContractTotals(c)
  const day = clampDay(c?.payment_day)
  const when = [c?.service_date, c?.service_time].filter(Boolean).join(' ')
  const place = [c?.location_name, c?.location_address].filter(Boolean).join(lang === 'en' ? ', ' : '（') + (lang !== 'en' && c?.location_address ? '）' : '')
  if (lang === 'en') return [
    ['Purpose', 'The Client (Party A) entrusts KuriPuro (Party B) with the cleaning service set out in Article 2 (the "Service"), and Party B accepts it.'],
    ['Service', `Place: ${place || '—'}\nDate and time: ${when || '—'}\nService: ${c?.service_type || 'Spot cleaning'} (details under "Scope of work").`],
    ['Fee', `The fee for the Service is JPY ${yen(t.total)} (incl. consumption tax ${c?.tax_rate ?? 10}%; subtotal JPY ${yen(t.subtotal)}, tax JPY ${yen(t.tax)}).`],
    ['Payment', `Party B issues an invoice after completing the Service. Party A pays the fee by the ${day}th of the month following the month in which the Service was completed, by bank transfer to the account designated by Party B. Transfer fees are borne by Party A. If the due date falls on a bank holiday, payment is due on the preceding business day.`],
    ['Subcontracting', 'Party B does not subcontract the Service to a third party without Party A\'s prior consent. Performance by Party B\'s own employees and registered staff is not subcontracting.'],
    ['Access and keys', 'Party A provides the entry method, keys and use of facilities needed for the Service. Party B manages them with the care of a prudent manager and returns them after the Service.'],
    ['Changes and cancellation', 'If Party A wishes to change the date or cancel the Service, Party A notifies Party B by the day before the service date.'],
    ['Damages', 'If Party B causes damage to Party A intentionally or through negligence in performing the Service, Party B compensates for that damage.'],
    ['Confidentiality', 'Each party keeps confidential any information about the other party learned in connection with this contract and does not disclose it to third parties. This article survives termination.'],
    ['Exclusion of antisocial forces', 'Each party represents and warrants that it is not, and is not related to, an antisocial force. If this is breached, the other party may terminate this contract immediately without notice.'],
    ['Term', 'This contract applies to the single Service on the date above and ends when the fee has been paid.'],
    ['Consultation', 'Matters not set out in this contract, or doubts about its interpretation, are resolved by good-faith consultation between the parties.'],
  ]
  return [
    ['目的', '甲は、乙に対し、第2条に定める清掃業務（以下「本業務」という。）を委託し、乙はこれを受託する。'],
    ['業務内容', `作業場所：${place || '—'}\n作業日時：${when || '—'}\n作業内容：${c?.service_type || 'スポット清掃'}（詳細は別記「作業範囲」のとおり）`],
    ['委託料', `本業務の委託料は、金${yen(t.total)}円（消費税${c?.tax_rate ?? 10}%込、税抜金額${yen(t.subtotal)}円、消費税額${yen(t.tax)}円）とする。`],
    ['支払方法', `乙は本業務の完了後に請求書を発行し、甲は、本業務完了日の属する月の翌月${day}日までに、乙の指定する銀行口座へ振り込む方法により委託料を支払う。振込手数料は甲の負担とする。支払期日が金融機関の休業日にあたる場合は、その前営業日までに支払う。`],
    ['再委託', '乙は、甲の事前の承諾なく本業務を第三者に再委託しない。ただし、乙の従業員および登録スタッフによる実施はこの限りでない。'],
    ['入館・鍵の管理', '甲は、本業務に必要な入館方法、鍵および設備の使用を乙に提供し、乙はこれらを善良な管理者の注意をもって管理し、本業務終了後に返還する。'],
    ['日程変更・中止', '甲が作業日の変更または本業務の中止を希望する場合は、作業日の前日までに乙に連絡する。'],
    ['損害賠償', '乙は、本業務の遂行にあたり、乙の故意または過失により甲に損害を与えた場合、その損害を賠償する。'],
    ['秘密保持', '甲および乙は、本契約に関して知り得た相手方の秘密情報を、第三者に開示または漏えいしない。本条は本契約終了後も有効とする。'],
    ['反社会的勢力の排除', '甲および乙は、自らが暴力団その他の反社会的勢力に該当せず、これらと関係を有しないことを表明し、保証する。相手方がこれに違反した場合、何らの催告なく直ちに本契約を解除することができる。'],
    ['有効期間', '本契約は、前記作業日における本業務1回について適用し、委託料の支払完了をもって終了する。'],
    ['協議', '本契約に定めのない事項または本契約の解釈に疑義が生じた事項については、甲乙誠実に協議のうえ解決する。'],
  ]
}

const COPY = {
  ja: { lang: 'ja', title: '業務委託契約書', no: '契約番号', a: '甲（委託者）', b: '乙（受託者）', address: '住所', company: '会社名', store: '店舗名', rep: '代表者', contact: 'ご担当', phone: '電話', email: 'メール', reg: '登録番号', staff: '担当スタッフ', sign: '署名', seal: '印', scope: '別記　作業範囲', special: '特記事項', signedOn: '契約締結日', blankDate: '　　　　年　　月　　日', signed: '署名済', cancelled: '取消', art: n => `第${n}条`, intro: (a, b) => `${a}（以下「甲」という。）と${b}（以下「乙」という。）は、次のとおり業務委託契約（以下「本契約」という。）を締結する。`, closing: '本契約締結の証として本書を作成し、甲乙署名または記名押印のうえ、各自1通（電子データを含む）を保有する。' },
  en: { lang: 'en', title: 'SERVICE OUTSOURCING CONTRACT', no: 'Contract No.', a: 'Party A (Client)', b: 'Party B (Contractor)', address: 'Address', company: 'Company', store: 'Store', rep: 'Representative', contact: 'Contact', phone: 'Phone', email: 'Email', reg: 'Reg. No.', staff: 'Assigned staff', sign: 'Signature', seal: 'Seal', scope: 'Appendix: scope of work', special: 'Special terms', signedOn: 'Date of contract', blankDate: '____ / ____ / ____', signed: 'SIGNED', cancelled: 'CANCELLED', art: n => `Article ${n}`, intro: (a, b) => `${a} ("Party A") and ${b} ("Party B") enter into this service outsourcing contract (this "Contract") as follows.`, closing: 'In witness of this Contract, the parties sign (or sign and seal) it and each keeps one copy, including electronic copies.' },
}

const multiline = text => escapeHtml(text || '').replace(/\n/g, '<br>')

/** Printable 業務委託契約書 for one spot contract (A4). */
export function spotContractHtml(c, lang = 'ja', signatureSrc = '') {
  const L = COPY[lang === 'en' ? 'en' : 'ja']
  const issuer = printIssuer({}, L.lang)
  const stamp = c.status === 'signed' ? L.signed : c.status === 'cancelled' ? L.cancelled : ''
  const partyA = c.client_name || c.location_name || ''
  const partyB = issuer.company
  const articles = spotContractArticles(c, L.lang)
  const signedDate = c.signed_at ? new Date(c.signed_at).toLocaleDateString(L.lang === 'ja' ? 'ja-JP' : 'en-CA', { timeZone: 'Asia/Tokyo' }) : L.blankDate
  const line = (k, v) => `<div class="pl"><span>${escapeHtml(k)}</span><div>${v ? escapeHtml(v) : '&nbsp;'}</div></div>`
  return `<!DOCTYPE html>
<html lang="${L.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(L.title)} ${escapeHtml(c.contract_number || '')}</title>
<style>${PRINT_DOC_CSS}
  .ttl{text-align:center;font-size:24px;font-weight:800;letter-spacing:${L.lang === 'ja' ? '0.35em' : '0.08em'};margin:6px 0 4px}
  .cno{text-align:right;font-size:11px;color:#5c6573;margin-bottom:14px}
  .intro{font-size:13px;line-height:1.9;margin:0 0 12px}
  .art{margin:0 0 9px;font-size:13px;line-height:1.85;break-inside:avoid}
  .art b{display:block;font-size:13px}
  .box{border:1px solid #e6ebf2;border-radius:6px;padding:9px 12px;font-size:12.5px;line-height:1.8;margin-top:4px}
  .closing{font-size:13px;line-height:1.9;margin:16px 0 6px}
  .date{font-size:13px;margin:0 0 14px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;break-inside:avoid}
  .party-box{border:1px solid #122033;border-radius:6px;padding:10px 12px;font-size:12px;position:relative}
  .party-box h4{margin:0 0 6px;font-size:13px}
  .pl{display:grid;grid-template-columns:5.2rem minmax(0,1fr);gap:2px 8px;padding:3px 0;border-bottom:1px dotted #cfd8e6}
  .pl span{color:#5c6573}
  .sig{display:flex;align-items:flex-end;gap:10px;margin-top:8px;min-height:64px}
  .sig .ink{flex:1;border-bottom:1px solid #122033;min-height:60px;display:flex;align-items:flex-end}
  .sig img{max-height:58px;max-width:100%}
  .seal{width:54px;height:54px;border:1px dashed #9aa6b8;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#9aa6b8;font-size:12px;flex-shrink:0}
  @media screen and (max-width:720px){.parties{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">
  ${stamp ? `<div class="stamp">${escapeHtml(stamp)}</div>` : ''}
  <div class="ttl">${escapeHtml(L.title)}</div>
  <div class="cno">${escapeHtml(L.no)} ${escapeHtml(c.contract_number || '')}</div>
  <p class="intro">${escapeHtml(L.intro(partyA, partyB))}</p>
  ${articles.map(([head, body], i) => `<div class="art"><b>${escapeHtml(L.art(i + 1))}${L.lang === 'ja' ? `（${escapeHtml(head)}）` : ` — ${escapeHtml(head)}`}</b>${multiline(body)}</div>`).join('')}
  ${c.scope ? `<div class="art"><b>${escapeHtml(L.scope)}</b><div class="box">${multiline(c.scope)}</div></div>` : ''}
  ${c.terms ? `<div class="art"><b>${escapeHtml(L.special)}</b><div class="box">${multiline(c.terms)}</div></div>` : ''}
  <p class="closing">${escapeHtml(L.closing)}</p>
  <p class="date">${escapeHtml(L.signedOn)}${L.lang === 'ja' ? '：' : ': '}${escapeHtml(signedDate)}</p>
  <div class="parties">
    <div class="party-box"><h4>${escapeHtml(L.a)}</h4>
      ${line(L.address, c.client_address || c.location_address)}
      ${line(L.company, c.client_name)}
      ${line(L.store, c.location_name)}
      ${line(L.rep, c.client_representative)}
      ${line(L.contact, c.contact_name)}
      ${line(L.phone, c.contact_phone)}
      <div class="sig"><div class="ink">${signatureSrc ? `<img src="${escapeHtml(signatureSrc)}" alt="">` : ''}</div><div class="seal">${escapeHtml(L.seal)}</div></div>
      ${c.signed_by ? `<div class="muted" style="margin-top:4px">${escapeHtml(L.sign)}${L.lang === 'ja' ? '：' : ': '}${escapeHtml(c.signed_by)}</div>` : ''}
    </div>
    <div class="party-box"><h4>${escapeHtml(L.b)}</h4>
      ${line(L.address, issuer.address)}
      ${line(L.company, issuer.company)}
      ${line(L.rep, `${issuer.title} ${issuer.name}`)}
      ${line(L.reg, issuer.regNumber)}
      ${line(L.phone, issuer.phone)}
      ${line(L.email, issuer.email)}
      ${line(L.staff, c.employee_name)}
      <div class="sig"><div class="ink"></div><div class="seal">${escapeHtml(L.seal)}</div></div>
    </div>
  </div>
</div></body></html>`
}
