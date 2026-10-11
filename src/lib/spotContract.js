import { escapeHtml } from './escapeHtml.js'
import { PRINT_DOC_CSS, printIssuerHtml } from './printDoc.js'
import { printIssuer } from './quoteIssuer.js'

// v1.0.21 · Contrato spot: a spot job created in Jobs → New Job also stores a contract
// with the location (table spot_contracts). Admin keeps them in Contracts → Spot contracts,
// prints them (契約書) and collects the location's signature.

export const SPOT_CONTRACT_STATUS = ['draft', 'signed', 'cancelled']

export const DEFAULT_SPOT_TERMS = {
  ja: [
    '1. 作業内容：上記の作業日時・作業範囲に基づき、クリプロが清掃作業を1回行います。',
    '2. 料金：上記金額を作業完了後、請求書に基づきお支払いください。',
    '3. 日程変更・キャンセル：作業日の前日までにご連絡ください。',
    '4. 立入り・鍵：作業に必要な入館方法・鍵の受け渡しは事前に取り決めます。',
    '5. 損害：作業中に当社の過失により生じた損害は、誠意をもって協議・対応します。',
    '6. 本契約は今回のスポット作業1回に限り有効です。',
  ].join('\n'),
  en: [
    '1. Scope: KuriPuro performs one cleaning service at the date, time and scope stated above.',
    '2. Price: the amount above is paid after completion, based on the invoice.',
    '3. Changes / cancellation: please notify us by the day before the service.',
    '4. Access and keys: entry method and key handover are agreed in advance.',
    '5. Damage: any damage caused by our negligence during the work will be discussed and handled in good faith.',
    '6. This contract covers this single spot service only.',
  ].join('\n'),
}

export function emptySpotContractForm() {
  return { enabled: true, contact_name: '', contact_phone: '', price: '', tax_rate: 10, price_includes_tax: true, scope: '', terms: DEFAULT_SPOT_TERMS.ja }
}

/** Row for spot_contracts from the New Job form + the job just inserted. */
export function buildSpotContractRow({ contract, job, form, location, client, employee }) {
  return {
    job_id: job?.id || null,
    client_id: form.client_id || null,
    client_name: client?.company_name || '',
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
    employee_pay: parseFloat(form.spot_value) || 0,
    scope: (contract.scope || '').trim() || form.description || form.checklist_template || null,
    terms: (contract.terms || '').trim() || DEFAULT_SPOT_TERMS.ja,
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

const COPY = {
  ja: { lang: 'ja', title: '業務契約書', sub: 'スポット清掃', honorific: '御中', contact: 'ご担当', phone: '電話', no: '契約番号', date: '作業日', time: '開始時刻', worker: '担当スタッフ', type: '作業内容', scope: '作業範囲', terms: '契約条件', subtotal: '小計', tax: '消費税', total: '合計（税込）', signLocation: '甲（ご依頼者）署名', signUs: '乙（クリプロ）', signedAt: '署名日', signed: '署名済', cancelled: '取消', intro: '甲と乙は、下記スポット清掃作業について以下のとおり契約を締結します。', colon: '：' },
  en: { lang: 'en', title: 'SERVICE CONTRACT', sub: 'Spot cleaning', honorific: '', contact: 'Contact', phone: 'Phone', no: 'Contract No.', date: 'Service date', time: 'Start time', worker: 'Assigned staff', type: 'Service', scope: 'Scope of work', terms: 'Terms', subtotal: 'Subtotal', tax: 'Consumption tax', total: 'Total (incl. tax)', signLocation: 'Client signature', signUs: 'KuriPuro', signedAt: 'Signed on', signed: 'SIGNED', cancelled: 'CANCELLED', intro: 'The client and KuriPuro agree to the spot cleaning service below on the following terms.', colon: ': ' },
}

const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`
const multiline = text => escapeHtml(text || '').replace(/\n/g, '<br>')

/** Printable 契約書 for one spot contract (A4, same look as 見積書 / 請求書). */
export function spotContractHtml(c, lang = 'ja', signatureSrc = '') {
  const L = COPY[lang === 'en' ? 'en' : 'ja']
  const issuer = printIssuer({}, L.lang)
  const t = spotContractTotals(c)
  const stamp = c.status === 'signed' ? L.signed : c.status === 'cancelled' ? L.cancelled : ''
  const row = (k, v) => v ? `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(v)}</td></tr>` : ''
  const signedDate = c.signed_at ? new Date(c.signed_at).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : ''
  return `<!DOCTYPE html>
<html lang="${L.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(L.title)} ${escapeHtml(c.contract_number || '')}</title>
<style>${PRINT_DOC_CSS}
  .mast h1{letter-spacing:${L.lang === 'ja' ? '0.3em' : '0.1em'}}
  .sec{margin:18px 0 0}
  .sec h3{font-size:12px;letter-spacing:0.08em;color:#5c6573;margin:0 0 6px;font-weight:700}
  .box{border:1px solid #e6ebf2;border-radius:6px;padding:10px 12px;font-size:13px;line-height:1.8}
  .signs{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}
  .sign{border:1px solid #122033;border-radius:6px;padding:10px 12px;min-height:110px;font-size:12px}
  .sign img{max-width:100%;max-height:80px;display:block;margin-top:6px}
  .sign .who{font-weight:700;margin-top:4px}
  @media screen and (max-width:720px){.signs{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">
  ${stamp ? `<div class="stamp">${escapeHtml(stamp)}</div>` : ''}
  <div class="mast"><div class="muted">${escapeHtml(L.sub)}</div>
    <div style="text-align:right"><h1>${escapeHtml(L.title)}</h1><div class="no">${escapeHtml(L.no)} ${escapeHtml(c.contract_number || '')}</div></div>
  </div>
  <div class="rule"></div>
  <div class="top">
    <div class="party">
      <div class="party-name">${escapeHtml(c.location_name || '')}${L.honorific ? ` ${L.honorific}` : ''}</div>
      ${c.client_name && c.client_name !== c.location_name ? `<div class="party-co">${escapeHtml(c.client_name)}</div>` : ''}
      ${c.contact_name ? `<div class="party-meta">${escapeHtml(L.contact)}${L.colon}${escapeHtml(c.contact_name)}</div>` : ''}
      ${c.contact_phone ? `<div class="party-meta">${escapeHtml(L.phone)}${L.colon}${escapeHtml(c.contact_phone)}</div>` : ''}
      ${c.location_address ? `<div class="party-meta">${escapeHtml(c.location_address)}</div>` : ''}
    </div>
    <table class="dates">${row(L.date, c.service_date)}${row(L.time, c.service_time)}${row(L.worker, c.employee_name)}</table>
  </div>
  <p class="thanks" style="margin-top:0">${escapeHtml(L.intro)}</p>
  <div class="lines-wrap"><table class="lines">
    <thead><tr><th>${escapeHtml(L.type)}</th><th class="num">${escapeHtml(L.total)}</th></tr></thead>
    <tbody><tr><td>${escapeHtml(c.service_type || L.sub)}</td><td class="num">${yen(t.total)}</td></tr></tbody>
  </table></div>
  <table class="totals">
    <tr><td>${escapeHtml(L.subtotal)}</td><td class="num">${yen(t.subtotal)}</td></tr>
    <tr><td>${escapeHtml(L.tax)} (${Number(c.tax_rate || 0)}%)</td><td class="num">${yen(t.tax)}</td></tr>
    <tr class="total-row"><td>${escapeHtml(L.total)}</td><td class="num">${yen(t.total)}</td></tr>
  </table>
  ${c.scope ? `<div class="sec"><h3>${escapeHtml(L.scope)}</h3><div class="box">${multiline(c.scope)}</div></div>` : ''}
  <div class="sec"><h3>${escapeHtml(L.terms)}</h3><div class="box">${multiline(c.terms || DEFAULT_SPOT_TERMS[L.lang])}</div></div>
  <div class="signs">
    <div class="sign">${escapeHtml(L.signLocation)}
      ${signatureSrc ? `<img src="${escapeHtml(signatureSrc)}" alt="">` : ''}
      ${c.signed_by ? `<div class="who">${escapeHtml(c.signed_by)}</div>` : ''}
      ${signedDate ? `<div class="muted">${escapeHtml(L.signedAt)}${L.colon}${escapeHtml(signedDate)}</div>` : ''}
    </div>
    <div class="sign">${escapeHtml(L.signUs)}<div class="who">${escapeHtml(issuer.company)} ${escapeHtml(issuer.title)} ${escapeHtml(issuer.name)}</div></div>
  </div>
  ${printIssuerHtml({ rep: L.lang === 'ja' ? '代表' : 'Rep.', address: L.lang === 'ja' ? '住所' : 'Address', reg: L.lang === 'ja' ? '登録番号' : 'Reg. No.', email: L.lang === 'ja' ? 'メール' : 'Email', phone: L.phone, bank: L.lang === 'ja' ? '振込先' : 'Bank' }, issuer)}
</div></body></html>`
}
