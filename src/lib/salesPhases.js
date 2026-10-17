// Phases of a client, from first contact to active client. The first five follow
// the seller's lead stage; the last three come from the quote and the contract,
// so approving a quote opens the contract phase instead of ending the funnel.
export const PHASES = ['lead', 'contact', 'visit', 'proposal', 'negotiation', 'approved', 'contract', 'active', 'lost']
export const STEP_PHASES = PHASES.filter(p => p !== 'lost')

export function phaseOf(lead, quotes = [], submissions = [], visits = [], contacts = 0) {
  if (submissions.some(s => ['active', 'approved'].includes(s.status))) return 'active'
  if (lead.stage === 'lost') return 'lost'
  if (submissions.some(s => ['draft', 'pending_review', 'changes_requested'].includes(s.status))) return 'contract'
  if (quotes.some(q => q.status === 'accepted') || lead.stage === 'won') return 'approved'
  if (lead.stage === 'negotiation') return 'negotiation'
  if (lead.stage === 'quote' || quotes.some(q => q.status === 'sent')) return 'proposal'
  if (visits[0]?.outcome === 'meeting_scheduled') return 'visit'
  if (lead.stage === 'followup' || contacts > 0) return 'contact'
  return 'lead'
}

export const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString()}`
export const day = v => String(v || '').slice(0, 10)
export const shortDay = v => { const d = day(v); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '' }
export const timeOf = v => { const s = String(v || ''); return s.length > 10 && s.includes('T') ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '' }
export const initials = name => String(name || '?').trim().split(/\s+/).map(w => [...w][0]).join('').slice(0, 2).toUpperCase()
export const mapUrlOf = lead => lead?.maps_url || (lead?.gps_lat != null && lead?.gps_lng != null ? `https://www.google.com/maps/search/?api=1&query=${lead.gps_lat},${lead.gps_lng}` : (lead?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}` : ''))

const COPY = {
  en: {
    title: 'Sales funnel', sub: 'Every client from first contact to active contract.', search: 'Search client, shop, contact…', allSellers: 'All sellers', showLost: 'Show lost',
    phases: { lead: 'Lead', contact: 'Contact', visit: 'Visit booked', proposal: 'Quote sent', negotiation: 'Negotiation', approved: 'Approved', contract: 'Contract', active: 'Active', lost: 'Lost' },
    clients: n => `${n} client${n === 1 ? '' : 's'}`, contacts: n => `${n} contact${n === 1 ? '' : 's'}`, empty: 'No clients here.', lastContact: 'Last contact',
    addLead: 'Add lead', board: 'Board', list: 'List', moved: s => `Moved to ${s}`, dragHint: 'Drag a card to another column to move it. Approved, Contract and Active follow the quote and the contract.', moveTo: 'Move to', moveHint: 'Tap a stage above to see its clients. Use “Move to” to change a client’s stage. Approved, Contract and Active follow the quote and the contract.',
    quoteApproved: 'Quote approved', contractStatus: { draft: 'Draft contract', pending_review: 'Waiting for approval', changes_requested: 'Changes requested', approved: 'Approved', active: 'Active', rejected: 'Not approved' },
    tabs: { steps: 'Funnel & steps', quote: 'Quote', contract: 'Contract', active: 'Active client', contacts: 'Contacts', files: 'Files', history: 'History' },
    edit: 'Edit', call: 'Call', email: 'E-mail', line: 'LINE', map: 'Map', logContact: 'Log contact', logVisit: 'Log visit', followup: 'Set follow-up', responsible: 'Responsible',
    currentStep: 'Current step', stepDetails: 'Step details', date: 'Date', notDone: 'Not reached yet', nextStep: 'Next step', quickActions: 'Quick actions',
    advance: 'Move to contract', openQuote: 'See quote', newQuote: 'New quote', saveQuote: 'Save quote', markSent: 'Mark as sent', markAccepted: 'Client approved', markDeclined: 'Client declined', openInQuotes: 'Open in Quotes',
    stepHelp: {
      lead: 'Client registered with business card, GPS and Maps link.', contact: 'Talk to the client and log every contact.', visit: 'A visit or meeting is booked.',
      proposal: 'Quote created and sent to the client.', negotiation: 'Adjusting price and scope with the client.', approved: 'Client approved the quote. Next: generate the contract.',
      contract: 'Contract generated from the quote, signed by the client and approved by the office.', active: 'Services running, visits scheduled and invoices issued.', lost: 'Client did not move forward.',
    },
    quoteInfo: 'Quote', total: 'Total', created: 'Created', sentOn: 'Sent', approvedOn: 'Approved', validUntil: 'Valid until', items: 'Items', frequency: 'Frequency', hours: 'Hours / visit', noQuote: 'No quote yet.',
    status: 'Status', quoteStatus: { draft: 'Draft', pending: 'Draft', sent: 'Sent', accepted: 'Approved', declined: 'Declined', expired: 'Expired' },
    contractSteps: { generate: 'Generate contract from the quote', review: 'Review and adjust terms', send: 'Send for signature (PDF)', signed: 'Attach the signed contract', activate: 'Office approves and activates' },
    contractForm: 'Contract', fromQuote: q => `Filled from quote ${q}`, service: 'Service', billing: 'Billing', monthlyFixed: 'Monthly fixed', perVisit: 'Per visit', base: 'Base monthly price (¥)', priceVisit: 'Price per visit (¥)', visits: 'Visits per month',
    days: 'Days of the week', billingDay: 'Billing day', tax: 'Tax %', commission: 'Seller commission', percent: 'Percent', fixed: 'Fixed (¥)', commissionValue: 'Commission value', clientTotal: 'Monthly price to client', perMonth: '/ month',
    saveDraft: 'Save contract', downloadForSign: 'Download contract to sign (PDF)', attachSigned: 'Attach signed contract (PDF)', sendApproval: 'Send for approval', approveActivate: 'Approve and activate', requestChanges: 'Ask for changes',
    draftSaved: 'Contract saved. Download it, have it signed, then attach the signed PDF.', sentForApproval: 'Sent to the office for approval.', activated: 'Contract approved. The client is now active.', adminNote: 'Note from the office',
    noContract: 'No contract yet.', needApproved: 'Approve a quote first, then move to contract.', pdfOnly: 'Choose a PDF file.',
    services: 'Contracted services', schedule: 'Visits', upcoming: 'Next visits', done: 'Done', invoices: 'Payments', paid: 'Paid', open: 'Open', overdue: 'Overdue', noJobs: 'No visits scheduled yet.', noInvoices: 'No invoices yet.', notActive: 'Becomes available once the contract is active.',
    jobStatus: { scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Done', cancelled: 'Cancelled' }, invoiceStatus: { draft: 'Draft', issued: 'Issued', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled' },
    mainContact: 'Main contact', otherContacts: 'Also talked to', clientManager: 'Client manager', noContacts: 'No contact saved.',
    files: { card: 'Business card', signed: 'Signed contract', audio: 'Meeting recording' }, noFiles: 'No files yet.', openFile: 'Open',
    ev: { created: 'Client added to the funnel', contact: 'Contact', visit: 'Visit', quoteDraft: 'Quote created', quoteSent: 'Quote sent', quoteAccepted: 'Quote approved', quoteDeclined: 'Quote declined', contractDraft: 'Contract generated', contractSent: 'Signed contract sent for approval', contractActive: 'Contract approved · client active', contractBack: 'Office asked for changes', job: 'Service done', invoicePaid: 'Payment received' },
    by: n => `by ${n}`, nextFollowup: 'Next follow-up', noHistory: 'Nothing logged yet.',
    download: 'Download', dl: { contacts: 'Contacts (CSV)', docs: 'All documents (ZIP)', history: 'Activity history (CSV)', summary: 'Client summary (PDF)' }, preparing: 'Preparing…',
    channels: { visit: 'Visit', phone: 'Phone', line: 'LINE', email: 'Email', meeting: 'Meeting', other: 'Other' },
    outcomes: { talked: 'Talked', meeting_scheduled: 'Meeting booked', quote_sent: 'Quote sent', negotiating: 'Negotiating', closed: 'Closed / signed', no_interest: 'Not interested', absent: 'Absent' },
    loading: 'Loading…', seller: 'Seller', area: 'Area', source: 'Source', value: 'Value', gps: 'Registered at', mapsLink: 'Google Maps',
  },
  ja: {
    title: '営業ファネル', sub: '初回連絡から契約・稼働中まで、すべての顧客を一覧で。', search: '顧客・店舗・担当者で検索…', allSellers: '全営業', showLost: '失注を表示',
    phases: { lead: 'リード', contact: '連絡中', visit: '訪問予定', proposal: '見積送付', negotiation: '交渉中', approved: '承認', contract: '契約', active: '稼働中', lost: '失注' },
    clients: n => `${n}件`, contacts: n => `連絡${n}回`, empty: '該当なし', lastContact: '最終連絡',
    addLead: 'リード追加', board: 'ボード', list: 'リスト', moved: s => `${s}に移動しました`, dragHint: 'カードを別の列へドラッグすると段階を変更できます。承認・契約・稼働中は見積と契約に連動します。', moveTo: '移動', moveHint: '上の段階をタップすると顧客が表示されます。「移動」で段階を変更できます。承認・契約・稼働中は見積と契約に連動します。',
    quoteApproved: '見積承認済み', contractStatus: { draft: '契約書作成中', pending_review: '承認待ち', changes_requested: '修正依頼', approved: '承認済み', active: '有効', rejected: '未承認' },
    tabs: { steps: 'ファネル・段階', quote: '見積', contract: '契約', active: '稼働中', contacts: '担当者', files: 'ファイル', history: '履歴' },
    edit: '編集', call: '電話', email: 'メール', line: 'LINE', map: '地図', logContact: '連絡を記録', logVisit: '訪問を記録', followup: 'フォロー設定', responsible: '担当',
    currentStep: '現在の段階', stepDetails: '段階の詳細', date: '日付', notDone: '未到達', nextStep: '次の段階', quickActions: 'クイック操作',
    advance: '契約へ進む', openQuote: '見積を見る', newQuote: '新規見積', saveQuote: '見積を保存', markSent: '送付済みにする', markAccepted: 'お客様が承認', markDeclined: 'お客様が不採用', openInQuotes: '見積画面で開く',
    stepHelp: {
      lead: '名刺・GPS・地図リンク付きで登録済み。', contact: 'お客様と連絡し、毎回記録します。', visit: '訪問・面談が予定されています。',
      proposal: '見積を作成して送付しました。', negotiation: '価格や範囲を調整中です。', approved: '見積が承認されました。次は契約書の作成です。',
      contract: '見積から契約書を作成し、署名後に本部が承認します。', active: '作業・訪問予定・請求が稼働中です。', lost: '成約に至りませんでした。',
    },
    quoteInfo: '見積', total: '合計', created: '作成日', sentOn: '送付日', approvedOn: '承認日', validUntil: '有効期限', items: '内訳', frequency: '頻度', hours: '1回の時間', noQuote: '見積はまだありません。',
    status: '状態', quoteStatus: { draft: '下書き', pending: '下書き', sent: '送付済み', accepted: '承認', declined: '不採用', expired: '期限切れ' },
    contractSteps: { generate: '見積から契約書を作成', review: '条件を確認・調整', send: '署名用PDFを送付', signed: '署名済み契約書を添付', activate: '本部が承認して有効化' },
    contractForm: '契約', fromQuote: q => `見積 ${q} から入力済み`, service: 'サービス', billing: '請求方法', monthlyFixed: '月額固定', perVisit: '訪問ごと', base: '月額基本料金 (¥)', priceVisit: '1回あたり料金 (¥)', visits: '月間訪問数',
    days: '曜日', billingDay: '請求日', tax: '税率 %', commission: '営業コミッション', percent: '割合', fixed: '固定 (¥)', commissionValue: 'コミッション値', clientTotal: '顧客月額料金', perMonth: '/ 月',
    saveDraft: '契約書を保存', downloadForSign: '署名用契約書をダウンロード (PDF)', attachSigned: '署名済み契約書を添付 (PDF)', sendApproval: '承認を申請', approveActivate: '承認して有効化', requestChanges: '修正を依頼',
    draftSaved: '契約書を保存しました。ダウンロードして署名をもらい、署名済みPDFを添付してください。', sentForApproval: '本部へ承認を申請しました。', activated: '契約を承認しました。稼働中になりました。', adminNote: '本部からのメモ',
    noContract: '契約はまだありません。', needApproved: '先に見積を承認してから契約へ進んでください。', pdfOnly: 'PDFファイルを選択してください。',
    services: '契約サービス', schedule: '訪問', upcoming: '次回の訪問', done: '完了', invoices: '支払い', paid: '入金済み', open: '未入金', overdue: '期限超過', noJobs: '訪問予定はまだありません。', noInvoices: '請求はまだありません。', notActive: '契約が有効になると表示されます。',
    jobStatus: { scheduled: '予定', in_progress: '作業中', completed: '完了', cancelled: '中止' }, invoiceStatus: { draft: '下書き', issued: '発行済み', sent: '送付済み', paid: '入金済み', overdue: '期限超過', cancelled: '取消' },
    mainContact: '主担当', otherContacts: 'その他の担当者', clientManager: '店舗責任者', noContacts: '担当者が登録されていません。',
    files: { card: '名刺', signed: '署名済み契約書', audio: '面談の録音' }, noFiles: 'ファイルはありません。', openFile: '開く',
    ev: { created: 'ファネルに追加', contact: '連絡', visit: '訪問', quoteDraft: '見積作成', quoteSent: '見積送付', quoteAccepted: '見積承認', quoteDeclined: '見積不採用', contractDraft: '契約書作成', contractSent: '署名済み契約書を申請', contractActive: '契約承認・稼働開始', contractBack: '本部が修正を依頼', job: '作業完了', invoicePaid: '入金' },
    by: n => `${n}`, nextFollowup: '次回連絡', noHistory: '記録はまだありません。',
    download: 'ダウンロード', dl: { contacts: '担当者 (CSV)', docs: '全書類 (ZIP)', history: '活動履歴 (CSV)', summary: '顧客サマリー (PDF)' }, preparing: '準備中…',
    channels: { visit: '訪問', phone: '電話', line: 'LINE', email: 'メール', meeting: '面談', other: 'その他' },
    outcomes: { talked: '話せた', meeting_scheduled: '面談設定', quote_sent: '見積送付', negotiating: '交渉中', closed: '成約・署名', no_interest: '興味なし', absent: '不在' },
    loading: '読み込み中…', seller: '営業担当', area: '地域', source: '流入元', value: '金額', gps: '登録場所', mapsLink: 'Googleマップ',
  },
}
export const funnelCopy = lang => COPY[lang === 'ja' ? 'ja' : 'en']

// Best guess of the contract's service from the quote lines (seller can change it).
export function serviceFromQuote(quote) {
  const items = (quote?.items || []).slice().sort((a, b) => Number(b.total ?? b.amount ?? (b.unit_price || 0) * (b.quantity || 1)) - Number(a.total ?? a.amount ?? (a.unit_price || 0) * (a.quantity || 1)))
  const text = items[0]?.description || ''
  if (/グリス|grease/i.test(text)) return 'Grease Trap'
  if (/フード|ダクト|hood|duct/i.test(text)) return 'Range Hood'
  if (/エアコン|空調|\bAC\b|air ?con/i.test(text)) return 'AC Cleaning'
  if (/窓|ガラス|window/i.test(text)) return 'Window Cleaning'
  if (/ワックス|wax/i.test(text)) return 'Floor Wax'
  if (/徹底|ディープ|deep/i.test(text)) return 'Deep Cleaning'
  return 'Basic Cleaning'
}
