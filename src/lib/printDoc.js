import { escapeHtml } from './escapeHtml'

/** Shared A4 print styles for 見積書 and 請求書. */
export const PRINT_DOC_CSS = `
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body{font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif;color:#122033;max-width:720px;margin:0 auto;padding:4px 8px 20px;background:#fff}
  .wrap{position:relative}
  .mast{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;border-bottom:2px solid #122033;padding-bottom:12px}
  .mast h1{font-size:30px;letter-spacing:var(--title-tracking, 0.4em);margin:0;font-weight:800;line-height:1}
  .mast .no{margin-top:6px;font-size:12px;color:#5c6573;letter-spacing:0.04em}
  .rule{height:3px;background:#c4a35a;margin:0 0 22px}
  .top{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:28px;align-items:start;margin-bottom:20px}
  .party-name{font-size:22px;font-weight:800;letter-spacing:0.03em;line-height:1.35;margin:0 0 6px}
  .party-co{font-size:13px;color:#3a4556;margin:0 0 8px}
  .party-meta{font-size:12px;color:#5c6573;line-height:1.65}
  table.dates{width:100%;border-collapse:collapse;font-size:12px}
  table.dates td{padding:4px 0;vertical-align:top}
  table.dates td.k{color:#5c6573;white-space:nowrap;padding-right:10px;width:1%}
  table.dates td.v{text-align:right;font-weight:600;color:#122033;word-break:keep-all}
  .muted{color:#5c6573;line-height:1.6;font-size:12px}
  .thanks{margin:18px 0 0;font-size:13px;line-height:1.85;color:#334;max-width:36em}
  table.lines{width:100%;border-collapse:collapse;margin:4px 0}
  table.lines th{background:#122033;color:#f7efd8;padding:8px 10px;text-align:left;font-size:11px;font-weight:600;letter-spacing:0.06em}
  table.lines td{padding:9px 10px;border-bottom:1px solid #e6ebf2;font-size:13px}
  .num{text-align:right;white-space:nowrap}
  .totals{width:260px;margin:14px 0 0 auto;border-collapse:collapse}
  .totals td{border:none;padding:5px 8px;font-size:13px}
  .total-row td{border-top:2px solid #122033;font-weight:800;font-size:16px;padding-top:8px}
  .foot{margin-top:28px;display:flex;justify-content:flex-end}
  .issuer-card{border:1px solid #122033;padding:14px 16px 14px 18px;min-width:19rem;max-width:24rem;font-size:12px;line-height:1.7;color:#334}
  .issuer-brand{font-size:16px;font-weight:800;color:#122033;margin:0 0 8px;letter-spacing:0.08em}
  .issuer-line{display:grid;grid-template-columns:5.6rem minmax(0,1fr);gap:2px 10px;margin:2px 0;align-items:start}
  .issuer-line span{color:#5c6573;white-space:nowrap}
  .issuer-line div{min-width:0;overflow-wrap:break-word;word-break:keep-all;hyphens:none}
  .rep-name{font-weight:800;color:#122033}
  .stamp{position:absolute;right:8px;top:8px;border:2px solid #0f6e56;color:#0f6e56;padding:4px 10px;font-weight:800;transform:rotate(-8deg);font-size:13px;letter-spacing:0.12em}
`

export const INVOICE_PRINT_COPY = {
  ja: {
    htmlLang: 'ja',
    docTitle: '請求書',
    honorific: '御中',
    store: '店舗',
    company: '会社',
    contact: 'ご担当',
    issueDate: '発行日',
    period: '対象期間',
    due: '支払期限',
    rep: '代表',
    address: '住所',
    reg: '登録番号',
    desc: '内容',
    qty: '数量',
    unit: '単価',
    amount: '金額',
    subtotal: '小計',
    tax: '消費税',
    total: '合計（税込）',
    notes: '備考',
    issuer: '発行者',
    email: 'メール',
    phone: '電話',
    bank: '振込先',
    paid: '入金済',
    colon: '：',
    rangeSep: ' 〜 ',
    thanks: '平素より格別のお引き立てを賜り、誠にありがとうございます。下記のとおりご請求申し上げます。',
    titleTracking: '0.45em',
  },
  en: {
    htmlLang: 'en',
    docTitle: 'INVOICE',
    honorific: '',
    store: 'Store',
    company: 'Company',
    contact: 'Contact',
    issueDate: 'Issue date',
    period: 'Billing period',
    due: 'Due date',
    rep: 'Rep.',
    address: 'Address',
    reg: 'Reg. No.',
    desc: 'Description',
    qty: 'Qty',
    unit: 'Unit price',
    amount: 'Amount',
    subtotal: 'Subtotal',
    tax: 'Consumption tax',
    total: 'Total (incl. tax)',
    notes: 'Notes',
    issuer: 'Issuer',
    email: 'Email',
    phone: 'Phone',
    bank: 'Bank',
    paid: 'PAID',
    colon: ': ',
    rangeSep: ' – ',
    thanks: 'Thank you for your continued business. Please find the details below.',
    titleTracking: '0.12em',
  },
}

export function invoicePrintCopy(lang) {
  return INVOICE_PRINT_COPY[lang === 'en' ? 'en' : 'ja']
}

export function countNeedle(hay, needle) {
  if (!needle) return 0
  return String(hay).split(needle).length - 1
}

export function printPartyHtml(L, { restaurant, company, contact, address, extra = '' }) {
  const site = String(restaurant || '').trim()
  const co = String(company || '').trim()
  const headline = site || co
  const honor = L.honorific && headline ? ` ${L.honorific}` : ''
  const coLine = co && co !== headline
    ? `<div class="party-co">${escapeHtml(co)}</div>`
    : ''
  return `<div class="party">
      <div class="party-name">${escapeHtml(headline)}${honor}</div>
      ${coLine}
      ${contact ? `<div class="party-meta">${escapeHtml(L.contact)}${L.colon}${escapeHtml(contact)}</div>` : ''}
      ${address ? `<div class="party-meta">${escapeHtml(address)}</div>` : ''}
      ${extra}
    </div>`
}

export function printDatesHtml(rows) {
  const body = (rows || [])
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${v}</td></tr>`)
    .join('')
  return `<table class="dates">${body}</table>`
}

export function printIssuerHtml(L, loc, { bank = '' } = {}) {
  const line = (label, value, cls = '') => value
    ? `<div class="issuer-line"><span>${escapeHtml(label)}</span><div class="${cls}">${value}</div></div>`
    : ''
  return `<div class="foot">
      <div class="issuer-card">
        <div class="issuer-brand">${escapeHtml(loc.company || '')}</div>
        ${line(L.rep, `<span class="rep-name">${escapeHtml(loc.name || '')}</span>`)}
        ${line(L.address, escapeHtml(loc.address || ''))}
        ${line(L.reg, escapeHtml(loc.regNumber || ''))}
        ${line(L.email, escapeHtml(loc.email || ''))}
        ${line(L.phone, escapeHtml(loc.phone || ''))}
        ${line(L.bank, escapeHtml(bank || loc.bank || ''))}
      </div>
    </div>`
}

export function wrapPrintHtml({
  L,
  number,
  printTitle,
  stamp = '',
  partyHtml,
  datesHtml,
  columnHead,
  rows,
  totalsHtml,
  notesHtml = '',
  thanks = '',
  issuerHtml,
}) {
  return `<!DOCTYPE html>
<html lang="${L.htmlLang}"><head><meta charset="utf-8"><title>${escapeHtml(L.docTitle)} ${escapeHtml(number)} - ${printTitle}</title>
<style>${PRINT_DOC_CSS}
  .mast h1{letter-spacing:${L.titleTracking}}
</style></head>
<body>
  <div class="wrap">
    ${stamp ? `<div class="stamp">${stamp}</div>` : ''}
    <div class="mast">
      <div></div>
      <div class="doc-title" style="text-align:right">
        <h1>${escapeHtml(L.docTitle)}</h1>
        <div class="no">${escapeHtml(number)}</div>
      </div>
    </div>
    <div class="rule"></div>
    <div class="top">
      ${partyHtml}
      ${datesHtml}
    </div>
    <table class="lines">
      <thead><tr>${columnHead}</tr></thead>
      <tbody>${rows || '<tr><td colspan="4">—</td></tr>'}</tbody>
    </table>
    ${totalsHtml}
    ${notesHtml}
    ${thanks ? `<p class="thanks">${thanks}</p>` : ''}
    ${issuerHtml}
  </div>
</body></html>`
}

/** Longer Japanese phrases first. */
const JA_EN_PHRASES = [
  ['日常清掃', 'Daily cleaning'],
  ['基本清掃', 'Basic cleaning'],
  ['深層清掃', 'Deep cleaning'],
  ['定期清掃', 'Regular cleaning'],
  ['床清掃', 'Floor cleaning'],
  ['床洗浄', 'Floor washing'],
  ['床ワックス', 'Floor wax'],
  ['厨房清掃', 'Kitchen cleaning'],
  ['トイレ清掃', 'Restroom cleaning'],
  ['窓ガラス', 'Window glass'],
  ['グリストラップ', 'Grease trap'],
  ['レンジフード', 'Range hood'],
  ['換気扇', 'Ventilation fan'],
  ['エアコン清掃', 'Air-conditioner cleaning'],
  ['エアコン', 'air conditioner'],
  ['ディープクリーン', 'Deep clean'],
  ['ディープ', 'deep'],
  ['害虫駆除', 'Pest control'],
  ['ゴミ回収', 'Garbage collection'],
  ['月額契約', 'Monthly contract'],
  ['月額', 'monthly'],
  ['スポット作業', 'Spot job'],
  ['スポット', 'spot'],
  ['対象期間', 'Billing period'],
  ['回/月', '× / month'],
  ['回／月', '× / month'],
  ['週3回', '3× / week'],
  ['週2回', '2× / week'],
  ['週1回', '1× / week'],
  ['月2回', '2× / month'],
  ['月1回', '1× / month'],
  ['2時間', '2 hours'],
  ['3時間', '3 hours'],
  ['時間', 'hours'],
  ['店長', 'Store manager'],
  ['社長', 'President'],
  ['部長', 'Manager'],
  ['ご担当', 'Contact'],
  ['（税込）', ' (incl. tax)'],
  ['(税込)', ' (incl. tax)'],
  ['税込', 'incl. tax'],
  ['税抜', 'excl. tax'],
]

const JP_ADDRESS_EN = [
  ['〒', ''],
  ['東京都', 'Tokyo '],
  ['大阪府', 'Osaka '],
  ['北海道', 'Hokkaido '],
  ['神奈川県', 'Kanagawa '],
  ['埼玉県', 'Saitama '],
  ['千葉県', 'Chiba '],
  ['清瀬市', 'Kiyose-shi '],
  ['中清戸', 'Nakakiyoto '],
  ['港区', 'Minato-ku '],
  ['墨田区', 'Sumida-ku '],
  ['品川区', 'Shinagawa-ku '],
  ['渋谷区', 'Shibuya-ku '],
  ['新宿区', 'Shinjuku-ku '],
  ['中央区', 'Chuo-ku '],
  ['千代田区', 'Chiyoda-ku '],
  ['江東区', 'Koto-ku '],
  ['新橋', 'Shinbashi '],
  ['錦糸町', 'Kinshicho '],
  ['丁目', '-chome '],
  ['番地', '-'],
  ['号', ''],
]

export function localizePrintText(text, lang = 'ja') {
  let out = String(text || '')
  if (lang !== 'en' || !out) return out
  for (const [ja, en] of JA_EN_PHRASES) {
    if (out.includes(ja)) out = out.split(ja).join(en)
  }
  return out
}

export function formatAddressForLang(address, lang = 'ja') {
  let out = String(address || '')
  if (lang !== 'en' || !out) return out
  for (const [ja, en] of JP_ADDRESS_EN) {
    if (out.includes(ja)) out = out.split(ja).join(en)
  }
  return out.replace(/\s+/g, ' ').trim()
}

