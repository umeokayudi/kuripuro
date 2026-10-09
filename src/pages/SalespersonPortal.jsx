import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import LanguageToggle from '../components/LanguageToggle'
import { AlertBanner, ContactHistory, ContactLogForm, FollowupChip, GoalBars, LastContactLine, followupCopy } from '../components/SalesFollowupParts'
import { alertCounts, followupQueue, goalFor, monthOf, monthResults } from '../lib/salesFollowup'

const COPY = {
  en: {
    title: 'Sales workspace', overview: 'Overview', leads: 'Leads', followups: 'Follow-ups', approaches: 'Reports', contracts: 'Contracts',
    today: 'Today', month: 'This month', approachesN: 'Approaches', leadsN: 'Leads', quotes: 'Quotes', active: 'Active contracts', hours: 'Hours this month', hoursSpent: 'Hours on approach',
    conversion: 'Approach → won', ticket: 'Average quote', commission: 'Commission accrued', due: 'Follow-ups due',
    addLead: 'New lead', scanCard: 'Scan business card', analyze: 'Read with AI', confirm: 'Review these details, correct them, then save the lead.',
    company: 'Company / restaurant', site: 'Location', contact: 'Contact person', role: 'Title', phone: 'Phone', email: 'Email', address: 'Address',
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
  },
  ja: {
    title: '営業ワークスペース', overview: '概要', leads: 'リード', followups: 'フォローアップ', approaches: '活動レポート', contracts: '契約',
    today: '本日', month: '今月', approachesN: '営業活動', leadsN: 'リード', quotes: '見積', active: '有効契約', hours: '今月の時間', hoursSpent: '営業活動時間',
    conversion: '成約率', ticket: '見積平均額', commission: '獲得コミッション', due: '対応期限',
    addLead: '新規リード', scanCard: '名刺を撮影', analyze: 'AIで読み取る', confirm: '内容を確認して修正し、保存してください。',
    company: '会社・店舗', site: '店舗名', contact: '担当者', role: '役職', phone: '電話', email: 'メール', address: '住所',
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
  },
}

const todayJapan = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
const yen = value => `¥${Math.round(Number(value || 0)).toLocaleString()}`
const fileAsBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
  reader.onerror = reject
  reader.readAsDataURL(file)
})

async function callApi(url, body) {
  const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Request failed')
  return result
}

const blankLead = () => ({ company_name: '', site_name: '', contact_name: '', contact_title: '', contact_phone: '', contact_email: '', address: '', source: 'visit', first_contact_date: todayJapan(), next_followup_date: '', notes: '', marketing_channel_id:'', marketing_campaign_id:'', business_card_object_path:'' })
const blankApproach = () => ({ work_date: todayJapan(), place: '', company_name: '', site_name: '', contact_name: '', contact_title: '', contact_phone: '', contact_email: '', notes: '', followup_note: '', followup_date: '', outcome: '', travel_cost: 0, duration_minutes: 0, hours_spent: 0, meeting_transcript: '', meeting_summary: '', ai_next_step: '', followup_status: 'open' })

export default function SalespersonPortal() {
  const { user, logout } = useAuth()
  const { lang } = useLang()
  const c = COPY[lang === 'ja' ? 'ja' : 'en']
  const [tab, setTab] = useState('overview')
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
      const response = await fetch('/api/sales-data?action=dashboard', { credentials: 'same-origin', cache: 'no-store' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not load sales data')
      setData(result)
    } catch (error) { toast.error(error.message) }
    finally { setLoading(false) }
  }, [])

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

  const runCardAI = async file => {
    if (!file) return
    setBusyAi(true)
    try {
      const base64 = await fileAsBase64(file)
      const { answer } = await callApi('/api/sales-ai', { task: 'business-card', base64, mime_type: file.type, language: lang })
      const upload = await uploadFile(file, 'business-card')
      setLead(prev => ({ ...prev, company_name:answer?.company_name || prev.company_name, site_name:answer?.site_name || prev.site_name, contact_name:answer?.contact_name || prev.contact_name, contact_title:answer?.contact_title || prev.contact_title, contact_phone:answer?.phone || prev.contact_phone, contact_email:answer?.email || prev.contact_email, address:answer?.address || prev.address, business_card_object_path:upload.path, first_contact_date: answer?.date || prev.first_contact_date }))
      setTab('leads')
      toast.success(c.confirm)
    } catch (error) { toast.error(error.message) }
    finally { setBusyAi(false); if (cardRef.current) cardRef.current.value = '' }
  }

  const saveLead = async event => {
    event?.preventDefault()
    if (!lead.company_name.trim()) return toast.error(c.companyRequired)
    setSaving(true)
    try {
      await post({ action: 'save-lead', id: leadId || undefined, lead })
      toast.success(c.save)
      setLead(blankLead()); setLeadId('')
      setTab('overview')
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
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
      const mime = blob.type || 'audio/webm'
      const file = new File([blob], `meeting.${mime.includes('mp4') ? 'm4a' : 'webm'}`, { type: mime })
      const base64 = await fileAsBase64(file)
      const storedAudio = await uploadFile(file, 'meeting-audio')
      const { answer } = await callApi('/api/sales-ai', { task: 'voice-note', base64, mime_type: mime, language: lang })
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
      const linked = leads.find(row => row.company_name === approach.company_name || row.site_name === approach.site_name)
      const body = { ...approach, lead_id: linked?.id || leadId || null, salesperson_id: user.id, meishi_photo_url:lead.business_card_object_path || '' }
      await post({ action: 'save-approach', approach: body })
      if (linked) await post({ action: 'log-contact', contact: { lead_id: linked.id, happened_at: approach.work_date, channel: 'visit', body: approach.meeting_summary || approach.notes || '', next_followup_date: approach.followup_date || '' } })
      toast.success(c.saveApproach)
      setApproach(blankApproach()); setTab('overview')
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const saveDailyReport = async event => {
    event.preventDefault()
    setSaving(true)
    try {
      await post({ action:'save-report', report:dailyReport })
      toast.success(c.saveApproach)
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const uploadFile = async (file, purpose) => {
    if (!file) return
    const base64 = await fileAsBase64(file)
    return callApi('/api/sales-files', { purpose, data: base64, mime_type: file.type })
  }

  const uploadContractPdf = async file => {
    if (!file) return
    if (file.type !== 'application/pdf') return toast.error('PDF only')
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
      setTab('overview')
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
    setLead({ ...blankLead(), ...row }); setLeadId(row.id); setTab('leads')
  }

  const markFollowup = row => {
    setContactLeadId(row.id); setTab('followups')
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

  const nav = [['overview', c.overview], ['leads', c.leads], ['followups', counts.needsAction ? `${c.followups} (${counts.needsAction})` : c.followups], ['goals', f.goals], ['approaches', c.approaches], ['contracts', c.contracts]]
  const Field = ({ label, field, value = lead[field], onChange = e => setLead(prev => ({ ...prev, [field]: e.target.value })), type = 'text' }) => <label className="form-group"><span>{label}</span><input type={type} value={value ?? ''} onChange={onChange} /></label>

  return (
    <div className="sales-portal">
      <header className="sales-portal-head">
        <div><div className="sales-kicker">KURIPURO · SALES</div><h1>{c.title}</h1><div className="sales-person-name">{user.name}</div></div>
        <div className="sales-portal-head-actions"><LanguageToggle variant="dark"/><button className="btn btn-sm" type="button" onClick={logout}>{c.logout}</button></div>
      </header>
      <nav className="sales-tabs">{nav.map(([key, label]) => <button type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}>{label}</button>)}</nav>

      {data && <AlertBanner counts={counts} f={f} onOpen={tab === 'followups' ? null : () => { setFollowFilter('action'); setTab('followups') }} />}
      {loading ? <div className="card">Loading…</div> : !data ? <div className="card">Sales data is unavailable. Sign in again or check the server setup.</div> : <>
        {tab === 'overview' && <>
          <div className="sales-metrics">
            {[[c.leadsN, metrics.leads || 0], [c.approachesN, metrics.approaches || 0], [c.quotes, metrics.quotes || 0], [c.active, metrics.active_contracts || 0], [c.conversion, `${Number(metrics.conversion_rate || 0).toFixed(1)}%`], [c.ticket, yen(metrics.quote_average)], [c.commission, yen(metrics.commission_pending)], [c.hours, `${Number(metrics.hours_this_month || 0).toFixed(1)}h`], [c.due, metrics.followups_due || 0]].map(([label, value]) => <div className="sales-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          <div className="sales-grid-two">
            <div className="card"><div className="card-title">{c.followups}</div>{queue.filter(row => row.info.status !== 'scheduled').slice(0, 6).map(({ lead: row, info }) => <div className="sales-row" key={row.id}><div><strong>{row.site_name || row.company_name}</strong><LastContactLine info={info} lead={row} f={f} /><FollowupChip info={info} f={f} /></div><button className="btn btn-sm" onClick={() => markFollowup(row)}>{f.logContact}</button></div>)}{queue.filter(row => row.info.status !== 'scheduled').length === 0 && <p className="sales-muted">{c.noFollowups}</p>}</div>
            <div className="card"><div className="sales-section-head"><div className="card-title">{f.goalsMonth}</div><button className="btn btn-sm" onClick={() => setTab('goals')}>{c.open}</button></div><GoalBars goal={myGoal} actual={myResults} today={today} f={f} compact /></div>
            <div className="card"><div className="card-title">{c.aiReview}</div><p className="sales-muted">{c.aiHint}</p><button className="btn btn-primary" disabled={busyAi} onClick={runFunnelAI}>{busyAi ? c.saving : c.searchAi}</button>{aiResult && <div className="sales-ai-result">{aiResult}</div>}</div>
          </div>
          <div className="card"><div className="sales-section-head"><div className="card-title">{c.leads}</div><button className="btn btn-primary" onClick={() => { setLead(blankLead()); setLeadId(''); setTab('leads') }}>{c.addLead}</button></div>{leads.slice(0, 10).map(row => <div className="sales-row" key={row.id}><div><strong>{row.site_name || row.company_name}</strong><small>{row.contact_name} · {row.stage}</small><LastContactLine info={statusOf.get(row.id)} lead={row} f={f} today={today} /><FollowupChip info={statusOf.get(row.id)} f={f} /></div><button className="btn btn-sm" onClick={() => editLead(row)}>{c.open}</button></div>)}{leads.length === 0 && <p className="sales-muted">{c.noLeads}</p>}</div>
        </>}

        {tab === 'leads' && <div className="card"><div className="sales-section-head"><div><div className="card-title">{leadId ? c.open : c.addLead}</div><p className="sales-muted">{c.confirm}</p></div><div><input ref={cardRef} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => runCardAI(e.target.files?.[0])}/><button className="btn" type="button" disabled={busyAi} onClick={() => cardRef.current?.click()}>{busyAi ? c.saving : c.scanCard}</button></div></div>
          <form onSubmit={saveLead}><div className="sales-form-grid">
            {Field({ label: c.company, field: "company_name" })}{Field({ label: c.site, field: "site_name" })}{Field({ label: c.contact, field: "contact_name" })}{Field({ label: c.role, field: "contact_title" })}{Field({ label: c.phone, field: "contact_phone" })}{Field({ label: c.email, field: "contact_email" })}{Field({ label: c.address, field: "address" })}{Field({ label: f.firstContact, field: "first_contact_date", type: "date" })}{Field({ label: f.lastContact, field: "last_contact_date", type: "date" })}{Field({ label: c.followupDate, field: "next_followup_date", type: "date" })}{Field({ label: c.followupNote, field: "notes" })}
            <label className="form-group"><span>{c.source}</span><select value={lead.marketing_channel_id || ''} onChange={e=>setLead(v=>({...v,marketing_channel_id:e.target.value,marketing_campaign_id:''}))}><option value="">{c.source}</option>{data.marketing?.channels?.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="form-group"><span>Campaign</span><select value={lead.marketing_campaign_id || ''} onChange={e=>setLead(v=>({...v,marketing_campaign_id:e.target.value}))}><option value="">—</option>{data.marketing?.campaigns?.filter(row=>!lead.marketing_channel_id || row.channel_id===lead.marketing_channel_id).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          </div><button disabled={saving} className="btn btn-primary" type="submit">{saving ? c.saving : c.save}</button></form>
          {leadId && <div className="sales-lead-contacts">
            <div className="sales-section-head"><div><FollowupChip info={statusOf.get(leadId)} f={f} /></div>{contactLeadId !== leadId && <button type="button" className="btn btn-primary btn-sm" onClick={() => setContactLeadId(leadId)}>{f.logContact}</button>}</div>
            {contactLeadId === leadId && <ContactLogForm key={leadId} lead={{ id: leadId }} today={today} f={f} busy={saving} onSave={logContact} onCancel={() => setContactLeadId('')} />}
            <ContactHistory leadId={leadId} touchpoints={touchpoints} f={f} />
          </div>}
          <div className="sales-list-divider">{leads.map(row => <div className="sales-row" key={row.id}><div><strong>{row.site_name || row.company_name}</strong><small>{row.contact_name} · {row.stage}</small><LastContactLine info={statusOf.get(row.id)} lead={row} f={f} today={today} /></div><button className="btn btn-sm" onClick={() => editLead(row)}>{c.open}</button></div>)}</div>
        </div>}

        {tab === 'approaches' && <div className="sales-grid-two sales-reports-grid"><form className="card" onSubmit={saveApproach}><div className="card-title">{c.approachLog}</div><div className="sales-form-grid">
          {Field({ label: c.place, field: "place", value: approach.place, onChange: e => setApproach(v => ({ ...v, place: e.target.value })) })}{Field({ label: c.company, field: "company_name", value: approach.company_name, onChange: e => setApproach(v => ({ ...v, company_name: e.target.value })) })}{Field({ label: c.site, field: "site_name", value: approach.site_name, onChange: e => setApproach(v => ({ ...v, site_name: e.target.value })) })}{Field({ label: c.contact, field: "contact_name", value: approach.contact_name, onChange: e => setApproach(v => ({ ...v, contact_name: e.target.value })) })}{Field({ label: c.date, field: "work_date", type: "date", value: approach.work_date, onChange: e => setApproach(v => ({ ...v, work_date: e.target.value })) })}{Field({ label: c.duration, field: "duration_minutes", type: "number", value: approach.duration_minutes, onChange: e => setApproach(v => ({ ...v, duration_minutes: e.target.value })) })}{Field({ label: c.travel, field: "travel_cost", type: "number", value: approach.travel_cost, onChange: e => setApproach(v => ({ ...v, travel_cost: e.target.value })) })}{Field({ label: c.followupDate, field: "followup_date", type: "date", value: approach.followup_date, onChange: e => setApproach(v => ({ ...v, followup_date: e.target.value })) })}
          </div><label className="form-group"><span>{c.notes}</span><textarea rows="4" value={approach.notes} onChange={e => setApproach(v => ({ ...v, notes: e.target.value }))}/></label>
          <label className="form-group"><span>{c.hoursSpent}</span><input type="number" min="0" step="0.25" value={approach.hours_spent} onChange={e=>setApproach(v=>({...v,hours_spent:e.target.value}))}/></label>
          <div className="sales-action-row"><input ref={audioRef} hidden type="file" accept="audio/*" onChange={async e => { const file=e.target.files?.[0]; if(file) await transcribeAudio(file); e.target.value='' }}/><button type="button" className="btn" onClick={() => audioRef.current?.click()}>{c.audio}</button><button type="button" className="btn" disabled={busyAi || recording} onClick={startVoice}>{c.record}</button>{recording && <button type="button" className="btn btn-danger" onClick={stopVoice}>{c.recording}</button>}</div>
          <label className="form-group"><span>{c.transcript}</span><textarea rows="5" value={approach.meeting_transcript} onChange={e => setApproach(v => ({ ...v, meeting_transcript: e.target.value }))}/></label><button type="button" className="btn" disabled={busyAi} onClick={analyzeTranscript}>{busyAi ? c.saving : c.transcribe}</button>
          {approach.meeting_summary && <div className="sales-ai-result"><strong>{c.summary}</strong><p>{approach.meeting_summary}</p><strong>{c.nextStep}</strong><p>{approach.ai_next_step}</p></div>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? c.saving : c.saveApproach}</button>
        </form><div><form className="card" onSubmit={saveDailyReport}><div className="card-title">{c.month} · {c.hours}</div><div className="sales-form-grid">{Field({ label: c.date, field: "work_date", type: "date", value: dailyReport.work_date, onChange: e=>setDailyReport(v=>({...v,work_date:e.target.value})) })}{Field({ label: c.hours, field: "hours_worked", type: "number", value: dailyReport.hours_worked, onChange: e=>setDailyReport(v=>({...v,hours_worked:e.target.value})) })}{Field({ label: c.travel, field: "travel_cost", type: "number", value: dailyReport.travel_cost, onChange: e=>setDailyReport(v=>({...v,travel_cost:e.target.value})) })}</div><label className="form-group"><span>{c.notes}</span><textarea rows="3" value={dailyReport.summary} onChange={e=>setDailyReport(v=>({...v,summary:e.target.value}))}/></label><button className="btn btn-primary" disabled={saving}>{saving?c.saving:c.saveApproach}</button></form><div className="card"><div className="card-title">{c.month}</div>{(data.reports || []).map(row => <div className="sales-row" key={row.id}><div><strong>{row.work_date}</strong><small>{row.hours_worked}h · {yen(row.travel_cost)} · {row.summary}</small></div></div>)}{(data.approaches || []).map(row => <div className="sales-row" key={row.id}><div><strong>{row.site_name || row.company_name || row.place}</strong><small>{row.work_date} · {row.hours_spent || 0}h · {row.duration_minutes || 0} min · {yen(row.travel_cost)}</small>{row.meeting_summary && <p>{row.meeting_summary}</p>}</div></div>)}</div></div></div>}

        {tab === 'followups' && <div className="card"><div className="sales-section-head"><div className="card-title">{c.followups}</div><div className="sales-filter-pills">{[['action', `${f.alertTitle} (${counts.needsAction})`], ['all', `${c.leadsN} (${queue.length})`]].map(([key, label]) => <button type="button" key={key} className={`btn btn-sm${followFilter === key ? ' active' : ''}`} onClick={() => setFollowFilter(key)}>{label}</button>)}</div></div>
          {queue.filter(row => followFilter === 'all' || ['overdue', 'today', 'stale', 'soon', 'missing'].includes(row.info.status)).map(({ lead: row, info }) => <div className={`sales-followup sales-followup-${info.status}`} key={row.id}>
            <div><strong>{row.site_name || row.company_name}</strong><small>{[row.contact_name, row.contact_phone].filter(Boolean).join(' · ')}</small><LastContactLine info={info} lead={row} f={f} /><FollowupChip info={info} f={f} />{row.notes && <p>{row.notes}</p>}
              {contactLeadId === row.id && <ContactLogForm key={row.id} lead={row} today={today} f={f} busy={saving} onSave={logContact} onCancel={() => setContactLeadId('')} />}
            </div>
            {contactLeadId !== row.id && <div className="sales-followup-actions"><button className="btn btn-primary btn-sm" onClick={() => setContactLeadId(row.id)}>{f.logContact}</button><button className="btn btn-sm" onClick={() => editLead(row)}>{c.open}</button></div>}
          </div>)}
          {queue.length === 0 && <p className="sales-muted">{c.noFollowups}</p>}
        </div>}

        {tab === 'goals' && <div className="card"><div className="card-title">{f.goalsMonth} · {month}</div><GoalBars goal={myGoal} actual={myResults} today={today} f={f} /></div>}

        {tab === 'contracts' && <><div className="card"><div className="card-title">{c.prepare}</div><form onSubmit={submitContract}><div className="sales-form-grid">
          <label className="form-group"><span>{c.lead}</span><select value={contract.lead_id} onChange={e => setContract(v => ({ ...v, lead_id: e.target.value }))}><option value="">—</option>{leads.filter(row => !['won','lost'].includes(row.stage)).map(row => <option key={row.id} value={row.id}>{row.site_name || row.company_name}</option>)}</select></label>
          <label className="form-group"><span>{c.service}</span><select value={contract.service_type} onChange={e => setContract(v => ({ ...v, service_type: e.target.value }))}>{['Basic Cleaning','Deep Cleaning','Range Hood','AC Cleaning','Grease Trap','Window Cleaning','Floor Wax','Spot Cleaning'].map(x => <option key={x}>{x}</option>)}</select></label>
          <label className="form-group"><span>{c.billing}</span><select value={contract.billing_type} onChange={e => setContract(v => ({ ...v, billing_type: e.target.value }))}><option value="fixed_monthly">Monthly fixed</option><option value="per_visit">Per visit</option></select></label>
          <label className="form-group"><span>{c.monthlyBase}</span><input type="number" min="0" value={contract.base_monthly_amount} onChange={e => setContract(v => ({ ...v, base_monthly_amount: e.target.value }))}/></label>
          {contract.billing_type === 'per_visit' && <><label className="form-group"><span>{c.priceVisit}</span><input type="number" min="0" value={contract.price_per_visit} onChange={e => setContract(v => ({ ...v, price_per_visit: e.target.value, base_monthly_amount: String(Number(e.target.value || 0) * Number(v.visits_per_month || 0)) }))}/></label><label className="form-group"><span>{c.visits}</span><input type="number" min="0" value={contract.visits_per_month} onChange={e => setContract(v => ({ ...v, visits_per_month: e.target.value, base_monthly_amount: String(Number(v.price_per_visit || 0) * Number(e.target.value || 0)) }))}/></label></>}
          <label className="form-group"><span>{c.commissionType}</span><select value={contract.commission_type} onChange={e => setContract(v => ({ ...v, commission_type: e.target.value }))}><option value="percent">{c.percent}</option><option value="fixed">{c.fixed}</option></select></label>
          <label className="form-group"><span>{c.commissionValue}</span><input type="number" min="0" step="0.1" value={contract.commission_value} onChange={e => setContract(v => ({ ...v, commission_value: e.target.value }))}/></label>
          <label className="form-group"><span>{c.hoursVisit}</span><input type="number" min="0" step="0.5" value={contract.hours_per_visit} onChange={e => setContract(v => ({ ...v, hours_per_visit: e.target.value }))}/></label>
        </div><div className="sales-price-preview"><span>{c.totalClient}</span><strong>{yen(monthlyClientPrice)} / month</strong><small>{c.commissionType}: {yen(commissionExtra)} · {openContract?.company_name || ''}</small></div>
          <label className="form-group sales-file-field"><span>{c.signedPdf} *</span><input type="file" accept="application/pdf,.pdf" onChange={e => uploadContractPdf(e.target.files?.[0])}/>{contract.signed_pdf_name && <small>{contract.signed_pdf_name}</small>}</label>
          {data.contracts?.filter(row => row.status === 'changes_requested' && row.salesperson_id === user.id).map(row => <div className="sales-review-note" key={row.id}><strong>{row.company_name}</strong><p>{row.admin_note}</p></div>)}
          <button className="btn btn-primary" type="submit" disabled={saving || !contract.signed_pdf_object_path}>{saving ? c.saving : c.submit}</button></form></div>
          <div className="card"><div className="card-title">{c.activeContracts}</div>{(data.contracts || []).map(row => <div className="sales-row" key={row.id}><div><strong>{row.site_name || row.company_name}</strong><small>{row.status} · {yen(row.client_monthly_total)} / month · {c.commission}: {yen(row.commission_amount)}</small>{row.admin_note && <p>{row.admin_note}</p>}</div>{row.signed_pdf_object_path && <button className="btn btn-sm" onClick={() => openSignedPdf(row)}>{c.open} PDF</button>}</div>)}{!data.contracts?.length && <p className="sales-muted">{c.noContracts}</p>}</div></>}
      </>}
    </div>
  )
}
