import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import FieldAppShell, { Sheet } from '../components/FieldAppShell'
import { prepareImageForUpload } from '../lib/imageUpload'
import { ContactHistory, ContactLogForm, FollowupChip, GoalBars, LastContactLine, followupCopy } from '../components/SalesFollowupParts'
import { RESPONSE_TAGS, alertCounts, followupQueue, goalFor, monthOf, monthResults } from '../lib/salesFollowup'
import SalesKpiPanel from '../components/SalesKpiPanel'
import SalesInbox from '../components/SalesInbox'
import SellerContractCommissions from '../components/SellerContractCommissions'
import { ClientList, CommissionsCard, MyNumbers, NextFollowups } from '../components/SellerHome'
import SellerQuoteRequests, { QuoteRequestsAlert, quoteRequestsToSend, quoteRequestsWaiting } from '../components/SellerQuoteRequests'
import SalesFunnel, { buildDeals } from '../components/SalesFunnel'
import ClientPage from '../components/ClientPage'

const COPY = {
  en: {
    title: 'Sales workspace', overview: 'Overview', leads: 'Leads', followups: 'Follow-ups', approaches: 'Reports', contracts: 'Contracts',
    today: 'Today', month: 'This month', approachesN: 'Approaches', leadsN: 'Leads', quotes: 'Quotes', active: 'Active contracts', hours: 'Hours this month', hoursSpent: 'Hours on approach',
    conversion: 'Approach → won', ticket: 'Average quote', commission: 'Commission accrued', due: 'Follow-ups due',
    addLead: 'New lead', scanCard: 'Scan business card', analyze: 'Read with AI', confirm: 'Review these details, correct them, then save the lead.',
    company: 'Company / restaurant', site: 'Location', contact: 'Contact person', role: 'Title', phone: 'Phone', email: 'Email', address: 'Address', region: 'Region / prefecture (auto from address)',
    followupDate: 'Next follow-up', followupNote: 'Follow-up plan', source: 'Source', save: 'Save lead', approachLog: 'Log approach', place: 'Meeting / visit location',
    date: 'Date', travel: 'Travel cost (¥)', duration: 'Meeting length (minutes)', notes: 'Notes / voice description',
    audio: 'Record or choose audio', transcribe: 'Transcribe and summarize with AI', transcript: 'Meeting transcript', summary: 'AI summary', nextStep: 'Suggested next step',
    saveApproach: 'Save report', open: 'Open', overdue: 'Overdue', markDone: 'Complete', activeContracts: 'Active contracts',
    prepare: 'Prepare signed contract', lead: 'Lead', service: 'Service', billing: 'Billing type', monthlyBase: 'Base monthly price (¥)',
    commissionType: 'Extra commission', percent: 'Percent', fixed: 'Fixed amount (¥)', commissionValue: 'Commission value',
    visits: 'Visits per month', priceVisit: 'Base price per visit (¥)', hoursVisit: 'Hours per visit', signedPdf: 'Signed contract PDF',
    submit: 'Send for approval', pending: 'Waiting for admin review', approved: 'Approved', requested: 'Changes requested', rejected: 'Not approved',
    totalClient: 'Monthly price to client', aiReview: 'AI funnel review', aiHint: 'AI suggestions are for your review; confirm them before acting.', logout: 'Log out',
    noLeads: 'No leads yet.', noFollowups: 'No follow-ups due.', noContracts: 'No contracts yet.', recording: 'Recording… tap to stop', record: 'Record voice note',
    searchAi: 'Review my funnel', saving: 'Saving…', status: 'Status', companyRequired: 'Enter a company or restaurant name.',
    audioPermission: 'Allow microphone access to record a note.', submitted: 'Sent to admin for review.',
    leadSaved: 'Lead saved', reportSaved: 'Report saved', loading: 'Loading…', unavailable: 'Sales data is unavailable right now. Try again in a moment.', sessionExpired: 'Your session expired. Please sign in again.',
    monthlyFixed: 'Monthly fixed', perVisit: 'Per visit', campaign: 'Campaign', perMonth: '/ month', pdfOnly: 'Choose a PDF file.', linkedLead: 'Lead (optional)', none: '—',
    stages: { approach: 'Approach', followup: 'Follow-up', quote: 'Quote', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' },
    statuses: { draft: 'Draft', pending_review: 'Waiting for review', approved: 'Approved', changes_requested: 'Changes requested', active: 'Active', rejected: 'Not approved' },
    tooBig: mb => `File is larger than ${mb} MB.`,
    myDay: 'My work day', startDay: 'Start day', endDay: 'End day & send report', dayNotStarted: 'Start your day when you begin field work. When you end it, a report is written automatically for the manager.',
    dayStarted: t => `Working since ${t}`, dayEnded: (a, b) => `Day closed ${a}–${b}`, dayNote: 'Anything to add for the manager? (optional)', dayTravel: 'Travel cost today (¥)', endConfirm: 'End the day now and send the report?', writing: 'Writing report…', dayReport: 'Day report', reopen: 'Restart day',
    outcome: 'What happened', outcomes: { talked: 'Talked, no next step yet', meeting_scheduled: 'Meeting scheduled', quote_sent: 'Quote sent', negotiating: 'Negotiating', closed: 'Closed / signed', no_interest: 'Not interested', absent: 'Nobody / absent' },
    clientSaid: 'What the client answered', answerType: 'Type of answer',
    home: 'Home', more: 'More', kicker: 'KURIPURO · SALES', newLeadShort: 'New lead', logVisit: 'Log visit', todo: 'To do today', allDone: 'Nothing due today. Go find new clients!',
    monthOverview: 'This month', seeAll: 'See all', search: 'Search shop, company or contact', all: 'All',
    cardStep: 'Business card photo', cardStepHint: 'Take a photo of the business card. AI fills in the details and your location is saved.', takePhoto: 'Take photo of the card', retake: 'Retake photo', reading: 'Reading the card…',
    gps: 'Location (GPS)', gpsGetting: 'Getting your location…', gpsOk: acc => `Location saved (±${acc} m)`, gpsFail: 'Could not get your location. Turn on location for this site and try again.', gpsRetry: 'Try again',
    mapsLink: 'Google Maps link of the shop', mapsHint: 'In Google Maps: find the shop → Share → Copy link, then paste here.', openMaps: 'Open Google Maps here', paste: 'Paste', useGps: 'Use my location', mapsBad: 'Paste a Google Maps link (google.com/maps or maps.app.goo.gl).',
    needCard: 'Take the business card photo first.', needGps: 'Location is required to save a lead.', required: 'required', details: 'More details', call: 'Call', map: 'Map', card: 'Card',
    leadInfo: 'Details', editLead: 'Edit details', stage: 'Stage', history: 'History', noCard: 'No card photo', workingFor: 'Working', dayClosed: 'Day closed', endDaySheet: 'End the day',
    menuReports: 'Visits & day reports', menuContracts: 'Contracts', menuGoals: 'My goals', menuKpi: 'My KPIs', menuAi: 'AI funnel review', menuHint: { approaches: 'Every visit and day you logged', contracts: 'Send a signed contract', goals: 'Monthly targets', kpi: 'Numbers and trends', ai: 'Ask the AI what to do next' },
    notifications: 'Notifications', visitFor: 'Visit', visitDetails: 'Time, travel, recording', hoursLog: 'Hours of a past day',
  },
  ja: {
    title: '営業ワークスペース', overview: '概要', leads: 'リード', followups: 'フォローアップ', approaches: '活動レポート', contracts: '契約',
    today: '本日', month: '今月', approachesN: '営業活動', leadsN: 'リード', quotes: '見積', active: '有効契約', hours: '今月の時間', hoursSpent: '営業活動時間',
    conversion: '成約率', ticket: '見積平均額', commission: '獲得コミッション', due: '対応期限',
    addLead: '新規リード', scanCard: '名刺を撮影', analyze: 'AIで読み取る', confirm: '内容を確認して修正し、保存してください。',
    company: '会社・店舗', site: '店舗名', contact: '担当者', role: '役職', phone: '電話', email: 'メール', address: '住所', region: '地域・都道府県（住所から自動）',
    followupDate: '次回連絡日', followupNote: 'フォロー内容', source: '流入元', save: 'リードを保存', approachLog: '営業活動を記録', place: '訪問・面談場所',
    date: '日付', travel: '交通費 (¥)', duration: '面談時間 (分)', notes: 'メモ・音声説明',
    audio: '音声を録音または選択', transcribe: 'AIで文字起こし・要約', transcript: '面談文字起こし', summary: 'AI要約', nextStep: '次の提案',
    saveApproach: 'レポートを保存', open: '開く', overdue: '期限超過', markDone: '完了', activeContracts: '有効契約',
    prepare: '署名済み契約を提出', lead: 'リード', service: 'サービス', billing: '請求方法', monthlyBase: '月額基本料金 (¥)',
    commissionType: '追加コミッション', percent: '割合', fixed: '固定金額 (¥)', commissionValue: 'コミッション値',
    visits: '月間訪問数', priceVisit: '1回あたり基本料金 (¥)', hoursVisit: '1回の作業時間', signedPdf: '署名済みPDF契約書',
    submit: '承認を申請', pending: '管理者確認中', approved: '承認済み', requested: '修正依頼', rejected: '未承認',
    totalClient: '顧客月額料金', aiReview: 'AI営業分析', aiHint: 'AIの提案を確認してから実行してください。', logout: 'ログアウト',
    noLeads: 'リードはありません。', noFollowups: '期限の近いフォローアップはありません。', noContracts: '契約はありません。', recording: '録音中… タップで停止', record: '音声メモを録音',
    searchAi: '営業状況を分析', saving: '保存中…', status: 'ステータス', companyRequired: '会社名または店舗名を入力してください。',
    audioPermission: '音声メモを録音するにはマイクを許可してください。', submitted: '管理者へ承認を申請しました。',
    leadSaved: 'リードを保存しました', reportSaved: 'レポートを保存しました', loading: '読み込み中…', unavailable: '営業データを読み込めません。少し待ってから再度お試しください。', sessionExpired: 'セッションの有効期限が切れました。もう一度ログインしてください。',
    monthlyFixed: '月額固定', perVisit: '訪問ごと', campaign: 'キャンペーン', perMonth: '/ 月', pdfOnly: 'PDFファイルを選択してください。', linkedLead: 'リード（任意）', none: '—',
    stages: { approach: 'アプローチ', followup: 'フォロー中', quote: '見積', negotiation: '交渉中', won: '成約', lost: '失注' },
    statuses: { draft: '下書き', pending_review: '確認待ち', approved: '承認済み', changes_requested: '修正依頼', active: '有効', rejected: '未承認' },
    tooBig: mb => `${mb}MBを超えるファイルは送信できません。`,
    myDay: '本日の稼働', startDay: '業務開始', endDay: '業務終了・日報送信', dayNotStarted: '外回りを始めるときに開始してください。終了すると管理者向けの日報が自動で作成されます。',
    dayStarted: t => `${t}から稼働中`, dayEnded: (a, b) => `${a}–${b} 終了`, dayNote: '管理者への補足（任意）', dayTravel: '本日の交通費 (¥)', endConfirm: '本日の業務を終了して日報を送信しますか？', writing: '日報を作成中…', dayReport: '日報', reopen: '再開',
    outcome: '結果', outcomes: { talked: '話せた（次の予定なし）', meeting_scheduled: '面談を設定', quote_sent: '見積を送付', negotiating: '交渉中', closed: '成約・署名', no_interest: '興味なし', absent: '不在' },
    clientSaid: 'お客様の返答', answerType: '返答の種類',
    home: 'ホーム', more: 'その他', kicker: 'KURIPURO · 営業', newLeadShort: '新規リード', logVisit: '訪問を記録', todo: '今日やること', allDone: '今日の期限はありません。新しいお客様を探しましょう！',
    monthOverview: '今月', seeAll: 'すべて見る', search: '店舗・会社・担当者で検索', all: 'すべて',
    cardStep: '名刺の写真', cardStepHint: '名刺を撮影してください。AIが内容を読み取り、現在地も保存されます。', takePhoto: '名刺を撮影', retake: '撮り直す', reading: '名刺を読み取り中…',
    gps: '現在地（GPS）', gpsGetting: '現在地を取得中…', gpsOk: acc => `現在地を保存しました（±${acc} m）`, gpsFail: '現在地を取得できません。位置情報を許可して再度お試しください。', gpsRetry: '再取得',
    mapsLink: '店舗のGoogleマップリンク', mapsHint: 'Googleマップで店舗を探し → 共有 → リンクをコピーして貼り付けてください。', openMaps: 'Googleマップを開く', paste: '貼り付け', useGps: '現在地を使う', mapsBad: 'Googleマップのリンクを貼り付けてください（google.com/maps または maps.app.goo.gl）。',
    needCard: '先に名刺を撮影してください。', needGps: 'リードの保存には現在地が必要です。', required: '必須', details: '詳細', call: '電話', map: '地図', card: '名刺',
    leadInfo: '情報', editLead: '情報を編集', stage: '段階', history: '履歴', noCard: '名刺写真なし', workingFor: '稼働中', dayClosed: '終了', endDaySheet: '業務終了',
    menuReports: '訪問・日報', menuContracts: '契約', menuGoals: '目標', menuKpi: 'KPI・推移', menuAi: 'AI営業分析', menuHint: { approaches: '記録した訪問と日報', contracts: '署名済み契約を提出', goals: '今月の目標', kpi: '数字と推移', ai: '次にやることをAIに相談' },
    notifications: 'お知らせ', visitFor: '訪問', visitDetails: '時間・交通費・録音', hoursLog: '過去日の稼働時間',
  },
}

const todayJapan = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
const yen = value => `¥${Math.round(Number(value || 0)).toLocaleString()}`
const baseMime = type => String(type || '').toLowerCase().split(';')[0].trim()
const MAX_MB = { 'business-card': 8, contract: 15, 'meeting-audio': 18 }

async function callApi(url, body) {
  const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Request failed')
  return result
}

const MAPS_RE = /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i
const mapsSearch = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
const leadMapUrl = row => row?.maps_url || (row?.gps_lat != null && row?.gps_lng != null ? mapsSearch(row.gps_lat, row.gps_lng) : (row?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.address)}` : ''))
const SELLER_STAGES = ['approach', 'followup', 'quote', 'negotiation']

// Fresh, precise fix for a new lead (not a cached one from an hour ago).
const readPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error('no-gps'))
  navigator.geolocation.getCurrentPosition(
    pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0) }),
    reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 })
})

const blankLead = () => ({ company_name: '', site_name: '', contact_name: '', contact_title: '', contact_phone: '', contact_email: '', address: '', region: '', source: 'visit', first_contact_date: todayJapan(), next_followup_date: '', notes: '', marketing_channel_id:'', marketing_campaign_id:'', business_card_object_path:'', maps_url:'' })
const blankApproach = () => ({ lead_id: '', work_date: todayJapan(), place: '', company_name: '', site_name: '', contact_name: '', contact_title: '', contact_phone: '', contact_email: '', notes: '', followup_note: '', followup_date: '', outcome: '', travel_cost: 0, duration_minutes: 0, hours_spent: 0, meeting_transcript: '', meeting_summary: '', ai_next_step: '', followup_status: 'open', client_response: '', response_tag: '' })

export default function SalespersonPortal() {
  const { user, logout } = useAuth()
  const { lang } = useLang()
  const c = COPY[lang === 'ja' ? 'ja' : 'en']
  const [tab, setTab] = useState('home')
  const [sheet, setSheet] = useState('')
  const [gps, setGps] = useState({ state: 'idle' })
  const [cardPreview, setCardPreview] = useState('')
  const [cardUrl, setCardUrl] = useState('')
  const [editingLead, setEditingLead] = useState(false)
  const [dealView, setDealView] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lead, setLead] = useState(blankLead)
  const [leadId, setLeadId] = useState('')
  const [approach, setApproach] = useState(blankApproach)
  const [dailyReport, setDailyReport] = useState({ work_date:todayJapan(), hours_worked:'', started_at:'', ended_at:'', areas:'', summary:'', travel_cost:0 })
  const [contract, setContract] = useState({ lead_id: '', service_type: 'Basic Cleaning', billing_type: 'fixed_monthly', base_monthly_amount: '', price_per_visit: '', visits_per_month: '', hours_per_visit: 2, days_of_week: [], billing_day: 10, tax_rate: 10, commission_type: 'percent', commission_value: '', signed_pdf_object_path: '', signed_pdf_name: '' })
  const [aiResult, setAiResult] = useState('')
  const [busyAi, setBusyAi] = useState(false)
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const cardRef = useRef(null)
  const audioRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/sales-data', { credentials: 'same-origin', cache: 'no-store' })
      const result = await response.json().catch(() => ({}))
      if (response.status === 401) { toast.error(c.sessionExpired); logout(); return }
      if (!response.ok) throw new Error(result.error || c.unavailable)
      setData(result)
    } catch (error) { toast.error(error.message) }
    finally { setLoading(false) }
  }, [c.sessionExpired, c.unavailable, logout])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const row = (data?.reports || []).find(item => item.work_date === todayJapan())
    if (row) setDailyReport({ work_date:row.work_date, hours_worked:row.hours_worked ?? '', started_at:row.started_at || '', ended_at:row.ended_at || '', areas:row.areas || '', summary:row.summary || '', travel_cost:row.travel_cost || 0 })
  }, [data?.reports])
  const leads = useMemo(() => data?.leads || [], [data?.leads])
  const metrics = data?.metrics?.[0] || {}
  const f = followupCopy(lang)
  const today = data?.today || todayJapan()
  const touchpoints = useMemo(() => data?.touchpoints || [], [data?.touchpoints])
  const queue = useMemo(() => followupQueue(leads, today, touchpoints), [leads, today, touchpoints])
  const counts = useMemo(() => alertCounts(queue), [queue])
  const statusOf = useMemo(() => new Map(queue.map(row => [row.lead.id, row.info])), [queue])
  const month = monthOf(today)
  const myGoal = goalFor(data?.goals, user.id, month)
  const myResults = useMemo(() => monthResults(data, user.id, month), [data, user.id, month])
  const [contactLeadId, setContactLeadId] = useState('')
  const [dayNote, setDayNote] = useState('')
  const [dayTravel, setDayTravel] = useState('')
  const [dayBusy, setDayBusy] = useState(false)
  const todayRow = (data?.reports || []).find(item => item.work_date === today) || null
  const [followFilter, setFollowFilter] = useState('action')
  const followups = useMemo(() => queue.filter(row => ['overdue', 'today', 'soon'].includes(row.info.status)).map(row => row.lead), [queue])
  const openContract = useMemo(() => leads.find(row => row.id === contract.lead_id), [leads, contract.lead_id])
  const commissionExtra = contract.commission_type === 'percent'
    ? Number(contract.base_monthly_amount || 0) * Number(contract.commission_value || 0) / 100
    : Number(contract.commission_value || 0)
  const monthlyClientPrice = Number(contract.base_monthly_amount || 0) + commissionExtra

  const post = async body => {
    const result = await callApi('/api/sales-data', body)
    await load()
    return result
  }

  const captureGps = async () => {
    setGps({ state: 'getting' })
    try {
      const pos = await readPosition()
      setGps({ state: 'ok', ...pos })
      setLead(prev => ({ ...prev, gps_lat: pos.lat, gps_lng: pos.lng, gps_accuracy: pos.acc, gps_captured_at: new Date().toISOString() }))
      return pos
    } catch {
      setGps({ state: 'fail' })
      return null
    }
  }

  const openNewLead = () => {
    setLead(blankLead()); setLeadId(''); setCardPreview(''); setGps({ state: 'idle' }); setSheet('newLead')
  }

  const runCardAI = async file => {
    if (!file) return
    setBusyAi(true)
    setCardPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    // Location is taken while the card is read, so the seller waits once.
    const gpsJob = captureGps()
    try {
      const photo = await prepareImageForUpload(file)
      const upload = await uploadFile(photo, 'business-card')
      setLead(prev => ({ ...prev, business_card_object_path: upload.path }))
      const { answer } = await callApi('/api/sales-ai', { task: 'business-card', object_path: upload.path, mime_type: upload.mime_type, language: lang }).catch(() => ({ answer: null }))
      if (answer) setLead(prev => ({ ...prev, company_name:answer.company_name || prev.company_name, site_name:answer.site_name || prev.site_name, contact_name:answer.contact_name || prev.contact_name, contact_title:answer.contact_title || prev.contact_title, contact_phone:answer.phone || prev.contact_phone, contact_email:answer.email || prev.contact_email, address:answer.address || prev.address, first_contact_date: answer.date || prev.first_contact_date }))
      toast.success(c.confirm)
    } catch (error) { toast.error(error.message); setCardPreview('') }
    finally { setBusyAi(false); if (cardRef.current) cardRef.current.value = ''; await gpsJob }
  }

  const saveLead = async event => {
    event?.preventDefault()
    if (!leadId && !lead.business_card_object_path) return toast.error(c.needCard)
    if (!leadId && (lead.gps_lat == null || lead.gps_lng == null)) return toast.error(c.needGps)
    if (!lead.company_name.trim()) return toast.error(c.companyRequired)
    if (lead.maps_url && !MAPS_RE.test(lead.maps_url.trim())) return toast.error(c.mapsBad)
    setSaving(true)
    try {
      await post({ action: 'save-lead', id: leadId || undefined, lead })
      toast.success(c.leadSaved)
      if (leadId) { setEditingLead(false); setSheet('') } else { setLead(blankLead()); setCardPreview(''); setSheet(''); setTab('leads') }
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const pasteMaps = async () => {
    try { const text = (await navigator.clipboard.readText()).trim(); if (text) setLead(v => ({ ...v, maps_url: text })) } catch { /* clipboard blocked: the seller types or long-presses to paste */ }
  }

  const startVoice = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast.error(c.audioPermission)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      mediaRef.current = { stream, recorder }
      chunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        await transcribeAudio(blob)
      }
      recorder.start()
      setRecording(true)
    } catch { toast.error(c.audioPermission) }
  }

  const stopVoice = () => {
    mediaRef.current?.recorder.stop()
    setRecording(false)
  }

  const transcribeAudio = async blob => {
    setBusyAi(true)
    try {
      const mime = baseMime(blob.type) || 'audio/webm'
      const file = new File([blob], `meeting.${mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'webm'}`, { type: mime })
      const storedAudio = await uploadFile(file, 'meeting-audio')
      const { answer } = await callApi('/api/sales-ai', { task: 'voice-note', object_path: storedAudio.path, mime_type: storedAudio.mime_type, language: lang })
      setApproach(prev => ({ ...prev, audio_object_path:storedAudio.path, notes: [prev.notes, answer?.transcript].filter(Boolean).join('\n\n'), meeting_transcript: answer?.transcript || prev.meeting_transcript, meeting_summary: answer?.summary || '', ai_next_step: answer?.next_step || '', followup_date: answer?.followup_date || prev.followup_date }))
      toast.success(c.transcribe)
    } catch (error) { toast.error(error.message) }
    finally { setBusyAi(false) }
  }

  const analyzeTranscript = async () => {
    if (!approach.meeting_transcript.trim()) return toast.error(c.transcript)
    setBusyAi(true)
    try {
      const { answer } = await callApi('/api/sales-ai', { task: 'meeting-summary', text: approach.meeting_transcript, language: lang })
      setApproach(prev => ({ ...prev, meeting_summary: answer.summary || '', ai_next_step: answer.next_step || '', followup_date: answer.followup_date || prev.followup_date }))
    } catch (error) { toast.error(error.message) }
    finally { setBusyAi(false) }
  }

  const logContact = async contactInput => {
    setSaving(true)
    try {
      await post({ action: 'log-contact', contact: contactInput })
      toast.success(f.saved)
      setContactLeadId('')
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const saveApproach = async event => {
    event?.preventDefault()
    if (!approach.place.trim()) return toast.error(c.place)
    setSaving(true)
    try {
      const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && String(a || '').trim() !== ''
      const linked = leads.find(row => row.id === approach.lead_id)
        || leads.find(row => same(row.site_name, approach.site_name))
        || leads.find(row => same(row.company_name, approach.company_name) && (!approach.site_name || same(row.site_name, approach.site_name)))
      const { client_response: clientResponse, response_tag: responseTag, ...approachFields } = approach
      const body = { ...approachFields, lead_id: linked?.id || null, meishi_photo_url: '' }
      await post({ action: 'save-approach', approach: body })
      if (linked) await post({ action: 'log-contact', contact: { lead_id: linked.id, happened_at: approach.work_date, channel: 'visit', body: [approach.outcome && c.outcomes[approach.outcome], approach.meeting_summary || approach.notes || ''].filter(Boolean).join(' · '), client_response: clientResponse, response_tag: responseTag, next_followup_date: approach.followup_date || '' } })
      toast.success(c.saveApproach)
      setApproach(blankApproach()); setSheet('')
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const saveDailyReport = async event => {
    event.preventDefault()
    setSaving(true)
    try {
      await post({ action:'save-report', report:dailyReport })
      toast.success(c.reportSaved)
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const where = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve('')
    navigator.geolocation.getCurrentPosition(pos => resolve(`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`), () => resolve(''), { timeout: 8000, maximumAge: 60000 })
  })

  const startDay = async () => {
    setDayBusy(true)
    try { await post({ action: 'start-day', location: await where() }); toast.success(c.startDay) }
    catch (error) { toast.error(error.message) }
    finally { setDayBusy(false) }
  }

  const endDay = async () => {
    setDayBusy(true)
    try {
      await post({ action: 'end-day', note: dayNote, travel_cost: dayTravel === '' ? undefined : Number(dayTravel), location: await where(), language: lang === 'ja' ? 'ja' : 'pt' })
      setDayNote(''); setDayTravel(''); setSheet('')
      toast.success(c.reportSaved)
    } catch (error) { toast.error(error.message) }
    finally { setDayBusy(false) }
  }

  // The server hands back a one-time Storage URL; the file goes straight to
  // Storage, so big photos, PDFs and recordings skip the 4.5 MB function limit.
  const uploadFile = async (file, purpose) => {
    if (!file) throw new Error(c.pdfOnly)
    if (file.size > MAX_MB[purpose] * 1024 * 1024) throw new Error(c.tooBig(MAX_MB[purpose]))
    const mime = baseMime(file.type)
    const slot = await callApi('/api/sales-files', { purpose, mime_type: mime, size: file.size })
    const put = await fetch(slot.upload_url, { method: 'PUT', headers: { 'Content-Type': slot.mime_type, 'x-upsert': 'false' }, body: file })
    if (!put.ok) throw new Error(c.unavailable)
    return { path: slot.path, mime_type: slot.mime_type }
  }

  const uploadContractPdf = async file => {
    if (!file) return
    if (baseMime(file.type) !== 'application/pdf') return toast.error(c.pdfOnly)
    setSaving(true)
    try {
      const result = await uploadFile(file, 'contract')
      setContract(prev => ({ ...prev, signed_pdf_object_path: result.path, signed_pdf_name: file.name }))
      toast.success(file.name)
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const submitContract = async event => {
    event.preventDefault()
    if (!contract.lead_id || !contract.signed_pdf_object_path) return toast.error(c.signedPdf)
    setSaving(true)
    try {
      await post({ action: 'submit-contract', contract })
      toast.success(c.submitted)
      setContract(prev => ({ ...prev, lead_id: '', signed_pdf_object_path: '', signed_pdf_name: '', base_monthly_amount: '', commission_value: '' }))
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const runFunnelAI = async () => {
    setBusyAi(true)
    try {
      const context = JSON.stringify({ metrics, leads: leads.slice(0, 60), quotes: data?.quotes?.slice(0, 60), contracts: data?.contracts?.slice(0, 60), followups: followups.slice(0, 30) })
      const { answer } = await callApi('/api/sales-ai', { task: 'funnel-review', text: context, language: lang })
      setAiResult(answer)
    } catch (error) { toast.error(error.message) }
    finally { setBusyAi(false) }
  }

  const editLead = row => {
    setLead({ ...blankLead(), ...row }); setLeadId(row.id); setEditingLead(false); setContactLeadId(''); setCardUrl(''); setSheet('lead')
    if (row.business_card_object_path) {
      fetch(`/api/sales-files?path=${encodeURIComponent(row.business_card_object_path)}`, { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : null).then(r => { if (r?.url) setCardUrl(r.url) }).catch(() => {})
    }
  }

  const openDeal = (row, contact = false) => setDealView({ id: row.id, contact })
  const markFollowup = row => openDeal(row, true)
  const openEditLead = row => { setLead({ ...blankLead(), ...row }); setLeadId(row.id); setEditingLead(true); setContactLeadId(''); setSheet('lead') }

  const openVisit = row => {
    setApproach({ ...blankApproach(), ...(row ? { lead_id: row.id, company_name: row.company_name || '', site_name: row.site_name || '', contact_name: row.contact_name || '', place: row.site_name || row.company_name || '' } : {}) })
    setSheet('visit')
  }

  const openSignedPdf = async contractRow => {
    try {
      const url = `/api/sales-files?path=${encodeURIComponent(contractRow.signed_pdf_object_path)}&submission_id=${encodeURIComponent(contractRow.id)}`
      const response = await fetch(url, { credentials: 'same-origin' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || c.open)
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (error) { toast.error(error.message) }
  }

  const Field = ({ label, field, value = lead[field], onChange = e => setLead(prev => ({ ...prev, [field]: e.target.value })), type = 'text', ...rest }) => <label className="form-group"><span>{label}</span><input type={type} value={value ?? ''} onChange={onChange} {...rest} /></label>
  const quoteAlerts = quoteRequestsToSend(data).length + quoteRequestsWaiting(data).length
  const bellCount = (data?.notifications?.length || 0) + counts.overdue + counts.today + quoteAlerts
  const selectedLead = leads.find(row => row.id === leadId)
  const deals = useMemo(() => buildDeals(data, today), [data, today])
  const dayState = todayRow?.closed_at ? 'closed' : todayRow?.started_at ? 'working' : 'idle'

  const LeadRow = ({ row, info, action }) => {
    const mapUrl = leadMapUrl(row)
    return <div className="sp-lead-row">
      <button type="button" className="sp-lead-main" onClick={() => openDeal(row)}>
        <span className={`sp-stage-dot is-${row.stage}`} aria-hidden="true" />
        <span className="sp-lead-text">
          <strong>{row.site_name || row.company_name}</strong>
          <small>{[row.site_name && row.company_name !== row.site_name ? row.company_name : '', row.contact_name, c.stages[row.stage] || row.stage].filter(Boolean).join(' · ')}</small>
          {info && <FollowupChip info={info} f={f} />}
        </span>
      </button>
      <div className="sp-lead-actions">
        {row.contact_phone && <a className="sp-round-btn" href={`tel:${row.contact_phone}`} aria-label={c.call} title={c.call}>📞</a>}
        {mapUrl && <a className="sp-round-btn" href={mapUrl} target="_blank" rel="noreferrer" aria-label={c.map} title={c.map}>📍</a>}
        {action}
      </div>
    </div>
  }

  const gpsChip = <div className={`sp-gps is-${gps.state}`} role="status">
    <span aria-hidden="true">{gps.state === 'ok' ? '✓' : gps.state === 'fail' ? '!' : '📍'}</span>
    <span>{gps.state === 'ok' ? c.gpsOk(gps.acc) : gps.state === 'fail' ? c.gpsFail : gps.state === 'getting' ? c.gpsGetting : c.gps}</span>
    {(gps.state === 'fail' || gps.state === 'idle') && <button type="button" className="fa-btn fa-btn-sm" onClick={captureGps}>{gps.state === 'fail' ? c.gpsRetry : c.useGps}</button>}
  </div>

  const mapsField = <div className="form-group sp-maps-field">
    <span>{c.mapsLink}</span>
    <div className="sp-input-row">
      <input type="url" inputMode="url" placeholder="https://maps.app.goo.gl/…" value={lead.maps_url || ''} onChange={e => setLead(v => ({ ...v, maps_url: e.target.value }))} />
      <button type="button" className="fa-btn fa-btn-sm" onClick={pasteMaps}>{c.paste}</button>
    </div>
    <small className="sp-hint">{c.mapsHint}</small>
    <div className="sp-chip-row">
      {lead.gps_lat != null && <a className="fa-btn fa-btn-sm" href={mapsSearch(lead.gps_lat, lead.gps_lng)} target="_blank" rel="noreferrer">🗺 {c.openMaps}</a>}
      {lead.gps_lat != null && !lead.maps_url && <button type="button" className="fa-btn fa-btn-sm" onClick={() => setLead(v => ({ ...v, maps_url: `https://www.google.com/maps?q=${Number(v.gps_lat).toFixed(6)},${Number(v.gps_lng).toFixed(6)}` }))}>{c.useGps}</button>}
    </div>
  </div>

  const leadFields = <div className="sp-form">
    {Field({ label: `${c.company} *`, field: 'company_name' })}{Field({ label: c.site, field: 'site_name' })}
    <div className="sp-two">{Field({ label: c.contact, field: 'contact_name' })}{Field({ label: c.role, field: 'contact_title' })}</div>
    <div className="sp-two">{Field({ label: c.phone, field: 'contact_phone', type: 'tel', inputMode: 'tel' })}{Field({ label: c.email, field: 'contact_email', type: 'email' })}</div>
    {Field({ label: c.address, field: 'address' })}
    {mapsField}
    <div className="form-group"><span>{c.followupDate}</span><input type="date" min={today} value={lead.next_followup_date || ''} onChange={e => setLead(v => ({ ...v, next_followup_date: e.target.value }))} />
      <div className="sp-chip-row">{f.quick.map(([label, n]) => <button type="button" key={label} className="fa-chip" onClick={() => setLead(v => ({ ...v, next_followup_date: new Date(Date.parse(`${today}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10) }))}>{label}</button>)}</div>
    </div>
    <label className="form-group"><span>{c.followupNote}</span><textarea rows="2" value={lead.notes || ''} onChange={e => setLead(v => ({ ...v, notes: e.target.value }))} /></label>
    <details className="sp-details"><summary>{c.details}</summary>
      <div className="sp-two">{Field({ label: f.firstContact, field: 'first_contact_date', type: 'date' })}{Field({ label: c.region, field: 'region' })}</div>
      <div className="sp-two">
        <label className="form-group"><span>{c.source}</span><select value={lead.marketing_channel_id || ''} onChange={e=>setLead(v=>({...v,marketing_channel_id:e.target.value,marketing_campaign_id:''}))}><option value="">—</option>{data?.marketing?.channels?.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="form-group"><span>{c.campaign}</span><select value={lead.marketing_campaign_id || ''} onChange={e=>setLead(v=>({...v,marketing_campaign_id:e.target.value}))}><option value="">—</option>{data?.marketing?.campaigns?.filter(row=>!lead.marketing_channel_id || row.channel_id===lead.marketing_channel_id).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      </div>
    </details>
  </div>

  const tabs = [
    { key: 'home', label: c.home, icon: 'home' },
    { key: 'leads', label: c.leads, icon: 'funnel', badge: 0 },
    { key: 'followups', label: c.followups, icon: 'followups', badge: counts.overdue + counts.today },
    { key: 'more', label: c.more, icon: 'more' },
  ]
  const menuItems = [
    { key: 'clients', icon: '👥', label: lang === 'ja' ? '自分の顧客' : 'My clients', hint: lang === 'ja' ? '全顧客と状況' : 'Every client and its stage' },
    { key: 'quotes', icon: '📝', label: lang === 'ja' ? '見積もり依頼' : 'Quote requests', hint: lang === 'ja' ? 'お客様からの依頼・上乗せ額' : 'From your clients · add your extra', badge: quoteAlerts },
    { key: 'commissions', icon: '💴', label: lang === 'ja' ? 'コミッションと支払い' : 'Commissions & payments', hint: lang === 'ja' ? '受取予定・受取済み' : 'To receive and received' },
    { key: 'approaches', icon: '📝', label: c.menuReports, hint: c.menuHint.approaches },
    { key: 'contracts', icon: '✍️', label: c.menuContracts, hint: c.menuHint.contracts },
    { key: 'goals', icon: '🎯', label: c.menuGoals, hint: c.menuHint.goals },
    { key: 'kpi', icon: '📈', label: c.menuKpi, hint: c.menuHint.kpi },
    { key: 'ai', icon: '✦', label: c.menuAi, hint: c.menuHint.ai, onClick: () => setSheet('ai') },
  ]

  const dayCard = <section className={`sp-day is-${dayState}`}>
    <div className="sp-day-icon" aria-hidden="true">{dayState === 'working' ? '●' : dayState === 'closed' ? '✓' : '▶'}</div>
    <div className="sp-day-copy">
      <span className="sp-kicker">{c.myDay}</span>
      <strong>{dayState === 'idle' ? c.startDay : dayState === 'working' ? c.dayStarted(todayRow.started_at) : c.dayEnded(todayRow.started_at, todayRow.ended_at)}</strong>
      {dayState === 'idle' && <small>{c.dayNotStarted}</small>}
    </div>
    {dayState === 'idle' && <button type="button" className="fa-btn fa-btn-primary" disabled={dayBusy} onClick={startDay}>{c.startDay}</button>}
    {dayState === 'working' && <button type="button" className="fa-btn fa-btn-dark" disabled={dayBusy} onClick={() => setSheet('endDay')}>{c.endDaySheet}</button>}
    {dayState === 'closed' && <button type="button" className="fa-btn fa-btn-sm" disabled={dayBusy} onClick={startDay}>{c.reopen}</button>}
    {todayRow?.ai_report && <details className="sp-day-report"><summary>{c.dayReport}</summary><div className="sales-ai-result">{todayRow.ai_report}</div></details>}
  </section>

  return (
    <FieldAppShell kicker={c.kicker} userName={user.name} lang={lang} bellCount={bellCount} onBell={() => setSheet('bell')}
      menuItems={menuItems} onLogout={logout} logoutLabel={c.logout} tabs={tabs} tab={tab} onTab={key => { setTab(key); window.scrollTo(0, 0) }}
      onPlus={openNewLead} plusLabel={c.newLeadShort}>
      {loading && !data ? <div className="fa-card fa-muted">{c.loading}</div> : !data ? <div className="fa-card fa-muted">{c.unavailable}</div> : <>

        {tab === 'home' && <div className="fa-stack fa-dash">
          {dayCard}
          <QuoteRequestsAlert data={data} lang={lang} onOpen={() => { setTab('quotes'); window.scrollTo(0, 0) }} />
          <div className="sp-cta-grid">
            <button type="button" className="sp-cta is-main" onClick={openNewLead}>
              <span className="sp-cta-icon" aria-hidden="true">📇</span>
              <span><strong>{c.newLeadShort}</strong><small>{c.cardStep} + GPS</small></span>
            </button>
            <button type="button" className="sp-cta" onClick={() => openVisit(null)}><span className="sp-cta-icon" aria-hidden="true">📝</span><span><strong>{c.logVisit}</strong></span></button>
            <button type="button" className="sp-cta" onClick={() => setTab('followups')}><span className="sp-cta-icon" aria-hidden="true">↻</span><span><strong>{c.followups}</strong>{counts.needsAction > 0 && <small>{counts.needsAction}</small>}</span></button>
          </div>

          <NextFollowups queue={queue} lang={lang} onOpen={row => openDeal(row)} onLog={markFollowup} logLabel={f.logContact} />
          <MyNumbers data={data} today={today} lang={lang} />
          <CommissionsCard data={data} metrics={metrics} lang={lang} onDetails={() => setTab('commissions')} />

          <section className="fa-card">
            <div className="fa-card-head"><h2>{f.goalsMonth}</h2><button type="button" className="fa-link" onClick={() => setTab('goals')}>{c.open} ›</button></div>
            <GoalBars goal={myGoal} actual={myResults} today={today} f={f} compact />
          </section>
          <ClientList className="fa-wide" deals={deals} lang={lang} onOpen={row => openDeal(row)} limit={6} onSeeAll={() => setTab('clients')} seeAllLabel={c.seeAll} />
        </div>}

        {tab === 'clients' && <div className="fa-stack"><ClientList deals={deals} lang={lang} onOpen={row => openDeal(row)} /></div>}
        {tab === 'quotes' && <div className="fa-stack">
          <div className="fa-screen-head"><h2>{lang === 'ja' ? '見積もり依頼' : 'Quote requests'}</h2></div>
          <SellerQuoteRequests data={data} lang={lang} onChanged={load} />
        </div>}
        {tab === 'commissions' && <div className="fa-stack">
          <CommissionsCard data={data} metrics={metrics} lang={lang} />
          <SellerContractCommissions data={data} lang={lang} />
        </div>}

        {tab === 'leads' && <div className="fa-stack sp-funnel-tab">
          <div className="fa-screen-head"><h2>{c.leads}</h2><button type="button" className="fa-btn fa-btn-primary fa-btn-sm" onClick={openNewLead}>+ {c.newLeadShort}</button></div>
          <SalesFunnel data={data} lang={lang} today={today} onChanged={load} onAddLead={openNewLead} openLeadId={dealView?.id || ''} onOpenLead={id => setDealView(id ? { id } : null)} />
        </div>}

        {tab === 'followups' && <div className="fa-stack">
          <div className="fa-screen-head"><h2>{c.followups}</h2></div>
          <div className="sp-chip-row">{[['action', `${f.alertTitle} (${counts.needsAction})`], ['all', `${c.all} (${queue.length})`]].map(([key, label]) => <button type="button" key={key} className={`fa-chip${followFilter === key ? ' is-active' : ''}`} onClick={() => setFollowFilter(key)}>{label}</button>)}</div>
          <section className="fa-card is-list">
            {queue.filter(row => followFilter === 'all' || ['overdue', 'today', 'stale', 'soon', 'missing'].includes(row.info.status)).map(({ lead: row, info }) => <LeadRow key={row.id} row={row} info={info} action={<button type="button" className="fa-btn fa-btn-sm fa-btn-primary" onClick={() => markFollowup(row)}>{f.logContact}</button>} />)}
            {queue.length === 0 && <p className="fa-muted">{c.noFollowups}</p>}
          </section>
        </div>}

        {tab === 'approaches' && <div className="fa-stack">
          <div className="fa-screen-head"><h2>{c.menuReports}</h2><button type="button" className="fa-btn fa-btn-primary fa-btn-sm" onClick={() => openVisit(null)}>+ {c.logVisit}</button></div>
          {dayCard}
          <section className="fa-card is-list">
            {(data.approaches || []).map(row => <div className="sp-history-row" key={row.id}>
              <span className="sp-date">{String(row.work_date || '').slice(5)}</span>
              <div><strong>{row.site_name || row.company_name || row.place}</strong><small>{[row.outcome && (c.outcomes[row.outcome] || row.outcome), row.duration_minutes ? `${row.duration_minutes} min` : '', Number(row.travel_cost) ? yen(row.travel_cost) : ''].filter(Boolean).join(' · ')}</small>{row.meeting_summary && <p>{row.meeting_summary}</p>}</div>
            </div>)}
            {!(data.approaches || []).length && <p className="fa-muted">—</p>}
          </section>
          <section className="fa-card is-list">
            <div className="fa-card-head"><h2>{c.dayReport}</h2></div>
            {(data.reports || []).map(row => <details className="sp-history-row is-report" key={row.id}><summary><span className="sp-date">{String(row.work_date || '').slice(5)}</span><span><strong>{row.hours_worked || 0}h · {yen(row.travel_cost)}</strong><small>{[row.started_at, row.ended_at].filter(Boolean).join('–')}</small></span></summary>{(row.ai_report || row.summary) && <div className="sales-ai-result">{row.ai_report || row.summary}</div>}</details>)}
          </section>
          <details className="fa-card sp-details"><summary>{c.hoursLog}</summary>
            <form onSubmit={saveDailyReport} className="sp-form">
              <div className="sp-two">{Field({ label: c.date, field: 'work_date', type: 'date', value: dailyReport.work_date, onChange: e=>setDailyReport(v=>({...v,work_date:e.target.value})) })}{Field({ label: c.hours, field: 'hours_worked', type: 'number', value: dailyReport.hours_worked, onChange: e=>setDailyReport(v=>({...v,hours_worked:e.target.value})) })}</div>
              {Field({ label: c.travel, field: 'travel_cost', type: 'number', value: dailyReport.travel_cost, onChange: e=>setDailyReport(v=>({...v,travel_cost:e.target.value})) })}
              <label className="form-group"><span>{c.notes}</span><textarea rows="3" value={dailyReport.summary} onChange={e=>setDailyReport(v=>({...v,summary:e.target.value}))}/></label>
              <button className="fa-btn fa-btn-primary fa-btn-block" disabled={saving}>{saving ? c.saving : c.saveApproach}</button>
            </form>
          </details>
        </div>}

        {tab === 'kpi' && <div className="fa-stack sp-wide"><SalesKpiPanel data={data} lang={lang} today={today} channels={data.marketing?.channels || []} /></div>}
        {tab === 'goals' && <div className="fa-stack"><div className="fa-screen-head"><h2>{f.goalsMonth} · {month}</h2></div><section className="fa-card"><GoalBars goal={myGoal} actual={myResults} today={today} f={f} /></section></div>}

        {tab === 'contracts' && <div className="fa-stack">
          <div className="fa-screen-head"><h2>{c.contracts}</h2></div>
          <form className="fa-card sp-form" onSubmit={submitContract}>
            <div className="fa-card-head"><h2>{c.prepare}</h2></div>
            <label className="form-group"><span>{c.lead}</span><select value={contract.lead_id} onChange={e => setContract(v => ({ ...v, lead_id: e.target.value }))}><option value="">—</option>{leads.filter(row => !['won','lost'].includes(row.stage)).map(row => <option key={row.id} value={row.id}>{row.site_name || row.company_name}</option>)}</select></label>
            <div className="sp-two">
              <label className="form-group"><span>{c.service}</span><select value={contract.service_type} onChange={e => setContract(v => ({ ...v, service_type: e.target.value }))}>{['Basic Cleaning','Deep Cleaning','Range Hood','AC Cleaning','Grease Trap','Window Cleaning','Floor Wax','Spot Cleaning'].map(x => <option key={x}>{x}</option>)}</select></label>
              <label className="form-group"><span>{c.billing}</span><select value={contract.billing_type} onChange={e => setContract(v => ({ ...v, billing_type: e.target.value }))}><option value="fixed_monthly">{c.monthlyFixed}</option><option value="per_visit">{c.perVisit}</option></select></label>
            </div>
            {contract.billing_type === 'per_visit' && <div className="sp-two"><label className="form-group"><span>{c.priceVisit}</span><input type="number" min="0" value={contract.price_per_visit} onChange={e => setContract(v => ({ ...v, price_per_visit: e.target.value, base_monthly_amount: String(Number(e.target.value || 0) * Number(v.visits_per_month || 0)) }))}/></label><label className="form-group"><span>{c.visits}</span><input type="number" min="0" value={contract.visits_per_month} onChange={e => setContract(v => ({ ...v, visits_per_month: e.target.value, base_monthly_amount: String(Number(v.price_per_visit || 0) * Number(e.target.value || 0)) }))}/></label></div>}
            <div className="sp-two">
              <label className="form-group"><span>{c.monthlyBase}</span><input type="number" min="0" value={contract.base_monthly_amount} onChange={e => setContract(v => ({ ...v, base_monthly_amount: e.target.value }))}/></label>
              <label className="form-group"><span>{c.hoursVisit}</span><input type="number" min="0" step="0.5" value={contract.hours_per_visit} onChange={e => setContract(v => ({ ...v, hours_per_visit: e.target.value }))}/></label>
            </div>
            <div className="sp-two">
              <label className="form-group"><span>{c.commissionType}</span><select value={contract.commission_type} onChange={e => setContract(v => ({ ...v, commission_type: e.target.value }))}><option value="percent">{c.percent}</option><option value="fixed">{c.fixed}</option></select></label>
              <label className="form-group"><span>{c.commissionValue}</span><input type="number" min="0" step="0.1" value={contract.commission_value} onChange={e => setContract(v => ({ ...v, commission_value: e.target.value }))}/></label>
            </div>
            <div className="sp-price"><span>{c.totalClient}</span><strong>{yen(monthlyClientPrice)} {c.perMonth}</strong><small>{c.commissionType}: {yen(commissionExtra)}{openContract?.company_name ? ` · ${openContract.company_name}` : ''}</small></div>
            <label className="form-group sp-file"><span>{c.signedPdf} *</span><input type="file" accept="application/pdf,.pdf" onChange={e => uploadContractPdf(e.target.files?.[0])}/>{contract.signed_pdf_name && <small>✓ {contract.signed_pdf_name}</small>}</label>
            {data.contracts?.filter(row => row.status === 'changes_requested' && row.salesperson_id === user.id).map(row => <div className="sales-review-note" key={row.id}><strong>{row.company_name}</strong><p>{row.admin_note}</p></div>)}
            <button className="fa-btn fa-btn-primary fa-btn-block" type="submit" disabled={saving || !contract.signed_pdf_object_path}>{saving ? c.saving : c.submit}</button>
          </form>
          <section className="fa-card is-list"><div className="fa-card-head"><h2>{c.activeContracts}</h2></div>
            {(data.contracts || []).map(row => <div className="sp-history-row" key={row.id}><span className={`fa-pill is-${row.status}`}>{c.statuses[row.status] || row.status}</span><div><strong>{row.site_name || row.company_name}</strong><small>{yen(row.client_monthly_total)} {c.perMonth} · {c.commission}: {yen(row.commission_amount)}</small>{row.admin_note && <p>{row.admin_note}</p>}</div>{row.signed_pdf_object_path && <button type="button" className="fa-btn fa-btn-sm" onClick={() => openSignedPdf(row)}>PDF</button>}</div>)}
            {!data.contracts?.length && <p className="fa-muted">{c.noContracts}</p>}
          </section>
          <SellerContractCommissions data={data} lang={lang} />
        </div>}
      </>}

      {dealView && deals.find(d => d.lead.id === dealView.id) && <ClientPage key={dealView.id} deal={deals.find(d => d.lead.id === dealView.id)} data={data} lang={lang} today={today}
        startWithContact={dealView.contact} onClose={() => setDealView(null)} onChanged={load} onEdit={openEditLead} onLogVisit={row => openVisit(row)} />}

      {sheet === 'newLead' && <Sheet title={c.addLead} onClose={() => !busyAi && !saving && setSheet('')}>
        <form onSubmit={saveLead} className="sp-form">
          <div className={`sp-card-capture${cardPreview ? ' has-photo' : ''}`}>
            <input ref={cardRef} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => runCardAI(e.target.files?.[0])} />
            {cardPreview ? <img src={cardPreview} alt={c.card} /> : <div className="sp-card-empty"><span aria-hidden="true">📇</span><strong>{c.cardStep} <em>({c.required})</em></strong><small>{c.cardStepHint}</small></div>}
            <button type="button" className={`fa-btn ${cardPreview ? 'fa-btn-sm' : 'fa-btn-primary fa-btn-block'}`} disabled={busyAi} onClick={() => cardRef.current?.click()}>{busyAi ? c.reading : cardPreview ? c.retake : `📷 ${c.takePhoto}`}</button>
          </div>
          {gpsChip}
          {leadFields}
          <button disabled={saving || busyAi || !lead.business_card_object_path || lead.gps_lat == null} className="fa-btn fa-btn-primary fa-btn-block fa-btn-lg" type="submit">{saving ? c.saving : c.save}</button>
          {(!lead.business_card_object_path || lead.gps_lat == null) && <p className="sp-hint is-center">{!lead.business_card_object_path ? c.needCard : c.needGps}</p>}
        </form>
      </Sheet>}

      {sheet === 'lead' && selectedLead && <Sheet title={selectedLead.site_name || selectedLead.company_name} onClose={() => { setSheet(''); setLeadId(''); setContactLeadId('') }}>
        <div className="sp-lead-top">
          <div className="sp-lead-card">{cardUrl ? <a href={cardUrl} target="_blank" rel="noreferrer"><img src={cardUrl} alt={c.card} /></a> : <span>{selectedLead.business_card_object_path ? '📇' : c.noCard}</span>}</div>
          <div className="sp-lead-meta">
            <strong>{selectedLead.company_name}</strong>
            <small>{[selectedLead.contact_name, selectedLead.contact_title].filter(Boolean).join(' · ')}</small>
            <FollowupChip info={statusOf.get(selectedLead.id)} f={f} />
          </div>
        </div>
        <div className="sp-quick-actions">
          {selectedLead.contact_phone && <a className="sp-qa" href={`tel:${selectedLead.contact_phone}`}><span>📞</span>{c.call}</a>}
          {leadMapUrl(selectedLead) && <a className="sp-qa" href={leadMapUrl(selectedLead)} target="_blank" rel="noreferrer"><span>📍</span>{c.map}</a>}
          <button type="button" className="sp-qa" onClick={() => setContactLeadId(selectedLead.id)}><span>💬</span>{f.logContact}</button>
          <button type="button" className="sp-qa" onClick={() => openVisit(selectedLead)}><span>📝</span>{c.logVisit}</button>
        </div>
        {!['won', 'lost'].includes(selectedLead.stage) && <div className="form-group"><span>{c.stage}</span><div className="sp-chip-row">{SELLER_STAGES.map(key => <button type="button" key={key} className={`fa-chip${selectedLead.stage === key ? ' is-active' : ''}`} disabled={saving} onClick={async () => { if (selectedLead.stage === key) return; setSaving(true); try { await post({ action: 'save-lead', id: selectedLead.id, lead: { stage: key, company_name: selectedLead.company_name } }) } catch (error) { toast.error(error.message) } finally { setSaving(false) } }}>{c.stages[key]}</button>)}</div></div>}
        {contactLeadId === selectedLead.id && <div className="fa-card is-inset"><ContactLogForm key={selectedLead.id} lead={selectedLead} today={today} f={f} busy={saving} onSave={logContact} onCancel={() => setContactLeadId('')} /></div>}
        {!editingLead ? <div className="sp-info-list">
          {[[c.phone, selectedLead.contact_phone], [c.email, selectedLead.contact_email], [c.address, selectedLead.address], [c.followupDate, selectedLead.next_followup_date], [c.followupNote, selectedLead.notes], [c.gps, selectedLead.gps_lat != null ? `${Number(selectedLead.gps_lat).toFixed(5)}, ${Number(selectedLead.gps_lng).toFixed(5)}${selectedLead.gps_accuracy ? ` (±${Math.round(selectedLead.gps_accuracy)} m)` : ''}` : ''], [c.mapsLink, selectedLead.maps_url]].filter(([, v]) => v).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
          <button type="button" className="fa-btn fa-btn-block" onClick={() => setEditingLead(true)}>✎ {c.editLead}</button>
        </div> : <form onSubmit={saveLead} className="sp-form">{leadFields}<div className="sp-two"><button type="button" className="fa-btn" onClick={() => { setLead({ ...blankLead(), ...selectedLead }); setEditingLead(false) }}>{f.cancel}</button><button className="fa-btn fa-btn-primary" disabled={saving}>{saving ? c.saving : c.save}</button></div></form>}
        <ContactHistory leadId={selectedLead.id} touchpoints={touchpoints} f={f} />
      </Sheet>}

      {sheet === 'visit' && <Sheet title={c.approachLog} onClose={() => !saving && setSheet('')}>
        <form className="sp-form" onSubmit={saveApproach}>
          <label className="form-group"><span>{c.linkedLead}</span><select value={approach.lead_id} onChange={e => { const picked = leads.find(row => row.id === e.target.value); setApproach(v => ({ ...v, lead_id: e.target.value, company_name: picked?.company_name || v.company_name, site_name: picked?.site_name || v.site_name, contact_name: picked?.contact_name || v.contact_name, place: v.place || picked?.site_name || picked?.company_name || '' })) }}><option value="">{c.none}</option>{leads.filter(row => !['won', 'lost'].includes(row.stage)).map(row => <option key={row.id} value={row.id}>{row.site_name || row.company_name}</option>)}</select></label>
          {Field({ label: `${c.place} *`, field: 'place', value: approach.place, onChange: e => setApproach(v => ({ ...v, place: e.target.value })) })}
          {!approach.lead_id && <div className="sp-two">{Field({ label: c.company, field: 'company_name', value: approach.company_name, onChange: e => setApproach(v => ({ ...v, company_name: e.target.value })) })}{Field({ label: c.contact, field: 'contact_name', value: approach.contact_name, onChange: e => setApproach(v => ({ ...v, contact_name: e.target.value })) })}</div>}
          <div className="form-group"><span>{c.outcome}</span><div className="sp-chip-row">{Object.entries(c.outcomes).map(([key, label]) => <button type="button" key={key} aria-pressed={approach.outcome === key} className={`fa-chip${approach.outcome === key ? ' is-active' : ''}`} onClick={() => setApproach(v => ({ ...v, outcome: v.outcome === key ? '' : key }))}>{label}</button>)}</div></div>
          <label className="form-group"><span>{c.clientSaid}</span><textarea rows="2" value={approach.client_response} onChange={e => setApproach(v => ({ ...v, client_response: e.target.value }))}/></label>
          <div className="form-group"><span>{c.answerType}</span><div className="sp-chip-row">{RESPONSE_TAGS.map(key => <button type="button" key={key} aria-pressed={approach.response_tag === key} className={`fa-chip${approach.response_tag === key ? ' is-active' : ''}`} onClick={() => setApproach(v => ({ ...v, response_tag: v.response_tag === key ? '' : key }))}>{f.responseTags[key]}</button>)}</div></div>
          <div className="sp-voice"><input ref={audioRef} hidden type="file" accept="audio/*" onChange={async e => { const file=e.target.files?.[0]; if(file) await transcribeAudio(file); e.target.value='' }}/>
            {!recording ? <button type="button" className="fa-btn" disabled={busyAi} onClick={startVoice}>🎙 {c.record}</button> : <button type="button" className="fa-btn fa-btn-danger" onClick={stopVoice}>■ {c.recording}</button>}
            <button type="button" className="fa-btn fa-btn-ghost" onClick={() => audioRef.current?.click()}>{c.audio}</button>
          </div>
          <label className="form-group"><span>{c.notes}</span><textarea rows="3" value={approach.notes} onChange={e => setApproach(v => ({ ...v, notes: e.target.value }))}/></label>
          {approach.meeting_summary && <div className="sales-ai-result"><strong>{c.summary}</strong><p>{approach.meeting_summary}</p><strong>{c.nextStep}</strong><p>{approach.ai_next_step}</p></div>}
          <div className="form-group"><span>{c.followupDate}</span><input type="date" value={approach.followup_date} onChange={e => setApproach(v => ({ ...v, followup_date: e.target.value }))}/>
            <div className="sp-chip-row">{f.quick.map(([label, n]) => <button type="button" key={label} className="fa-chip" onClick={() => setApproach(v => ({ ...v, followup_date: new Date(Date.parse(`${v.work_date || today}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10) }))}>{label}</button>)}</div>
          </div>
          <details className="sp-details"><summary>{c.visitDetails}</summary>
            <div className="sp-two">{Field({ label: c.date, field: 'work_date', type: 'date', value: approach.work_date, onChange: e => setApproach(v => ({ ...v, work_date: e.target.value })) })}{Field({ label: c.duration, field: 'duration_minutes', type: 'number', value: approach.duration_minutes, onChange: e => setApproach(v => ({ ...v, duration_minutes: e.target.value })) })}</div>
            <div className="sp-two">{Field({ label: c.travel, field: 'travel_cost', type: 'number', value: approach.travel_cost, onChange: e => setApproach(v => ({ ...v, travel_cost: e.target.value })) })}<label className="form-group"><span>{c.hoursSpent}</span><input type="number" min="0" step="0.25" value={approach.hours_spent} onChange={e=>setApproach(v=>({...v,hours_spent:e.target.value}))}/></label></div>
            <label className="form-group"><span>{c.transcript}</span><textarea rows="4" value={approach.meeting_transcript} onChange={e => setApproach(v => ({ ...v, meeting_transcript: e.target.value }))}/></label>
            <button type="button" className="fa-btn" disabled={busyAi} onClick={analyzeTranscript}>{busyAi ? c.saving : c.transcribe}</button>
          </details>
          <button type="submit" className="fa-btn fa-btn-primary fa-btn-block fa-btn-lg" disabled={saving}>{saving ? c.saving : c.saveApproach}</button>
        </form>
      </Sheet>}

      {sheet === 'endDay' && <Sheet title={c.endDaySheet} onClose={() => !dayBusy && setSheet('')}>
        <div className="sp-form">
          <p className="fa-muted">{c.endConfirm}</p>
          <label className="form-group"><span>{c.dayNote}</span><textarea rows="3" value={dayNote} onChange={e => setDayNote(e.target.value)} /></label>
          <label className="form-group"><span>{c.dayTravel}</span><input type="number" min="0" inputMode="numeric" value={dayTravel} onChange={e => setDayTravel(e.target.value)} /></label>
          <button type="button" className="fa-btn fa-btn-primary fa-btn-block fa-btn-lg" disabled={dayBusy} onClick={endDay}>{dayBusy ? c.writing : c.endDay}</button>
        </div>
      </Sheet>}

      {sheet === 'bell' && <Sheet title={c.notifications} onClose={() => setSheet('')}>
        {(counts.overdue + counts.today) > 0 && <button type="button" className="sp-bell-item is-alert" onClick={() => { setSheet(''); setFollowFilter('action'); setTab('followups') }}><span aria-hidden="true">↻</span><div><strong>{f.alertTitle}</strong><small>{[counts.overdue && `${counts.overdue} ${f.alertOverdue}`, counts.today && `${counts.today} ${f.alertToday}`].filter(Boolean).join(' · ')}</small></div><b>›</b></button>}
        {quoteAlerts > 0 && <QuoteRequestsAlert data={data} lang={lang} onOpen={() => { setSheet(''); setTab('quotes') }} />}
        <SalesInbox lang={lang} notifications={data?.notifications || []} onChanged={load} onOpenLead={id => { const row = leads.find(l => l.id === id); if (row) { setSheet(''); openDeal(row) } }} />
      </Sheet>}

      {sheet === 'ai' && <Sheet title={c.aiReview} onClose={() => setSheet('')}>
        <p className="fa-muted">{c.aiHint}</p>
        <button type="button" className="fa-btn fa-btn-primary fa-btn-block" disabled={busyAi} onClick={runFunnelAI}>{busyAi ? c.saving : `✦ ${c.searchAi}`}</button>
        {aiResult && <div className="sales-ai-result">{aiResult}</div>}
      </Sheet>}
    </FieldAppShell>
  )
}
