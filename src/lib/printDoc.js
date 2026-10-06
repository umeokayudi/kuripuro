/** Shared A4 print styles for 見積書 and 請求書. */
export const PRINT_DOC_CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body{font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif;color:#152033;max-width:740px;margin:0 auto;padding:8px 12px 24px;background:#fff}
  .head{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:3px solid #0c1c30;padding-bottom:14px;margin-bottom:10px}
  .brand-name{font-size:26px;font-weight:800;letter-spacing:0.28em;color:#0c1c30}
  .doc-title{text-align:right}
  .doc-title h1{font-size:28px;letter-spacing:var(--title-tracking, 0.45em);margin:0 0 4px;font-weight:800}
  .doc-title .no{font-size:12px;color:#667}
  .gold{height:4px;background:linear-gradient(90deg,#c4a35a,#ead9a8,#c4a35a);margin:0 0 20px}
  .meta{display:flex;justify-content:space-between;gap:24px;margin-bottom:18px;font-size:13px}
  .bill-to{font-size:22px;font-weight:800;margin-bottom:6px;letter-spacing:0.04em}
  .site-kicker{font-size:11px;letter-spacing:0.28em;color:#886;margin-bottom:2px}
  .muted{color:#667;line-height:1.6}
  .thanks{margin:20px 0 0;font-size:13px;line-height:1.85;color:#334;max-width:34em}
  table.lines{width:100%;border-collapse:collapse;margin:8px 0 4px}
  table.lines th{background:#0c1c30;color:#f7efd8;padding:9px 10px;text-align:left;font-size:12px;font-weight:600}
  table.lines td{padding:9px 10px;border-bottom:1px solid #e6ebf2;font-size:13px}
  .num{text-align:right;white-space:nowrap}
  .totals{width:280px;margin:12px 0 0 auto}
  .totals td{border:none;padding:5px 8px;font-size:13px}
  .total-row td{border-top:2px solid #152033;font-weight:800;font-size:16px}
  .issuer{margin-top:32px;display:flex;justify-content:flex-end}
  .issuer-card{border:1px solid #e6d7b0;background:#fbf8f1;border-radius:12px;padding:14px 18px;min-width:280px;font-size:12px;line-height:1.75;color:#334}
  .issuer-kicker{font-size:10px;letter-spacing:0.2em;color:#886;margin-bottom:4px}
  .issuer-card strong{display:block;font-size:15px;color:#0c1c30;margin-bottom:6px}
  .issuer-line{display:grid;grid-template-columns:5.2em 1fr;gap:6px;margin:2px 0}
  .issuer-line span{color:#886}
  .stamp{position:absolute;right:28px;top:86px;border:3px solid #0f6e56;color:#0f6e56;padding:6px 14px;font-weight:800;transform:rotate(-12deg);font-size:18px}
  .wrap{position:relative}
`

export const INVOICE_PRINT_COPY = {
  ja: {
    htmlLang: 'ja',
    docTitle: '請求書',
    honorific: '御中',
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
    issueDate: 'Issue date',
    period: 'Billing period',
    due: 'Due date',
    rep: 'Representative',
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
    thanks: 'Thank you for your continued business. Please find this invoice below.',
    titleTracking: '0.12em',
  },
}

export function invoicePrintCopy(lang) {
  return INVOICE_PRINT_COPY[lang === 'en' ? 'en' : 'ja']
}
