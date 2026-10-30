import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { syncServiceReport } from '../lib/jobReport'
import { keyboxForJob } from '../lib/scheduleGenerator'
import KeyReveal from '../components/KeyReveal'
import { splitKeyLine } from '../lib/keyReveal'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import { compressVideo, canUseWebCodecs, videoTypeInfo } from '../lib/videoCompress'
import { uploadJobVideo, videoPoster, writeVideoStatus } from '../lib/jobVideo'
import { enqueueAndSend, enqueueVideo, flushVideoQueue, holdQueuedVideo, removeQueuedVideo } from '../lib/videoQueue'
import JobVideoPicker from '../components/JobVideoPicker'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { useAuth } from '../hooks/useAuth'
import { useLang, fill, pickLang, localeOf } from '../hooks/useLang'
import { supabase } from '../lib/supabase'
import { finishQuoteJob } from '../lib/quoteFlow'
import { distanceMeters, formatDistance, getCurrentPosition } from '../lib/geocode'
import ServiceTimer from '../components/ServiceTimer'
import NfcScanSheet from '../components/NfcScanSheet'
import { loadNfcConfig, nfcSupported, saveNfcResult } from '../lib/nfcClock'
import { summarizeJobs, weeklyEvolution, formatMinutes, expectedJobMinutes, ON_SITE_METERS } from '../lib/workKpis'
import { VOICE_EVERY_SEC, voicePrefOn, setVoicePref, voiceMessage, speak, unlockSpeech, canSpeak } from '../lib/voiceAlert'
import { hasMapsLink, mapsOpenUrl } from '../lib/mapsLink'
import { dueAlertJobs, dueAlertSlot, acceptSpotUpdate, isBrokenRunningJob, isPendingSpot } from '../lib/jobDueAlert'
import JobDueAlert, { ringDueAlert } from '../components/JobDueAlert'
import { locationFromJob } from '../lib/clientPortal'
import FacilityModal from '../components/facility/FacilityModal'
import { fetchOpenOffers, fetchClosedOffers, dismissClosedOffers, hideOffer } from '../lib/openOffers'
import { takeOffer } from '../lib/assignOps'
import { fetchMyNotices, ackNotices } from '../lib/assignNotices'
import AgendaNoticesItem from '../components/AgendaNoticesItem'
// v1.0.90 · Kuripuro World só para ver (three.js baixa só quando abre)
const FacilityWorld = lazy(() => import('./Facility'))
import EmployeeChat from '../components/EmployeeChat'
import { OFFICE_KEY, buildChatSections, officeThread, threadWith, teamUnreadTotal } from '../lib/teamChat'
import PhotoLightbox from '../components/PhotoLightbox'
import { photoMessage, chatPreview } from '../lib/chatContent'
import { shouldAskForgot, employeeSlipState, employeeSlipText, problemMessage } from '../lib/fieldExec'
import toast from 'react-hot-toast'
import { googleCalendarUrl, downloadJobIcs, fetchCalendarFeedUrl } from '../lib/calendar'
import { ContractSignModal } from '../components/SpotContracts'
import { contractStatus } from '../lib/spotContract'
import { refreshSpotContractPdf } from '../lib/spotContractOps'
import { getConfirmablePeriod, canConfirmPeriod, fmtPeriod, getPeriodDates } from '../lib/salaryPeriod'
import { youtubeEmbedUrl } from '../lib/youtube'
import LanguageToggle from '../components/LanguageToggle'
import { contractForJob, parseTrainingChecklist } from '../lib/training'
import { initChecklistState, checklistComplete, checklistTemplateForJob, parseChecklistTemplate, resolveChecklistForJob, checklistDisplayLabel } from '../lib/jobChecklist'
import {
  manualAddLocations,
  buildAddServiceOptions,
  employeeAddService,
  preparePastServiceJob,
  checklistCompleteForRetro,
  isJobFullyRegistered,
  isDuskinJob,
  pastServicePrefillFromJob,
  ALL_DEEP_COMPONENT_IDS,
} from '../lib/employeeAddJob'
import {
  isOverdueAssignedJob,
  isCriticallyOverdueJob,
  isMissedJob,
  canRegisterLate,
  isRetroJob,
} from '../lib/jobOverdue'
import {
  DEEP_CLEAN_COMPONENTS,
  deepComponentLabel,
  getCleaningType,
  cleaningTypesForLang,
} from '../lib/cleaningType'
import { tokyoToday } from '../lib/dates'
import { tokyoTomorrow, upcomingJobs, SHIFT_END_LIMIT, validateShiftWindow } from '../lib/nextDayShift'
import { calcEmployeeMonthlySalary } from '../lib/salaryCalc'
import AIChatPanel from '../components/AIChatPanel'
import EarningsPanel from '../components/EarningsPanel'
import { PayslipPopup, SalaryAnswerPopup } from '../components/SalaryPopups'
import { monthLabel } from '../lib/earnings'
import AvailabilityPlanner, { PlanAlert, TimeOffList, fmtDay } from '../components/AvailabilityPlanner'
import { unseenDecisions, timeOffListRows, loadSeen, markSeen } from '../lib/timeOffNotices'
import { planningAlert, addDays as addDaysIso } from '../lib/availability'
import { SIGNATURE_INK } from '../lib/signature'
import { businessName, mapQuery, siteCoords, nearestJob } from '../lib/nearbyJob'
import { employeeThemeFor, employeeGreetingFor, loadEmployeeTheme } from '../lib/employeeTheme'
import { aiIssuesText } from '../lib/photoAi'
import { askConfirm } from '../components/ConfirmDialog'
import AfterPhotoLater from '../components/AfterPhotoLater'
import TeamDay from '../components/TeamDay'
import { REVIEW_PREFIX } from '../lib/deductionReview'
import MyProfile from '../components/MyProfile'
import PendingVideos from '../components/PendingVideos'
import { contractForAgendaJob, expectedMinutes as plannedMinutes, checklistUpdate, sortByOrder, nextPendingJob, MANUAL_ORDER_BASE } from '../lib/agenda'
import { loadAgendaSettings, logJobAdmin } from '../lib/jobAdminOps'
import { quickRoundEnabledFor } from '../lib/quickRound'
import QuickRound from '../components/QuickRound'
import {
  enrichJobValues,
  employeeEarningsForJob,
  formatShiftElapsed,
  isStaleActiveJob,
  salaryTypeLabel,
} from '../lib/employeePay'

const BADGE_DEFS = [
  { key:'first_job', name:'First Job', icon:'🎯', desc:'Complete your first job' },
  { key:'jobs_5', name:'5 Jobs', icon:'⭐', desc:'Complete 5 jobs' },
  { key:'jobs_10', name:'10 Jobs', icon:'🌟', desc:'Complete 10 jobs' },
  { key:'jobs_25', name:'25 Jobs', icon:'🏆', desc:'Complete 25 jobs' },
  { key:'spot_master', name:'Spot Master', icon:'⚡', desc:'Accept 5 spot jobs' },
  { key:'perfect_week', name:'Perfect Week', icon:'🔥', desc:'5 jobs in one week' },
]

// Lives outside EmployeePortal so the clock tick does not remount it (and reset scroll).
function JobPhoto({ url, label }) {
  const { t } = useLang()
  const [failed, setFailed] = useState(false)
  const displayUrl = viewablePhotoUrl(url)
  if (!url) return null
  return (
    <div>
      <div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:3}}>{label}</div>
      {failed ? (
        <a href={displayUrl} target="_blank" rel="noreferrer" style={{width:'100%',aspectRatio:'4/3',borderRadius:10,background:'rgba(255,255,255,0.04)',border:'1px dashed rgba(255,255,255,0.12)',display:'flex',alignItems:'center',justifyContent:'center',color:'#60a5fa',fontSize:11,textAlign:'center',padding:8,textDecoration:'none'}}>📷 {t.employee.openPhoto}</a>
      ) : (
        <img src={displayUrl} alt={label} onError={()=>setFailed(true)} style={{width:'100%',borderRadius:10,objectFit:'cover',aspectRatio:'4/3'}} />
      )}
    </div>
  )
}

// Answers to salary disputes pop up once; a new answer on the same request shows again.
const answerKey = c => `${c.id}:${c.resolved_at}`
const seenAnswersKey = id => `kp_salary_answers_seen:${id}`
function loadSeenAnswers(id) {
  try { return new Set(JSON.parse(localStorage.getItem(seenAnswersKey(id)) || '[]')) } catch { return new Set() }
}
function saveSeenAnswers(id, set) {
  try { localStorage.setItem(seenAnswersKey(id), JSON.stringify([...set].slice(-50))) } catch { /* private mode */ }
  return set
}

export default function EmployeePortal() {
  const { user, logout } = useAuth()
  const { lang, t: tr } = useLang()
  const e = tr.employee
  // Inline text for the three languages: L(en, ja, pt).
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  // Personal theme for this exact account only (matched by employee id).
  const personalTheme = employeeThemeFor(user)
  const themeClass = personalTheme ? ` kp-theme-${personalTheme}` : ''
  const personalGreeting = employeeGreetingFor(user)
  const quickRoundOn = quickRoundEnabledFor(user)
  useEffect(() => { if (personalTheme) loadEmployeeTheme(personalTheme) }, [personalTheme])
  const [tab, setTab] = useState('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [facilityIndex, setFacilityIndex] = useState([])
  const [facilityJob, setFacilityJob] = useState(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [jobs, setJobs] = useState([])
  const [allJobs, setAllJobs] = useState([])
  const [reorderBusy, setReorderBusy] = useState(false)
  const [spotJobs, setSpotJobs] = useState([])
  // v1.0.101 · changes the office made to my agenda (confirm "Got it") + offers someone else took
  const [agendaNotices, setAgendaNotices] = useState([])
  const [closedOffers, setClosedOffers] = useState([])
  // v1.0.21 · spot contract of the open job (signed on site by the location)
  const [jobContract, setJobContract] = useState(null)
  const [contractSignOpen, setContractSignOpen] = useState(false)
  const [activeJob, setActiveJob] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [checklist, setChecklist] = useState([])
  const [notes, setNotes] = useState('')
  const [jobPhotos, setJobPhotos] = useState([])
  // v1.0.112 · per-photo upload state: { [photo id]: { state: 'sending'|'sent'|'failed', path } }
  const [photoStatus, setPhotoStatus] = useState({})
  const photoStatusRef = useRef({})
  const setPhotoState = (id, v) => { photoStatusRef.current = { ...photoStatusRef.current, [id]: v }; setPhotoStatus(photoStatusRef.current) }
  const [problemJob, setProblemJob] = useState(null)
  // Vídeo opcional do serviço: comprimido ao escolher, enviado só depois de finalizar
  const [jobVideo, setJobVideo] = useState(null)
  const videoTaskRef = useRef(null)
  const [submitting, setSubmitting] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('')
  const [herePos, setHerePos] = useState(null)
  const [myTimeOff, setMyTimeOff] = useState([])
  // Approved / rejected day-off requests show once in the bell, then disappear
  const [seenTimeOff, setSeenTimeOff] = useState(() => loadSeen(user.id))
  const [bellOpen, setBellOpen] = useState(false)
  const toastedTimeOff = useRef(new Set())
  const [siteCoordsById, setSiteCoordsById] = useState({})
  const [retroJob, setRetroJob] = useState(null)
  const [retroChecklist, setRetroChecklist] = useState([])
  const [retroText, setRetroText] = useState('')
  const [retroPhoto, setRetroPhoto] = useState(null)
  const [retroEval, setRetroEval] = useState(null)
  const [retroBusy, setRetroBusy] = useState(false)
  const [salaryData, setSalaryData] = useState(null)
  const [payments, setPayments] = useState([])
  const [weekDeductions, setWeekDeductions] = useState([])
  const [monthDeductions, setMonthDeductions] = useState([])
  const [advances, setAdvances] = useState([])
  const [claims, setClaims] = useState([])
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [sendingChatPhoto, setSendingChatPhoto] = useState(false)
  const [chatLightbox, setChatLightbox] = useState(null)
  // v1.0.72 · chat with coworkers / own leader (team_messages); office chat stays in messages
  const [teamReady, setTeamReady] = useState(false)
  const [coworkers, setCoworkers] = useState([])
  const [teamMessages, setTeamMessages] = useState([])
  const [chatKey, setChatKey] = useState(null)
  const coworkersRef = useRef([])
  coworkersRef.current = coworkers
  const [badges, setBadges] = useState([])
  const [clock, setClock] = useState(new Date())
  const [empScore, setEmpScore] = useState(100)
  const [empData, setEmpData] = useState(null)
  const [weekPlans, setWeekPlans] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [claimForm, setClaimForm] = useState({ job_id:'', amount:'', route:'', description:'' })
  const [claimPhoto, setClaimPhoto] = useState(null)
  const [claimReceipt, setClaimReceipt] = useState(null)
  const [claimPhotoPreview, setClaimPhotoPreview] = useState(null)
  const [claimReceiptPreview, setClaimReceiptPreview] = useState(null)
  const [submittingClaim, setSubmittingClaim] = useState(false)
  const [equipmentRequests, setEquipmentRequests] = useState([])
  const [equipmentForm, setEquipmentForm] = useState({ category: 'supplies', item_name: '', quantity: '1', reason: '', product_url: '' })
  const [equipmentPhoto, setEquipmentPhoto] = useState(null)
  const [equipmentPhotoPreview, setEquipmentPhotoPreview] = useState(null)
  const [submittingEquipment, setSubmittingEquipment] = useState(false)
  const [statement, setStatement] = useState(null)
  const [slipLine, setSlipLine] = useState(null)
  // Payslip to confirm + admin answers to salary disputes, both shown as home pop-ups
  const [salaryAnswers, setSalaryAnswers] = useState([])
  const [myQuestions, setMyQuestions] = useState([]) // every salary question of this employee (hub)
  const [salaryView, setSalaryView] = useState('payslip')
  const [seenAnswers, setSeenAnswers] = useState(() => loadSeenAnswers(user?.id))
  const [payslipOpen, setPayslipOpen] = useState(false)
  const [answerOpen, setAnswerOpen] = useState(null)
  const salaryPopupShown = useRef(false)
  const [showSignature, setShowSignature] = useState(false)
  const [signatureJob, setSignatureJob] = useState(null)
  // Ponto por NFC (off unless the admin turned it on for everyone or for this worker)
  const [nfcConfig, setNfcConfig] = useState({ active: false, tags: [] })
  const [nfcScan, setNfcScan] = useState(null)
  const finishPrepRef = useRef(null)
  const nfcEndRef = useRef(null)
  useEffect(() => { if (user?.id) loadNfcConfig(supabase, user.id).then(setNfcConfig) }, [user?.id])
  const [retroSignOpen, setRetroSignOpen] = useState(false)
  const [officeUnread, setOfficeUnread] = useState(0)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [serviceContracts, setServiceContracts] = useState([])
  const [trainingModal, setTrainingModal] = useState(null)
  const [showAddService, setShowAddService] = useState(false)
  const [addServiceBusy, setAddServiceBusy] = useState(false)
  const [showPastService, setShowPastService] = useState(false)
  const [pastServiceBusy, setPastServiceBusy] = useState(false)
  const [pastServicePrefill, setPastServicePrefill] = useState(null)
  const [overdueBusy, setOverdueBusy] = useState(null)
  const [todayAllJobs, setTodayAllJobs] = useState([])
  const [userScrolled, setUserScrolled] = useState(false)
  const teamUnread = teamUnreadTotal(teamMessages, user.id)
  const unreadMsgs = officeUnread + teamUnread
  const chatOnOffice = !teamReady || chatKey === OFFICE_KEY

  const timerRef = useRef()
  const clockRef = useRef()
  const hourWarnedRef = useRef(false)
  const [voiceOn, setVoiceOn] = useState(voicePrefOn)
  const voiceSlotRef = useRef(0)
  const voiceCtxRef = useRef({})
  const photoInputRef = useRef()
  const claimPhotoRef = useRef()
  const claimReceiptRef = useRef()
  const equipmentPhotoRef = useRef()
  const msgEndRef = useRef()
  const chatContainerRef = useRef()

  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online',on); window.removeEventListener('offline',off) }
  }, [])

  useEffect(() => () => {
    jobPhotos.forEach(p => { if (p.preview) URL.revokeObjectURL(p.preview) })
  }, [jobPhotos])

  useEffect(() => {
    loadAll()
    clockRef.current = setInterval(() => setClock(new Date()), 1000)
    const msgPoll = setInterval(() => { loadMessages(); loadTeamMessages() }, 10000)
    // Ping presence every 60s
    const pingPresence = async () => {
      const update = { last_seen: new Date().toISOString(), is_online: true }
      // Compartilha GPS automaticamente durante o expediente (job em andamento)
      const working = document.body.getAttribute('data-working') === 'yes'
      if (navigator.geolocation && working) {
        try {
          const pos = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000, maximumAge: 15000, enableHighAccuracy: true }))
          update.last_lat = pos.coords.latitude
          update.last_lng = pos.coords.longitude
          update.last_location_at = new Date().toISOString()
          update.location_sharing = true
        } catch {}
      }
      await supabase.from('employees').update(update).eq('id', user.id)
    }
    pingPresence()
    const presencePoll = setInterval(pingPresence, 30000)
    // Set offline on unmount
    return () => {
      clearInterval(clockRef.current)
      clearInterval(timerRef.current)
      clearInterval(msgPoll)
      clearInterval(presencePoll)
      supabase.from('employees').update({ is_online: false }).eq('id', user.id)
    }

  }, [user?.id])

  useEffect(() => {
    document.body.setAttribute('data-working', activeJob ? 'yes' : 'no')
    return () => document.body.setAttribute('data-working', 'no')
  }, [activeJob])

  useEffect(() => {
    if (activeJob?.id) {
      setChecklist(prev => resolveChecklistForJob(activeJob, prev))
    }
  }, [activeJob?.id])

  // Latest values for the 5-minute voice reminder, read inside the timer without restarting it.
  voiceCtxRef.current = { checklist, allJobs, voiceOn, lang, labels: e }

  const sayReminder = async (job, secs) => {
    const { checklist: ck, allJobs: history, lang: lg, labels } = voiceCtxRef.current
    let dist = null
    try {
      const [pos, site] = await Promise.all([
        getCurrentPosition({ maxWait: 6000, goodEnough: 30 }).catch(() => null),
        siteCoords(job).catch(() => null),
      ])
      if (pos && site) dist = Math.round(distanceMeters(pos.lat, pos.lng, site.lat, site.lng))
    } catch { /* GPS is optional here */ }
    const text = voiceMessage({
      place: businessName(job), elapsedSec: secs, expectedMin: expectedJobMinutes(job, history).expected,
      checklist: resolveChecklistForJob(job, ck), dist, onSiteMeters: ON_SITE_METERS, labels, lang: lg,
    })
    speak(text, lg)
    try { navigator.vibrate?.([200, 100, 200]) } catch { /* no vibration */ }
  }

  const toggleVoice = () => {
    const next = !voiceOn
    setVoiceOn(next)
    setVoicePref(next)
    if (next) unlockSpeech()
  }

  useEffect(() => {
    hourWarnedRef.current = false
    if (activeJob?.started_at) {
      const start = new Date(activeJob.started_at)
      // Reopening the app mid-job does not replay a reminder; the next one comes at the next 5-minute mark.
      voiceSlotRef.current = Math.floor((Date.now()-start)/1000 / VOICE_EVERY_SEC)
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now()-start)/1000)
        setElapsed(secs)
        const slot = Math.floor(secs / VOICE_EVERY_SEC)
        if (slot > voiceSlotRef.current) {
          voiceSlotRef.current = slot
          if (voiceCtxRef.current.voiceOn && activeJob.status === 'in_progress') sayReminder(activeJob, slot * VOICE_EVERY_SEC)
        }
        if (secs === 3600 && !hourWarnedRef.current) {
          hourWarnedRef.current = true
          toast(L('⏱️ 1 hour on this job — everything ok?', '⏱️ この作業で1時間経過しました。問題ありませんか？', '⏱️ 1 hora neste serviço — está tudo bem?'), { duration: 8000 })
        }
      }, 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [activeJob])

  useEffect(() => {
    if (tab==='chat') {
      if (chatOnOffice) { if (officeUnread > 0) markRead() }
      else if (chatKey && teamMessages.some(m=>m.from_employee_id===chatKey&&m.to_employee_id===user.id&&!m.read)) markTeamRead(chatKey)
      // Only auto-scroll if user hasn't scrolled up
      if (!userScrolled) {
        setTimeout(()=>msgEndRef.current?.scrollIntoView({behavior:'smooth'}),100)
      }
    }
  }, [tab, messages, teamMessages, chatKey])

  // Phones open the people list first; wider screens open the leader (or the office) beside it.
  useEffect(() => {
    if (tab!=='chat' || !teamReady || chatKey) return
    if (window.matchMedia('(min-width: 821px)').matches) setChatKey(coworkers.find(c=>c.id===user.id)?.leader_id || OFFICE_KEY)
  }, [tab, teamReady])

  const openChat = (key) => { setChatKey(key); setNewMsg(''); setUserScrolled(false) }

  const handleChatScroll = (e) => {
    const el = e.target
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    setUserScrolled(!isAtBottom)
  }

  const loadAll = async () => {
    const today = tokyoToday()
    const { start:weekStart, end:weekEnd } = getWeekRange()
    const monthStart = today.slice(0, 7) + '-01'
    const [active, all, emp, pay, adv, clm, eqp, bdg, weekPay, monthPay, contractsRes] = await Promise.all([
      supabase.from('jobs').select('*').eq('employee_id',user.id).in('status',['assigned','in_progress']).order('scheduled_date').order('scheduled_time'),
      supabase.from('jobs').select('*').eq('employee_id',user.id).order('scheduled_date',{ascending:false}).limit(500),
      supabase.from('employees').select('id,full_name,email,contract_type,hourly_rate,fixed_salary,salary_type,job_bonus_rate,monthly_work_days,score,is_active').eq('id',user.id).maybeSingle(),
      supabase.from('salary_payments').select('*').eq('employee_id',user.id).gte('payment_date',today).order('payment_date').limit(10),
      supabase.from('salary_payments').select('*').eq('employee_id', user.id).eq('payment_type', 'advance').order('payment_date', { ascending: false }).limit(10),
      supabase.from('transport_claims').select('*').eq('employee_id',user.id).order('created_at',{ascending:false}).limit(20),
      supabase.from('equipment_requests').select('*').eq('employee_id',user.id).order('created_at',{ascending:false}).limit(30),
      supabase.from('badges').select('*').eq('employee_id',user.id),
      supabase.from('salary_payments').select('*').eq('employee_id',user.id).eq('is_deduction',true).neq('status','cancelled').gte('payment_date',weekStart).lte('payment_date',weekEnd),
      supabase.from('salary_payments').select('*').eq('employee_id',user.id).eq('is_deduction',true).neq('status','cancelled').or(`period.eq.${monthStart.slice(0,7)},and(period.is.null,payment_date.gte.${monthStart},payment_date.lte.${today})`),
      supabase.from('service_contracts').select('location_name,price_per_visit,training_video_url,training_checklist,client_id,is_active').eq('is_active', true),
    ])
    const visible = (list) => (list || []).filter(j => !isDuskinJob(j))
    const regular = visible(active.data).filter(j=>j.job_category!=='spot'||j.spot_status==='accepted')
    const spots = visible(active.data).filter(j=>j.job_category==='spot'&&j.spot_status==='pending')
    const allVisible = visible(all.data)
    setPayments(pay.data||[]); setAdvances(adv.data||[]); setClaims(clm.data||[]); setEquipmentRequests(eqp.data||[])
    setWeekDeductions(weekPay.data||[])
    setMonthDeductions(monthPay.data||[])
    setBadges(bdg.data||[])
    setServiceContracts(contractsRes.data || [])
    if (emp.data) { setEmpScore(emp.data.score||100); setEmpData(emp.data) }
    let inProgress = regular.find(j=>j.status==='in_progress')
    if (!inProgress) inProgress = allVisible.find(j => j.status === 'in_progress')
    if (!inProgress) {
      // A running job that was put back on 'assigned' (old Accept button) still has its start: reopen it.
      const broken = allVisible.find(j => isBrokenRunningJob(j))
      if (broken) {
        const { data: reopened } = await supabase.from('jobs').update({ status: 'in_progress' })
          .eq('id', broken.id).eq('status', 'assigned').not('started_at', 'is', null).select().maybeSingle()
        if (reopened) {
          inProgress = reopened
          const i = allVisible.findIndex(j => j.id === reopened.id)
          if (i >= 0) allVisible[i] = reopened
        }
      }
    }
    if (inProgress && !allVisible.some(j => j.id === inProgress.id)) allVisible.unshift(inProgress)
    const open = await fetchOpenOffers(user.id).catch(() => [])
    setJobs(regular); setSpotJobs([...spots, ...open]); setAllJobs(allVisible)
    fetchClosedOffers(user.id, open.map(j => j.id)).then(setClosedOffers).catch(() => {})
    fetchMyNotices(user.id).then(setAgendaNotices).catch(() => {})
    if (inProgress) {
      setActiveJob(inProgress)
      let ck = []
      const saved = localStorage.getItem(`kp_ck_${inProgress.id}`)
      if (saved) { try { ck = JSON.parse(saved) } catch {} }
      ck = resolveChecklistForJob(inProgress, ck.length ? ck : null)
      setChecklist(ck)
      localStorage.setItem(`kp_ck_${inProgress.id}`, JSON.stringify(ck))
    } else {
      setActiveJob(null)
      clearInterval(timerRef.current)
      setElapsed(0)
    }
    calcSalary(enrichJobValues(allVisible, contractsRes.data || []), emp.data, monthPay.data||[])
    loadMessages()
    loadTeam()
    awardBadges(allVisible, bdg.data||[])
    loadStatement()
    loadWeekPlans()
  }

  const loadWeekPlans = async () => {
    const { data, error } = await supabase.from('employee_week_plans').select('week_start,submitted_at').eq('employee_id', user.id).gte('week_start', tokyoToday()).limit(30)
    if (!error) setWeekPlans(data || [])
    // Day-off requests and their status (pending / approved / rejected) for the home card
    const { data: off } = await supabase.from('employee_availability')
      .select('id,date,kind,status,note,admin_note,decided_at')
      .eq('employee_id', user.id).eq('kind', 'off')
      .gte('date', addDaysIso(tokyoToday(), -30))
      .order('date', { ascending: true }).limit(60)
    setMyTimeOff(off || [])
  }

  const loadStatement = async () => {
    const period = getConfirmablePeriod()
    const [{ data }, answers, all, line] = await Promise.all([
      supabase.from('salary_statements').select('*').eq('employee_id', user.id).eq('period', period).maybeSingle(),
      supabase.from('salary_complaints').select('*').eq('employee_id', user.id).in('status', ['resolved', 'rejected'])
        .not('resolved_at', 'is', null).order('resolved_at', { ascending: false }).limit(20),
      supabase.from('salary_complaints').select('*').eq('employee_id', user.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('salary_payments').select('status,payment_date').eq('employee_id', user.id).eq('period', period).eq('payment_type', 'salary').limit(1),
    ])
    setStatement(data)
    setSlipLine(line.data?.[0] || null)
    setSalaryAnswers(answers.data || [])
    setMyQuestions(all.data || [])
  }

  const markAnswerSeen = (c) => {
    if (!c) return
    setSeenAnswers(prev => saveSeenAnswers(user.id, new Set([...prev, answerKey(c)])))
  }
  const closeAnswer = () => { markAnswerSeen(answerOpen); setAnswerOpen(null) }

  const loadMessages = async () => {
    const { data: newest } = await supabase.from('messages').select('*').eq('employee_id',user.id).order('created_at',{ascending:false}).limit(100)
    const data = (newest||[]).slice().reverse()
    const newUnread = (data||[]).filter(m=>m.sender==='admin'&&!m.read).length
    setMessages(prev => {
      const prevUnread = prev.filter(m=>m.sender==='admin'&&!m.read).length
      if (newUnread > prevUnread && prev.length > 0) {
        toast(L('💬 New message from admin!', '💬 管理者から新しいメッセージ', '💬 Nova mensagem do admin!'), { icon:'💬', duration:4000 })
      }
      return data||[]
    })
    setOfficeUnread(newUnread)
  }

  const markRead = async () => {
    await supabase.from('messages').update({read:true}).eq('employee_id',user.id).eq('sender','admin').eq('read',false)
    setOfficeUnread(0)
  }

  const loadTeam = async () => {
    const { data, error } = await supabase.from('employees').select('id,full_name,job_role,leader_id,is_active').eq('is_active', true).order('full_name')
    if (error) { setTeamReady(false); return }
    setCoworkers(data || [])
    const ok = await loadTeamMessages()
    setTeamReady(ok)
  }

  const loadTeamMessages = async () => {
    const { data, error } = await supabase.from('team_messages').select('*')
      .or(`from_employee_id.eq.${user.id},to_employee_id.eq.${user.id}`)
      .order('created_at', { ascending:false }).limit(400)
    if (error) return false
    setTeamMessages(prev => {
      const known = new Set(prev.map(m=>m.id))
      const fresh = prev.length > 0 ? (data||[]).filter(m=>!known.has(m.id)&&m.to_employee_id===user.id) : []
      if (fresh.length) {
        const name = coworkersRef.current.find(c=>c.id===fresh[0].from_employee_id)?.full_name
        toast(fill(e.chatNewFrom, { name: name || '…' }), { icon:'💬', duration:4000 })
      }
      return data || []
    })
    return true
  }

  const markTeamRead = async (fromId) => {
    setTeamMessages(prev => prev.map(m => m.from_employee_id===fromId&&m.to_employee_id===user.id ? { ...m, read:true } : m))
    await supabase.from('team_messages').update({ read:true }).eq('from_employee_id', fromId).eq('to_employee_id', user.id).eq('read', false)
  }

  const markEmployeeMsgRead = async (msgId) => {
    await supabase.from('messages').update({read:true}).eq('id',msgId)
  }

  

  const sendMessage = async (preset) => {
    const text = String(preset ?? newMsg).trim()
    if (!text) return false
    const toOffice = chatOnOffice
    const { error } = toOffice
      ? await supabase.from('messages').insert({ employee_id:user.id, employee_name:user.name, sender:'employee', content:text, read:false })
      : await supabase.from('team_messages').insert({ from_employee_id:user.id, to_employee_id:chatKey, content:text })
    if (error) { toast.error(error.message); return false }
    if (preset === undefined) setNewMsg('')
    setUserScrolled(false)
    if (toOffice) loadMessages(); else loadTeamMessages()
    return true
  }

  const sendChatPhoto = async (file) => {
    if (!file || sendingChatPhoto) return
    setSendingChatPhoto(true)
    try {
      const folder = chatOnOffice ? 'employee' : 'team'
      const path = await uploadJobPhoto(`jobs/chat/${folder}/${user.id}/${crypto.randomUUID()}.jpg`, file)
      await sendMessage(photoMessage(path))
    } catch (err) {
      toast.error(err?.message || L('Upload failed', 'アップロードに失敗しました', 'Falha no envio'))
    } finally {
      setSendingChatPhoto(false)
    }
  }

  const getWeekRange = () => {
    const now = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'}))
    const day = now.getDay()
    const diffToMonday = day===0?-6:1-day
    const monday = new Date(now); monday.setDate(now.getDate()+diffToMonday); monday.setHours(0,0,0,0)
    const sunday = new Date(monday); sunday.setDate(monday.getDate()+6)
    const f = d => d.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]
    return { start:f(monday), end:f(sunday) }
  }

  useEffect(() => {
    if (activeJob?.id && checklist.length) {
      localStorage.setItem(`kp_ck_${activeJob.id}`, JSON.stringify(checklist))
      // The office sees the progress (x of y) on the Agenda while the job runs.
      const id = activeJob.id
      const t = setTimeout(() => {
        supabase.from('jobs').update(checklistUpdate(checklist)).eq('id', id).eq('status', 'in_progress').then(() => {})
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [checklist, activeJob?.id])

  // Automatic ceiling: past N× the planned time the count stops and the worker is asked once.
  const [agendaSettings, setAgendaSettings] = useState(null)
  const capAskedRef = useRef(null)
  const capEndRef = useRef(null)
  useEffect(() => { loadAgendaSettings().then(setAgendaSettings).catch(() => {}) }, [])
  useEffect(() => {
    if (!activeJob?.started_at || !agendaSettings) return
    const planned = plannedMinutes(activeJob, contractForAgendaJob(activeJob, serviceContracts))
    const capMin = Math.round(planned * Number(agendaSettings.cap_factor || 2))
    if (!capMin || elapsed / 60 < capMin || capAskedRef.current === activeJob.id) return
    capAskedRef.current = activeJob.id
    const job = activeJob
    askConfirm({
      title: L('Still working on this job?', 'まだこの作業中ですか？', 'Ainda está neste serviço?'),
      message: L(`It passed ${Math.round(capMin / 60 * 10) / 10}h (the ceiling for this job). The time count is paused until you answer.`,
        `この作業の上限（${Math.round(capMin / 60 * 10) / 10}時間）を超えました。回答までカウントを止めています。`,
        `Passou de ${Math.round(capMin / 60 * 10) / 10}h (o teto deste serviço). A contagem fica pausada até você responder.`),
      confirmLabel: L('Yes, still working', 'はい、作業中', 'Sim, ainda trabalhando'),
      cancelLabel: L('No, I forgot to finish', 'いいえ、終了し忘れ', 'Não, esqueci de finalizar'),
    }).then(still => {
      if (still) { logJobAdmin(job.id, 'cap_confirm', { reason: 'employee', newValue: { capMin } }); return }
      // Time counted stops at the ceiling.
      capEndRef.current = { jobId: job.id, at: new Date(new Date(job.started_at).getTime() + capMin * 60000).toISOString() }
      handleCompleteWithSig(job)
    })
  }, [elapsed, activeJob?.id, agendaSettings])

  // v1.0.112 · ~30 min past the planned time and still not finished: ask once (also as a phone
  // notification when the app is in the background). "Finish now" goes straight to the finish flow.
  const forgotAskedRef = useRef(null)
  useEffect(() => {
    if (!activeJob?.started_at || activeJob.status !== 'in_progress') return
    const key = `kp_forgot_${activeJob.id}`
    let asked = forgotAskedRef.current === activeJob.id
    try { asked = asked || !!sessionStorage.getItem(key) } catch { /* private mode */ }
    const planned = plannedMinutes(activeJob, contractForAgendaJob(activeJob, serviceContracts))
    if (!shouldAskForgot({ elapsedSec: elapsed, plannedMin: planned, asked })) return
    forgotAskedRef.current = activeJob.id
    try { sessionStorage.setItem(key, '1') } catch { /* private mode */ }
    const job = activeJob
    const title = L('Did you forget to finish?', '終了し忘れていませんか？', 'Você esqueceu de finalizar?')
    const place = String(job.title || '').split(' — ')[0]
    try { navigator.vibrate?.([200, 100, 200]) } catch { /* not supported */ }
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.getRegistration?.().then(reg => reg?.showNotification(title, { body: place, tag: key })).catch(() => {})
    }
    askConfirm({
      title,
      message: L(`${place}: it passed ${planned + 30} min (planned ${planned}). If you are done, finish now.`,
        `${place}：予定${planned}分を30分超えました。終わっていれば今すぐ完了してください。`,
        `${place}: passou ${planned + 30} min (previsto ${planned}). Se já terminou, finalize agora.`),
      confirmLabel: L('Finish now', '今すぐ完了', 'Finalizar agora'),
      cancelLabel: L('Still working', 'まだ作業中', 'Ainda trabalhando'),
      danger: false,
    }).then(finish => {
      if (!finish) return
      document.getElementById('active-job-finish')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      handleCompleteWithSig(job)
    })
  }, [elapsed, activeJob?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Photos that failed go up again by themselves when the network comes back.
  useEffect(() => {
    const retry = () => {
      const job = activeJob
      if (!job) return
      for (const slot of ['start', 'end']) {
        const list = jobPhotos.filter(p => p.slot === slot)
        if (list.some(p => photoStatusRef.current[p.id]?.state === 'failed')) uploadSlotPhotos(job.id, list, slot).catch(() => {})
      }
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [activeJob, jobPhotos]) // eslint-disable-line react-hooks/exhaustive-deps
  const retryPhotos = () => {
    if (!activeJob) return
    for (const slot of ['start', 'end']) {
      const list = jobPhotos.filter(p => p.slot === slot)
      if (list.some(p => photoStatusRef.current[p.id]?.state === 'failed'))
        uploadSlotPhotos(activeJob.id, list, slot).then(() => toast.success(L('Photos sent ✓', '写真を送信しました ✓', 'Fotos enviadas ✓'))).catch(() => toast.error(L('Still failing — check the internet', 'まだ失敗 — 通信を確認', 'Ainda falhou — confira a internet')))
    }
  }

  // "Report a problem" inside the job: note + photo to the office chat, marked with the job.
  const sendProblem = async ({ job, text, file }) => {
    const place = String(job.title || '').split(' — ')[0]
    const { error } = await supabase.from('messages').insert({ employee_id: user.id, employee_name: user.name, sender: 'employee', read: false,
      content: problemMessage({ place, date: job.scheduled_date, text, jobId: job.id }) })
    if (error) throw error
    if (file) {
      const path = await uploadJobPhoto(`jobs/${job.id}/problem_${Date.now()}.jpg`, file)
      await supabase.from('messages').insert({ employee_id: user.id, employee_name: user.name, sender: 'employee', read: false, content: photoMessage(path) })
    }
    loadMessages()
  }

  const weekSummary = () => {
    const { start, end } = getWeekRange()
    const weekJobs = enrichJobValues(
      allJobs.filter(j => j.status === 'completed' && j.scheduled_date >= start && j.scheduled_date <= end),
      serviceContracts,
    )
    const gross = weekJobs.reduce((s, j) => s + employeeEarningsForJob(j, empData), 0)
    const deductions = weekDeductions.reduce((s,d)=>s+Number(d.amount||0),0)
    const totalChecklist = weekJobs.reduce((s,j)=>s+(j.checklist_total||0),0)
    const doneChecklist = weekJobs.reduce((s,j)=>s+(j.checklist_done??0),0)
    const rate = totalChecklist>0 ? Math.round((doneChecklist/totalChecklist)*100) : 100
    return { start, end, weekJobs, gross, deductions, net:gross-deductions, totalChecklist, doneChecklist, rate }
  }

  const calcSalary = (allData, empInfo, deductionsList = []) => {
    setSalaryData(calcEmployeeMonthlySalary(empInfo, allData, deductionsList))
  }

  const awardBadges = async (allData, existing) => {
    const earned = existing.map(b=>b.badge_key)
    const done = allData.filter(j=>j.status==='completed')
    const toAward = []
    if (done.length>=1&&!earned.includes('first_job')) toAward.push('first_job')
    if (done.length>=5&&!earned.includes('jobs_5')) toAward.push('jobs_5')
    if (done.length>=10&&!earned.includes('jobs_10')) toAward.push('jobs_10')
    if (done.length>=25&&!earned.includes('jobs_25')) toAward.push('jobs_25')
    const spotsAccepted = allData.filter(j=>j.job_category==='spot'&&(j.spot_status==='accepted'||j.status==='completed'))
    if (spotsAccepted.length>=5&&!earned.includes('spot_master')) toAward.push('spot_master')
    const { start, end } = getWeekRange()
    if (done.filter(j=>j.scheduled_date>=start&&j.scheduled_date<=end).length>=5&&!earned.includes('perfect_week')) toAward.push('perfect_week')
    for (const key of toAward) {
      const def = BADGE_DEFS.find(b=>b.key===key)
      const { error } = await supabase.from('badges').insert({ employee_id:user.id, badge_key:key, badge_name:def?.name })
      if (!error) toast.success(`🏆 ${L('Badge', 'バッジ', 'Conquista')}: ${def?.name}!`)
    }
  }

  // Where the worker is when they start or finish. Never blocks the job:
  // without GPS permission it just returns null.
  const capturePosition = async () => {
    try {
      const pos = await getCurrentPosition()
      return { lat: pos.lat, lng: pos.lng, acc: pos.acc != null ? Math.round(pos.acc) : null }
    } catch { return null }
  }

  const checkGPS = async (job) => {
    setGpsStatus(L('📍 Checking...', '📍 確認中...', '📍 Verificando...'))
    const pos = await capturePosition()
    if (!pos) {
      setGpsStatus(L('⚠️ GPS unavailable', '⚠️ GPSを使用できません', '⚠️ GPS indisponível'))
      return { ok: true, dist: null, override: Boolean(job.gps_lat && job.gps_lng), pos: null }
    }
    // Compare with the store: saved coordinates, else the address / Google Maps link resolved once.
    let site = null
    try { site = await siteCoords(job) } catch { /* offline */ }
    if (!site) {
      // Without the store's location only the reading itself is known, not whether it is at the store.
      setGpsStatus(`📍 GPS${pos.acc ? ` ±${pos.acc}m` : ''} · ${e.gpsNoSite}`)
      return { ok: true, dist: null, override: false, pos }
    }
    const dist = Math.round(distanceMeters(pos.lat, pos.lng, site.lat, site.lng))
    const away = dist > ON_SITE_METERS
    setGpsStatus(away ? `⚠️ ${fill(e.gpsAway, { m: formatDistance(dist) })}` : `✅ ${fill(e.gpsOnSite, { m: formatDistance(dist) })}`)
    return { ok: true, dist, override: away, pos }
  }

  // Employee changes the order of today's services: swap with the next/previous one still to do,
  // then renumber the whole day 1..n so sequence_order has no gaps or duplicates.
  const handleMoveJob = async (job, dir) => {
    if (reorderBusy) return
    const day = sortByOrder(allJobs.filter(j => j.scheduled_date === job.scheduled_date))
    const movable = j => j.status === 'assigned'
    const from = day.findIndex(j => j.id === job.id)
    let to = from + dir
    while (to >= 0 && to < day.length && !movable(day[to])) to += dir
    if (from < 0 || to < 0 || to >= day.length) return
    const order = [...day]
    ;[order[from], order[to]] = [order[to], order[from]]
    // Manual numbers (from MANUAL_ORDER_BASE) so this order wins over the clock for this day.
    const changed = order.map((j, i) => ({ id: j.id, seq: MANUAL_ORDER_BASE + i + 1, old: j.sequence_order })).filter(x => x.seq !== x.old)
    const seqById = Object.fromEntries(changed.map(x => [x.id, x.seq]))
    const previous = allJobs
    setAllJobs(list => list.map(j => seqById[j.id] != null ? { ...j, sequence_order: seqById[j.id] } : j))
    setReorderBusy(true)
    try {
      const results = await Promise.all(changed.map(x =>
        supabase.from('jobs').update({ sequence_order: x.seq }).eq('id', x.id).eq('employee_id', user.id)))
      const failed = results.find(r => r.error)
      if (failed) throw failed.error
      toast.success(e.orderSaved || 'Order saved', { id: 'kp-order-saved' })
      const names = order.filter(j => j.status !== 'cancelled').map((j, i) => `${i + 1}. ${businessName(j)}`).join(' · ')
      supabase.from('messages').insert({ employee_id: user.id, employee_name: user.name, sender: 'employee', read: false,
        content: `🔀 [Sistema] ${user.name} mudou a ordem dos serviços de ${job.scheduled_date}: ${names}` }).then(() => {})
    } catch (err) {
      setAllJobs(previous)
      toast.error(err?.message || 'Could not save the order')
    } finally {
      setReorderBusy(false)
    }
  }

  const handleAcceptSpot = async (job) => {
    // Open offer: the first one to accept keeps it.
    if (job._open) {
      try {
        const r = await takeOffer(job, user)
        if (r === 'taken') toast(L('Someone else already accepted this one.', '他の人が先に承諾しました。', 'Outra pessoa já aceitou este.'), { icon: '⚡' })
        else toast.success(`${e.spotAccepted || L('Accepted!', '承諾しました！', 'Aceito!')} +¥${Number(job.spot_value||0).toLocaleString()}`)
      } catch (err) { toast.error(err.message) }
      loadAll(); return
    }
    // Read the job again: if it was already started, accepting must not touch its status or timer.
    const { data: fresh } = await supabase.from('jobs').select('id,status,started_at').eq('id', job.id).maybeSingle()
    const fields = acceptSpotUpdate(fresh || job)
    let q = supabase.from('jobs').update(fields).eq('id', job.id)
    if (fields.status) q = q.neq('status', 'in_progress')
    const { error } = await q
    if (error) { toast.error(error.message); return }
    toast.success(`${e.spotAccepted || L('Accepted!', '承諾しました！', 'Aceito!')} +¥${Number(job.spot_value||0).toLocaleString()}`); loadAll()
  }
  const handleDeclineSpot = async (job) => {
    // An open offer is not cancelled for everyone: it only leaves this phone.
    if (job._open) { hideOffer(user.id, job.id); setSpotJobs(list => list.filter(j => j.id !== job.id)); return }
    await supabase.from('jobs').update({ spot_status:'declined',status:'cancelled',spot_responded_at:new Date().toISOString() }).eq('id',job.id)
    toast(L('Declined.', '辞退しました。', 'Recusado.')); loadAll()
  }

  const openAddService = async () => {
    const { data } = await supabase
      .from('jobs')
      .select('id, title, employee_id, employee_name, status, started_at, scheduled_date, retro_report, photo_end_url, completed_at')
      .in('scheduled_date', [tokyoToday(), tokyoTomorrow()])
      .in('status', ['assigned', 'in_progress', 'completed'])
    setTodayAllJobs((data || []).filter(j => !isDuskinJob(j)))
    setShowAddService(true)
  }

  const openPastService = (prefill = null) => {
    if (activeJob?.status === 'in_progress') {
      toast(e.finishExistingShift)
      setTab('shift')
      setTimeout(() => {
        const el = document.getElementById('active-job-card')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 150)
      return
    }
    setPastServicePrefill(prefill)
    setShowPastService(true)
  }

  // Late on the same day: only the basic registration, saved as retroactive.
  const handleRegisterLate = (job) => {
    if (overdueBusy) return
    openRetro(job)
  }

  const handleAbandonStaleShift = async (job) => {
    if (!job) return
    const msg = L(
      'Reset this job so you can start fresh? (Timer will be cleared)',
      'この作業をリセットして最初からやり直しますか？（開始時刻が消えます）',
      'Reiniciar este serviço para começar de novo? (O cronômetro será zerado)')
    if (!(await askConfirm({ message: msg, danger: false }))) return
    setSubmitting(true)
    try {
      const { error } = await supabase.from('jobs').update({
        status: 'assigned',
        started_at: null,
      }).eq('id', job.id).eq('status', 'in_progress')
      if (error) throw error
      localStorage.removeItem(`kp_ck_${job.id}`)
      setActiveJob(null)
      setJobPhotos([])
      clearJobVideo()
      setChecklist([])
      setElapsed(0)
      toast.success(e.staleShiftReset)
      await loadAll()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePastService = async ({ location, date, cleaningType, deepComponents }) => {
    if (pastServiceBusy) return
    setPastServiceBusy(true)
    try {
      const result = await preparePastServiceJob(supabase, {
        employee: { id: user.id, name: user.name },
        location,
        date,
        cleaningType,
        deepComponents: cleaningType === 'deep' ? deepComponents : [],
      })
      if (!result.ok) {
        if (result.error === 'already_registered') toast.error(e.pastServiceAlreadyDone)
        else if (result.error === 'in_progress') {
          toast(e.finishExistingShift || e.pastServiceInProgress)
          setTab('shift')
        } else if (result.error === 'blocked') toast.error(e.pastServiceBlocked)
        else if (result.error === 'day_closed') toast.error(e.lateRegisterClosed)
        else if (result.error === 'deep_components_required') toast.error(e.deepComponentsRequired)
        else if (result.error === 'basic_not_available') toast.error(e.basicNotAvailable)
        else if (result.error === 'wrong_deep_day') toast.error(e.wrongDeepDay)
        else toast.error(result.detail || e.addServiceFailed)
        return
      }
      setShowPastService(false)
      setPastServicePrefill(null)
      await loadAll()
      if (result.action === 'finish_existing') {
        toast(e.finishExistingShift)
        setTab('shift')
        setTimeout(() => {
          const el = document.getElementById('active-job-card')
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 150)
        return
      }
      if (result.action === 'transferred') {
        toast.success(fill(e.addServiceTransferred, { location: location.name, name: result.fromEmployee || '—' }))
      } else {
        toast.success(fill(e.pastServiceSuccess, { location: location.name }))
      }
      openRetro(result.job)
      setTab('shift')
    } finally {
      setPastServiceBusy(false)
    }
  }

  const handleAddService = async (location, cleaningType, deepComponents, option, plan = null) => {
    if (addServiceBusy) return
    const date = plan?.date || tokyoToday()
    const forTomorrow = date !== tokyoToday()
    if (option?.state === 'mine') {
      return toast.error(e.addServiceAlreadyYours)
    }
    if (option?.state === 'blocked') {
      return toast.error(e.addServiceBlocked)
    }
    if (option?.state === 'done_today') {
      if (forTomorrow) return toast.error(e.addServiceDoneToday)
      if (isJobFullyRegistered(option.job)) return toast.error(e.pastServiceAlreadyDone)
      setShowAddService(false)
      await handlePastService({ location, date: tokyoToday(), cleaningType, deepComponents })
      return
    }
    setAddServiceBusy(true)
    try {
      const result = await employeeAddService(supabase, {
        employee: { id: user.id, name: user.name },
        location,
        date,
        cleaningType,
        deepComponents: cleaningType === 'deep' ? deepComponents : [],
        shiftStart: plan?.start || null,
        shiftEnd: plan?.end || null,
      })
      if (!result.ok) {
        if (result.error === 'already_yours') toast.error(e.addServiceAlreadyYours)
        else if (result.error === 'already_done_today') toast.error(e.addServiceDoneToday)
        else if (result.error === 'blocked') toast.error(e.addServiceBlocked)
        else if (result.error === 'transfer_race') toast.error(e.addServiceRace)
        else if (result.error === 'deep_components_required') toast.error(e.deepComponentsRequired)
        else if (result.error === 'basic_not_available') toast.error(e.basicNotAvailable)
        else if (result.error === 'wrong_deep_day') toast.error(e.wrongDeepDay)
        else if (result.error === 'shift_end_after_limit') toast.error(fill(e.shiftEndLimit, { time: SHIFT_END_LIMIT }))
        else if (result.error === 'shift_time_invalid') toast.error(e.shiftTimeInvalid)
        else toast.error(result.detail || e.addServiceFailed)
        return
      }
      if (forTomorrow) {
        toast.success(fill(e.tomorrowShiftAdded, { location: location.name, start: plan.start, end: plan.end }))
      } else if (result.action === 'transferred') {
        toast.success(fill(e.addServiceTransferred, { location: location.name, name: result.fromEmployee || '—' }))
      } else if (result.action === 'claimed') {
        toast.success(fill(e.addServiceClaimed, { location: location.name }))
      } else {
        toast.success(fill(e.addServiceSuccess, { location: location.name }))
      }
      setShowAddService(false)
      await loadAll()
      setTab('shift')
    } finally {
      setAddServiceBusy(false)
    }
  }

  // Relatório retroativo: trabalhador descreve o que fez, IA avalia contra o checklist
  const openRetro = (job) => {
    if (!canRegisterLate(job)) { toast.error(e.lateRegisterClosed); return }
    setRetroJob(job)
    setRetroText('')
    setRetroPhoto(null)
    setRetroEval(null)
    setRetroChecklist(initChecklistState(job))
  }

  const retroChecklistRequired = retroChecklist.length <= 3
    ? retroChecklist.length
    : Math.ceil(retroChecklist.length * 0.7)
  const retroChecklistOk = checklistCompleteForRetro(retroChecklist)

  const retroReady = () => {
    if (!retroChecklistOk) {
      toast.error(fill(e.retroChecklistIncomplete, { required: retroChecklistRequired, total: retroChecklist.length }))
      return false
    }
    if (!retroPhoto) { toast.error(e.retroPhotoRequired); return false }
    return true
  }

  // Retro reports are signed too, so every job in the daily report has a signature.
  const requestRetroSignature = () => { if (retroReady()) setRetroSignOpen(true) }

  const submitRetro = async (sigDataUrl) => {
    if (!retroReady()) return
    // The sheet may have stayed open past midnight: the day is closed, the job stays incomplete.
    if (!canRegisterLate(retroJob)) { toast.error(e.lateRegisterClosed); setRetroJob(null); loadAll(); return }
    setRetroBusy(true)
    try {
      const ck = parseChecklistTemplate(checklistTemplateForJob(retroJob))
      const markedDone = retroChecklist.filter(c => c.done).map(c => c.label)
      const total = retroChecklist.length
      const done = retroChecklist.filter(c => c.done).length
      const missedLabels = retroChecklist.filter(c => !c.done).map(c => c.label)
      // Notes are optional: with no text there is nothing for the AI to read, so the marked checklist stands.
      let ev = { itens_feitos: done, itens_total: total, nao_feitos: [], tempo_estimado_min: null, resumo: null }
      if (retroText.trim()) {
        const resp = await fetch('/api/evaluate-report', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            report: retroText,
            checklist: ck,
            jobTitle: retroJob.title,
            markedDone,
          }),
        })
        ev = await resp.json()
        if (ev.error) { toast.error(L('Evaluation error: ', '評価エラー: ', 'Erro na avaliação: ')+ev.error); setRetroBusy(false); return }
      }
      const photoUrl = await uploadJobPhoto(`jobs/${retroJob.id}/retro.jpg`, retroPhoto)
      const { error } = await supabase.from('jobs').update({
        status:'completed', completed_at:new Date().toISOString(),
        retro_report: retroText.trim(), retro_ai_summary: ev.resumo||null,
        retro_time_min: ev.tempo_estimado_min ?? null,
        photo_end_url: photoUrl, admin_reviewed: false, signature_url: sigDataUrl || null,
        checklist_total: total || null, checklist_done: total ? done : null,
        checklist_missed_items: missedLabels.length ? missedLabels.join(', ') : null,
      }).eq('id', retroJob.id)
      if (error) throw error
      finishQuoteJob(retroJob.id) // job from an accepted quote → its invoice goes to the client
      setRetroEval(ev)
      const { data: completedRetro } = await supabase.from('jobs').select('*').eq('id', retroJob.id).maybeSingle()
      if (completedRetro) {
        try {
          await syncServiceReport(supabase, completedRetro)
        } catch (syncErr) {
          console.error('service_report sync failed', syncErr?.message)
        }
      }
      toast.success(e.retroSuccess)
      setTimeout(()=>{ setRetroJob(null); setRetroChecklist([]); loadAll() }, 2500)
    } catch(err) { setRetroEval(null); toast.error(L('Error: ', 'エラー: ', 'Erro: ')+err.message) }
    setRetroBusy(false)
  }

  // All photos of a slot go up at the same time; the first one's path is the job's photo.
  const uploadSlotPhotos = async (jobId, photos, prefix) => {
    // Three at a time: compressing ten photos at once can run an older phone out of memory.
    const paths = new Array(photos.length)
    let next = 0
    const worker = async () => {
      while (next < photos.length) {
        const i = next++
        const ph = photos[i]
        const known = photoStatusRef.current[ph.id]
        if (known?.state === 'sent' && known.path) { paths[i] = known.path; continue }
        setPhotoState(ph.id, { state: 'sending' })
        try {
          paths[i] = await uploadJobPhoto(`jobs/${jobId}/${prefix}_${i}.jpg`, ph.file)
          setPhotoState(ph.id, { state: 'sent', path: paths[i] })
        } catch (err) {
          setPhotoState(ph.id, { state: 'failed' })
          throw err
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, photos.length) }, worker))
    return paths[0] || null
  }

  // Resolves null when NFC is off, 'cancel' when the worker closes the sheet, else the read result.
  const askNfc = (phase, job) => {
    if (!nfcConfig.active) return Promise.resolve(null)
    if (!nfcSupported()) return Promise.resolve({ uid: null, status: 'no_device', tag: null })
    return new Promise(resolve => setNfcScan({ phase, job, resolve }))
  }

  const handleStart = async (job) => {
    // Speech must be unlocked by this tap so the 5-minute voice reminders can play later.
    if (voiceOn) unlockSpeech()
    const startPhotos = jobPhotos.filter(p => p.slot === 'start')
    // The Before photo is required only on jobs marked "photo required" (the card shows the rule).
    if (startPhotos.length === 0 && job.photo_required) {
      toast.error(L('Take at least 1 "Before" photo before starting', '開始前に「作業前」の写真を1枚以上撮ってください', 'Tire ao menos 1 foto "Antes" antes de iniciar'))
      return
    }
    const nfc = await askNfc('start', job)
    if (nfc === 'cancel') return
    setSubmitting(true)
    try {
      const { data: otherActive } = await supabase.from('jobs').select('id,title').eq('employee_id', user.id).eq('status', 'in_progress').maybeSingle()
      if (otherActive && otherActive.id !== job.id) {
        toast.error(e.alreadyInProgress)
        return
      }
      const gpsResult = await checkGPS(job)
      if (gpsResult.override) {
        const proceed = (await askConfirm({ message: gpsResult.dist!=null
          ? fill(L('⚠️ GPS shows you are {m} from the location.\n\nProceed anyway? This will be logged in the report.', '⚠️ GPSでは現場から{m}離れています。\n\nこのまま続けますか？報告書に記録されます。', '⚠️ O GPS mostra que você está a {m} do local.\n\nContinuar mesmo assim? Isso ficará registrado no relatório.'), { m: formatDistance(gpsResult.dist) })
          : L('⚠️ GPS could not confirm you are at the location.\n\nProceed anyway? This will be logged in the report.', '⚠️ GPSで現場にいることを確認できませんでした。\n\nこのまま続けますか？報告書に記録されます。', '⚠️ O GPS não confirmou que você está no local.\n\nContinuar mesmo assim? Isso ficará registrado no relatório.'), danger: false }))
        if (!proceed) { setGpsStatus(''); return }
      }
      const photoUrl = await uploadSlotPhotos(job.id, startPhotos, 'start')
      const startFields = { status:'in_progress',started_at:new Date().toISOString(),photo_start_url:photoUrl }
      // Starting a spot offer means taking it: it is accepted at the same time.
      if (isPendingSpot(job)) Object.assign(startFields, { spot_status:'accepted', spot_responded_at:startFields.started_at })
      const { data, error } = await supabase.from('jobs').update(startFields).eq('id',job.id).select().maybeSingle()
      if (error || !data) { toast.error(error?.message || e.startError); return }
      const gpsFields = {
        start_lat: gpsResult.pos?.lat ?? null, start_lng: gpsResult.pos?.lng ?? null, start_accuracy: gpsResult.pos?.acc ?? null,
        gps_start_distance: gpsResult.dist ?? null, gps_override: Boolean(gpsResult.override),
      }
      try { await supabase.from('jobs').update(gpsFields).eq('id', job.id) } catch (ex) { console.log('gps fields skipped', ex?.message) }
      await saveNfcResult(supabase, job.id, 'start', nfc)
      setChecklist(initChecklistState(job))
      setActiveJob({ ...data, ...gpsFields }); setJobPhotos([]); toast.success(L('✅ Started!', '✅ 開始しました！', '✅ Iniciado!'))
    } catch (err) {
      toast.error(err?.message || e.startError)
    } finally {
      setSubmitting(false)
    }
  }

  const vt = tr.jobVideo || {}

  const clearJobVideo = () => {
    videoTaskRef.current?.abort.abort()
    videoTaskRef.current = null
    setJobVideo(null)
  }

  const pickJobVideo = (file) => {
    videoTaskRef.current?.abort.abort()
    const task = { abort: new AbortController(), file }
    videoTaskRef.current = task
    setJobVideo({ status: 'compressing', progress: 0, slow: !canUseWebCodecs() })
    task.promise = compressVideo(file, {
      signal: task.abort.signal,
      onProgress: (progress) => { if (videoTaskRef.current === task) setJobVideo(v => v && v.status === 'compressing' ? { ...v, progress } : v) },
    }).then(async res => ({ ...res, ...(await videoPoster(res.blob)) })) // poster + duration saved with the video
    task.promise.then(
      (res) => { if (videoTaskRef.current === task) setJobVideo({ status: 'ready', progress: 1, size: res.size }) },
      (err) => {
        if (videoTaskRef.current !== task) return
        videoTaskRef.current = null
        setJobVideo(null)
        if (err?.code === 'aborted') return
        toast.error(err?.code === 'too_large' ? vt.tooLarge : err?.code === 'not_video' ? vt.notVideo : (err?.message || vt.notVideo))
      },
    )
  }

  // Não bloqueia a finalização: espera a compressão (se ainda rodando) e envia em segundo plano.
  // O vídeo fica guardado no celular até o Storage confirmar (ver videoQueue).
  const sendJobVideoAfterComplete = (jobId, task) => {
    if (!task?.promise) return
    // v1.0.100: the admin sees "video uploading…" right away, and while the video is still being
    // compressed the camera file is kept on the phone, so closing the app does not lose it.
    writeVideoStatus(jobId, { status: 'uploading', path: null })
    let compressed = false
    task.promise.then(() => { compressed = true }, () => {})
    const type = task.file && videoTypeInfo(task.file.type, task.file.name)
    const rawSaved = Promise.resolve().then(async () => {
      if (compressed || !type) return null
      const id = await enqueueVideo(jobId, { blob: task.file, ...type, raw: true })
      holdQueuedVideo(id) // this page sends it; the background retry only takes it if the app closes
      return id
    })
    // Compression failed here: release the camera copy so the background retry can try again
    task.promise.catch(() => rawSaved.then(id => holdQueuedVideo(id, false)))
    task.promise
      .then(async (res) => {
        const rawId = await rawSaved
        if (rawId) { await removeQueuedVideo(rawId); holdQueuedVideo(rawId, false) }
        const id = toast.loading(vt.uploading || 'Sending video…')
        const sizeLabel = res.size >= 1024 * 1024 ? `${(res.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(res.size / 1024))} KB`
        let lastPct = -1
        const onProgress = (p) => {
          const pct = Math.round(p * 100)
          if (pct === lastPct) return
          lastPct = pct
          toast.loading(fill(vt.uploadingPct || 'Sending video… {pct}% · {size}', { pct, size: sizeLabel }), { id })
        }
        try {
          await enqueueAndSend(jobId, res, uploadJobVideo, { onProgress })
          toast.success(vt.uploaded || 'Video sent', { id })
        } catch (err) {
          if (err?.queued) toast(vt.queued || 'Video saved on this phone; it will be sent later.', { id, icon: '📶', duration: 7000 })
          else toast.error(fill(vt.uploadFailed || 'Video failed: {msg}', { msg: err?.message || '' }), { id, duration: 6000 })
        }
      })
      .catch(() => { /* erro de compressão já foi avisado */ })
  }

  // Checks what finishing needs (After photo, checklist) before the NFC and signature steps,
  // so the worker is not told about a missing photo only after signing.
  const finishBlocked = (job) => {
    // v1.0.96: the After photo no longer blocks the finish; without it the job waits for the photo.
    const requiredChecklist = resolveChecklistForJob(job, checklist)
    const staleJob = isStaleActiveJob(job, tokyoToday(), elapsed)
    const checklistOk = staleJob
      ? checklistCompleteForRetro(requiredChecklist)
      : checklistComplete(requiredChecklist)
    if (requiredChecklist.length > 0 && !checklistOk) {
      if (checklist.length !== requiredChecklist.length) setChecklist(requiredChecklist)
      toast.error(staleJob
        ? fill(e.staleChecklistHint, {
          required: requiredChecklist.length <= 3 ? requiredChecklist.length : Math.ceil(requiredChecklist.length * 0.7),
          total: requiredChecklist.length,
        })
        : e.markAllChecklist)
      return true
    }
    return false
  }

  // Photos and the finish GPS start as soon as the worker taps Finish, so they are mostly
  // done by the time the signature is confirmed.
  const startFinishUploads = (job) => {
    const photos = jobPhotos
    const startPhotos = photos.filter(p => p.slot === 'start')
    const uploads = Promise.all([
      job.photo_start_url || !startPhotos.length ? Promise.resolve(job.photo_start_url || null) : uploadSlotPhotos(job.id, startPhotos, 'start'),
      uploadSlotPhotos(job.id, photos.filter(p => p.slot === 'end'), 'end'),
    ])
    uploads.catch(() => { /* reported when the finish waits for it */ })
    finishPrepRef.current = { jobId: job.id, photos, uploads, position: capturePosition() }
    return finishPrepRef.current
  }

  // Vídeos que ficaram na fila (sem internet, app fechado no meio do envio): manda ao abrir e quando a rede volta
  useEffect(() => {
    const flush = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      flushVideoQueue(uploadJobVideo).then(({ sent }) => {
        if (sent) toast.success(fill(vt.queueSent || 'Pending video sent ({n})', { n: sent }))
      }).catch(() => {})
    }
    const t = setTimeout(flush, 4000)
    const onVisible = () => { if (document.visibilityState === 'visible') flush() }
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(t)
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCompleteWithSig = async (job) => {
    if (finishBlocked(job)) return
    if (!jobPhotos.some(p => p.slot === 'end')) {
      const ok = await askConfirm({
        title: L('Finish without the After photo?', 'After写真なしで完了しますか？', 'Concluir sem a foto Depois?'),
        message: L('The job is saved as done and shows "waiting for After photo". Send the photo later from the home screen (camera or gallery).',
          '作業は完了として保存され「After写真待ち」と表示されます。写真はあとでホーム画面から送れます（カメラまたはギャラリー）。',
          'O serviço fica concluído e aparece como "aguardando foto Depois". Envie a foto depois pela tela inicial (câmera ou galeria).'),
        confirmLabel: L('Finish now', '今すぐ完了', 'Concluir agora'),
        cancelLabel: L('Take the photo', '写真を撮る', 'Tirar a foto'),
      })
      if (!ok) return
    }
    const prepared = finishPrepRef.current
    if (!(prepared && prepared.jobId === job.id && prepared.photos === jobPhotos)) startFinishUploads(job)
    const nfc = await askNfc('end', job)
    if (nfc === 'cancel') return
    nfcEndRef.current = nfc
    setSignatureJob(job)
    setShowSignature(true)
  }

  const handleComplete = async (sigDataUrl, jobOverride) => {
    const job = jobOverride || activeJob
    if (!job) { toast.error('No active job - please refresh'); return }
    if (finishBlocked(job)) return
    const requiredChecklist = resolveChecklistForJob(job, checklist)
    setSubmitting(true)
    try {
      const prepared = finishPrepRef.current
      const prep = prepared && prepared.jobId === job.id && prepared.photos === jobPhotos ? prepared : startFinishUploads(job)
      finishPrepRef.current = null
      let startPhotoUrl, endPhotoUrl
      try {
        [startPhotoUrl, endPhotoUrl] = await prep.uploads
      } catch (upErr) {
        // A failed upload is tried once more instead of making the worker start over.
        [startPhotoUrl, endPhotoUrl] = await startFinishUploads(job).uploads.catch(() => { throw upErr })
        finishPrepRef.current = null
      }
      if (!startPhotoUrl) {
        toast.error(e.missingBeforePhoto)
        setSubmitting(false)
        return
      }

      const total = requiredChecklist.length
      const done = requiredChecklist.filter(c=>c.done).length
      const missed = total - done
      const missedLabels = requiredChecklist.filter(c=>!c.done).map(c=>c.label)

      // One write marks the job done; the slower extras (photo grade, GPS, report) follow
      // in the background so the worker sees "done" right away.
      const { data: coreRows, error: coreErr } = await supabase.from('jobs').update({
        status:'completed', completed_at:(capEndRef.current?.jobId===job.id ? capEndRef.current.at : new Date().toISOString()), notes_employee:notes,
        photo_start_url: startPhotoUrl, photo_end_url:endPhotoUrl, signature_url:sigDataUrl||null,
        checklist_total: total || null, checklist_done: total ? done : null,
        checklist_missed_items: missedLabels.length ? missedLabels.join(', ') : null,
      }).eq('id',job.id).neq('status','completed').select('id')
      if (coreErr) throw coreErr
      if (!coreRows?.length) {
        // The office already closed this job (v1.0.98 "Fechar manualmente"): keep its time, only add the photos.
        await supabase.from('jobs').update({ photo_end_url: endPhotoUrl }).eq('id', job.id).is('photo_end_url', null)
        await supabase.from('jobs').update({ photo_start_url: startPhotoUrl }).eq('id', job.id).is('photo_start_url', null)
        const { data: closedJob } = await supabase.from('jobs').select('*').eq('id', job.id).maybeSingle()
        if (closedJob) await syncServiceReport(supabase, closedJob).catch(() => {})
        capEndRef.current = null
        clearInterval(timerRef.current)
        localStorage.removeItem(`kp_ck_${job.id}`)
        setActiveJob(null); setElapsed(0); setChecklist([]); setNotes(''); setJobPhotos([])
        toast(L('The office already closed this job. Your photos were added; check the message in the chat.', 'この作業は事務所が終了済みです。写真は追加されました。チャットのメッセージを確認してください。', 'O escritório já fechou este job. Suas fotos foram adicionadas; veja a mensagem no chat.'), { icon: '🔒', duration: 6000 })
        setSubmitting(false)
        loadAll()
        return
      }
      capEndRef.current = null
      finishQuoteJob(job.id) // job from an accepted quote → its invoice goes to the client
      window.dispatchEvent(new Event('kp:facility-updated'))
      const nfcEnd = nfcEndRef.current
      nfcEndRef.current = null

      clearInterval(timerRef.current)
      localStorage.removeItem(`kp_ck_${job.id}`)
      const videoTask = videoTaskRef.current
      videoTaskRef.current = null
      setJobVideo(null)
      sendJobVideoAfterComplete(job.id, videoTask)
      setActiveJob(null); setElapsed(0); setChecklist([]); setNotes(''); setJobPhotos([])
      if (missed>0) toast(fill(e.completePartial, { done, total }), {icon:'⚠️', duration:5000})
      else toast.success(`🎉 ${e.completeSuccess}`)
      setSubmitting(false)
      loadAll()
      finishJobExtras(job, { endPhotoUrl, position: prep.position, nfcEnd, missed, total, missedLabels })
    } catch(e) { toast.error(L('Error: ', 'エラー: ', 'Erro: ')+e.message) }
    setSubmitting(false)
  }

  // After the job is saved as done: NFC, finish GPS, AI photo grade, service report, deduction.
  const finishJobExtras = async (job, { endPhotoUrl, position, nfcEnd, missed, total, missedLabels }) => {
    try { await saveNfcResult(supabase, job.id, 'end', nfcEnd) } catch (ex) { console.log('nfc end skipped', ex?.message) }
    const syncReport = async () => {
      const { data: completedJob } = await supabase.from('jobs').select('*').eq('id', job.id).maybeSingle()
      if (completedJob) await syncServiceReport(supabase, completedJob)
    }
    const gpsSaved = (async () => {
      const endPos = await position
      if (!endPos) return
      // Distance to the site when its location is known; otherwise to where the job was started.
      let site = null
      try { site = await siteCoords(job) } catch { /* offline */ }
      const refLat = site?.lat ?? job.start_lat, refLng = site?.lng ?? job.start_lng
      const endDist = refLat != null && refLng != null ? Math.round(distanceMeters(endPos.lat, endPos.lng, Number(refLat), Number(refLng))) : null
      await supabase.from('jobs').update({ end_lat: endPos.lat, end_lng: endPos.lng, end_accuracy: endPos.acc, gps_end_distance: endDist }).eq('id', job.id)
    })().catch(ex => console.log('gps end skipped', ex?.message))
    const aiSaved = (async () => {
      if (!endPhotoUrl) return
      const resp = await fetch('/api/analyze-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: endPhotoUrl, locationName: job.title }),
      })
      const ev = await resp.json()
      if (ev.nota == null) return
      await supabase.from('jobs').update({
        photo_ai_score: ev.nota ?? null, photo_ai_approved: ev.aprovado ?? null,
        photo_ai_issues: aiIssuesText(ev.problemas),
      }).eq('id', job.id)
      toast(`IA: ${ev.nota}/10${ev.aprovado ? ' ✅' : ' ⚠️'} · ${job.title}`, { duration: 4000 })
    })().catch(ex => console.log('AI photo skipped', ex?.message))
    // The report goes out at once with what is known, and again when GPS and the grade arrive.
    try { await syncReport() } catch (syncErr) { console.error('service_report sync failed', syncErr?.message) }
    await Promise.all([gpsSaved, aiSaved])
    try { await syncReport() } catch (syncErr) { console.error('service_report sync failed', syncErr?.message) }

    // Checklist parcial: só uma SUGESTÃO de desconto. Fica para o escritório revisar (Deductions)
    // e não entra no salário até alguém aprovar (v1.0.96).
    if (missed>0 && total>0 && Number(job.value||0)>0) {
      const deductionAmount = Math.round(Number(job.value)*(missed/total))
      if (deductionAmount>0) {
        const { error: dedErr } = await supabase.from('salary_payments').insert({
          employee_id: user.id, employee_name: user.name,
          period: (job.scheduled_date||tokyoToday()).slice(0,7),
          amount: deductionAmount,
          payment_date: job.scheduled_date||tokyoToday(),
          description: `${REVIEW_PREFIX}Itens não feitos (${missed}/${total}) — ${job.title}: ${missedLabels.join(', ')}`,
          status:'cancelled', payment_type:'deduction', is_deduction:true,
        })
        if (dedErr) console.error('deduction suggestion not saved', dedErr.message)
      }
    }
  }

  const addPhoto = (slot, files) => {
    const cur = jobPhotos.filter(p=>p.slot===slot).length
    const toAdd = Array.from(files).slice(0, 10-cur)
    setJobPhotos(p=>[...p, ...toAdd.map(file=>({ file, preview:URL.createObjectURL(file), slot, id:Date.now()+Math.random() }))])
  }

  const uploadFile = async (file, path) => uploadJobPhoto(path, file)

  const handleSubmitClaim = async () => {
    if (!claimForm.amount) return toast.error(L('Enter amount', '金額を入力してください', 'Informe o valor'))
    setSubmittingClaim(true)
    try {
      const id = Date.now()
      const photoUrl = claimPhoto ? await uploadFile(claimPhoto,`claims/${user.id}/${id}_p.${claimPhoto.name.split('.').pop()}`) : null
      const receiptUrl = claimReceipt ? await uploadFile(claimReceipt,`claims/${user.id}/${id}_r.${claimReceipt.name.split('.').pop()}`) : null
      const job = allJobs.find(j=>j.id===claimForm.job_id)
      const { error } = await supabase.from('transport_claims').insert({ employee_id:user.id, employee_name:user.name, job_id:claimForm.job_id||null, job_title:job?.title||null, amount:parseFloat(claimForm.amount), route:claimForm.route, description:claimForm.description, photo_url:photoUrl, receipt_url:receiptUrl, status:'pending' })
      if (error) throw error
      toast.success(L('Claim submitted!', '申請しました！', 'Pedido enviado!'))
      setClaimForm({ job_id:'', amount:'', route:'', description:'' })
      setClaimPhoto(null); setClaimReceipt(null); setClaimPhotoPreview(null); setClaimReceiptPreview(null)
      loadAll()
    } catch(e) { toast.error(e.message) }
    setSubmittingClaim(false)
  }

  const equipmentStatusLabel = (status) => ({
    pending: e.equipmentStatusPending,
    approved: e.equipmentStatusApproved,
    rejected: e.equipmentStatusRejected,
    fulfilled: e.equipmentStatusFulfilled,
  }[status] || status)

  const payStatusLabel = (status) => ({
    scheduled: L('Scheduled', '予定', 'Agendado'),
    pending: L('Pending', '保留中', 'Pendente'),
    paid: L('Paid', '支払済み', 'Pago'),
  }[status] || status)

  const handleSubmitEquipment = async () => {
    if (!equipmentForm.item_name.trim()) return toast.error(e.equipmentItemRequired)
    if (!equipmentForm.reason.trim() || equipmentForm.reason.trim().length < 10) return toast.error(e.equipmentReasonRequired)
    const productUrl = equipmentForm.product_url.trim()
    if (productUrl) {
      try {
        const parsed = new URL(productUrl)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid')
      } catch { return toast.error(e.equipmentLinkInvalid) }
    }
    setSubmittingEquipment(true)
    try {
      const id = Date.now()
      const photoUrl = equipmentPhoto
        ? await uploadFile(equipmentPhoto, `equipment/${user.id}/${id}.${equipmentPhoto.name.split('.').pop()}`)
        : null
      const qty = Math.max(1, parseInt(equipmentForm.quantity, 10) || 1)
      const { error } = await supabase.from('equipment_requests').insert({
        employee_id: user.id,
        employee_name: user.name,
        category: equipmentForm.category,
        item_name: equipmentForm.item_name.trim(),
        quantity: qty,
        reason: `${equipmentForm.reason.trim()}${productUrl ? `\n\n[Product link] ${productUrl}` : ''}`,
        photo_url: photoUrl,
        status: 'pending',
      })
      if (error) throw error
      toast.success(e.equipmentSubmitSuccess)
      setEquipmentForm({ category: 'supplies', item_name: '', quantity: '1', reason: '', product_url: '' })
      setEquipmentPhoto(null)
      if (equipmentPhotoPreview) URL.revokeObjectURL(equipmentPhotoPreview)
      setEquipmentPhotoPreview(null)
      loadAll()
    } catch (err) {
      toast.error(err.message)
    }
    setSubmittingEquipment(false)
  }

  const fmt = s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
  const scoreColor = s=>s>=90?'#4ade80':s>=70?'#fbbf24':'#f87171'
  const today = tokyoToday()

  const displayDate = (job) => job.scheduled_date

  const getNextShiftJob = (jobList) => [...(jobList||[])]
    .filter(j => j.scheduled_date >= today && ['assigned','in_progress'].includes(j.status))
    .sort((a,b) => `${a.scheduled_date} ${a.scheduled_time||'00:00'}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time||'00:00'}`))[0] || null

  const todayJobs = sortByOrder(allJobs.filter(j=>j.scheduled_date===today))
  const todayPendingJobs = todayJobs.filter(j=>['assigned','in_progress'].includes(j.status))

  // GPS on the home map: where the employee is now, where today's sites are, and the nearest one.
  const pendingKey = todayPendingJobs.map(j=>j.id).join(',')
  useEffect(() => {
    if (tab !== 'home' || !todayPendingJobs.length) return
    let alive = true
    const tick = async () => { const p = await capturePosition(); if (alive && p) setHerePos(p) }
    tick()
    const id = setInterval(tick, 60000)
    ;(async () => {
      const found = {}
      for (const j of todayPendingJobs) {
        try { const c = await siteCoords(j); if (c) found[j.id] = c } catch { /* no coords */ }
      }
      if (alive) setSiteCoordsById(found)
    })()
    return () => { alive = false; clearInterval(id) }
  }, [tab, pendingKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const nearby = activeJob ? null : nearestJob(todayPendingJobs, siteCoordsById, herePos)
  const todayAllDone = todayJobs.length>0 && todayPendingJobs.length===0
  const nextShiftJob = getNextShiftJob(allJobs)
  const tomorrow = tokyoTomorrow()
  const laterJobs = upcomingJobs(allJobs, today)
  const tomorrowJobs = laterJobs.filter(j => j.scheduled_date === tomorrow)
  const whenLabel = (date) => date === tomorrow ? e.tomorrow : date

  const S = {
    card: { background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:18, padding:16, marginBottom:12 },
    label: { fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:1.2, textTransform:'uppercase', marginBottom:7, display:'block' },
    input: { width:'100%', padding:'12px 14px', fontSize:14, borderRadius:12, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.06)', color:'#fff', fontFamily:'inherit', boxSizing:'border-box' },
  }

  const PhotoGrid = ({ slot, label }) => {
    const photos = jobPhotos.filter(p=>p.slot===slot)
    return (
      <div style={{marginBottom:14}}>
        <span style={S.label}>{label} ({photos.length}/10)</span>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:4}}>
          {photos.map(p=>(
            <div key={p.id} style={{position:'relative',aspectRatio:'1',borderRadius:10,overflow:'hidden'}}>
              <img src={p.preview} style={{width:'100%',height:'100%',objectFit:'cover'}} />
              <button onClick={()=>setJobPhotos(ps=>ps.filter(ph=>ph.id!==p.id))} style={{position:'absolute',top:3,right:3,width:20,height:20,borderRadius:'50%',background:'rgba(0,0,0,0.7)',border:'none',color:'#fff',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
          ))}
          {photos.length<10&&(
            <div onClick={()=>{const inp=photoInputRef.current;inp.dataset.slot=slot;if(slot==='end')inp.removeAttribute('capture');else inp.setAttribute('capture','environment');inp.click()}} style={{aspectRatio:'1',borderRadius:10,border:'2px dashed rgba(255,255,255,0.15)',background:'rgba(255,255,255,0.03)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',gap:4}}>
              <span style={{fontSize:22}}>📷</span><span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{L('Add', '追加', 'Adicionar')}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  const planAlert = planningAlert(weekPlans, today)
  const lastAdminMsg = messages.filter(m=>m.sender==='admin').slice(-1)[0]
  const chatSections = teamReady ? buildChatSections({ me:user, employees:coworkers, teamMessages, officeMessages:messages, teamReady }) : null
  const lastTeamUnread = teamMessages.find(m=>m.to_employee_id===user.id&&!m.read)
  const chatMenuPreview = officeUnread>0&&lastAdminMsg ? lastAdminMsg.content : lastTeamUnread ? lastTeamUnread.content : null
  // v1.0.96 · lean employee menu: My day, My jobs, My salary, My requests, Chat (+ World, AI).
  // Screens that used to be separate menu entries now open as tabs inside their group.
  const MENU_GROUPS = {
    jobs: [['history', e.allJobs], ['calendar', L('Calendar & availability','カレンダーと勤務可能日','Calendário e disponibilidade')], ['spots', e.spotJobs], ['achievements', e.achievements]],
    requests: [['equipment', e.equipment], ['transport', e.transport]],
  }
  const groupOf = key => Object.keys(MENU_GROUPS).find(g => MENU_GROUPS[g].some(([k]) => k === key))
  const menuItems = [
    {key:'home',icon:'🏠',label:e.home},
    {key:'shift',icon:'🗺',label:L('My day','今日の予定','Meu dia')},
    ...(quickRoundOn?[{key:'quickround',icon:'⚡',label:L('Quick round','クイックラウンド','Rodada rápida'),hint:L('Time only, no checklist or photo','時刻のみ・チェックリストや写真なし','Só horário, sem checklist nem foto')}]:[]),
    {key:'history',group:'jobs',icon:'📅',label:L('My jobs','自分の作業','Meus jobs'),hint:L('History · calendar & availability · spots','履歴・カレンダーと勤務可能日・スポット','Histórico · calendário e disponibilidade · spots'),badge:spotJobs.length+(planAlert?1:0)},
    {key:'salary',icon:'💴',label:L('My salary','自分の給与','Meu salário')},
    {key:'equipment',group:'requests',icon:'🧾',label:L('My requests','申請','Meus pedidos'),hint:`${e.equipment} · ${e.transport}`},
    {key:'chat',icon:'💬',label:e.chat,badge:unreadMsgs,preview:unreadMsgs>0&&chatMenuPreview?chatPreview(chatMenuPreview, '📷').substring(0,30):null},
    {key:'world',icon:'🌏',label:tr.facility.tab},
    {key:'profile',icon:'👤',label:L('My profile','マイプロフィール','Meu perfil'),hint:L('Your data and password','自分の情報とパスワード','Seus dados e senha')},
  ]

  const bottomTabs = [
    {key:'home',label:e.home,icon:'⌂'},
    {key:'shift',label:L('My day','今日の予定','Meu dia'),icon:'▶'},
    {key:'quick'},
    {key:'salary',label:L('My salary','自分の給与','Meu salário'),icon:'¥'},
    {key:'chat',label:e.chat,icon:'✉',badge:unreadMsgs},
  ]
  const quickActions = [
    !activeJob&&{icon:'✓',label:e.pastServiceButton,hint:e.pastServiceHint,run:()=>openPastService()},
    {icon:'＋',label:e.addService,hint:e.addServiceHint,run:openAddService},
    {icon:'🗓',label:e.availability,hint:e.availabilityHint,run:()=>openAvailability()},
    {icon:'🚃',label:e.transport,hint:e.transportHint,run:()=>goToTab('transport')},
    {icon:'🧰',label:e.equipment,hint:e.equipmentHint,run:()=>goToTab('equipment')},
  ].filter(Boolean)

  const currentTabLabel = menuItems.find(m=>m.key===tab)?.label || (groupOf(tab) && menuItems.find(m=>m.group===groupOf(tab))?.label)

  const scrollToActiveJob = () => {
    setTimeout(() => {
      const el = document.getElementById('active-job-card')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 200)
  }

  const timeOffNotices = unseenDecisions(myTimeOff, seenTimeOff)
  const salaryNotices = salaryAnswers.filter(c => !seenAnswers.has(answerKey(c)))
  const payslipPending = !!statement && !statement.employee_confirmed_at && !statement.employee_disputed_at && canConfirmPeriod(statement.period)
  const bellCount = unreadMsgs + timeOffNotices.length + salaryNotices.length + (payslipPending ? 1 : 0) + spotJobs.length + agendaNotices.length + closedOffers.length
  const ackAgenda = async () => {
    const ids = agendaNotices.map(n => n.id)
    setAgendaNotices([])
    await ackNotices(ids)
    loadAll()
  }
  // A change to my agenda pops one short toast; the details stay in the bell until "Got it".
  const toastedNotices = useRef(new Set())
  useEffect(() => {
    const fresh = agendaNotices.filter(n => !toastedNotices.current.has(n.id))
    if (!fresh.length) return
    fresh.forEach(n => toastedNotices.current.add(n.id))
    toast(L('Your agenda changed — see the bell', '予定が変わりました — ベルを確認', 'Sua agenda mudou — veja o sino'), { icon: '📌', id: 'kp-agenda-notice' })
  }, [agendaNotices.map(n => n.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const dismissClosed = () => { dismissClosedOffers(user.id, closedOffers.map(j => j.id)); setClosedOffers([]) }

  // Home opens the salary pop-up by itself once per visit: an answer first, then the payslip to confirm.
  useEffect(() => {
    if (tab !== 'home' || salaryPopupShown.current) return
    if (salaryNotices.length) { salaryPopupShown.current = true; setAnswerOpen(salaryNotices[0]) }
    else if (payslipPending) { salaryPopupShown.current = true; setPayslipOpen(true) }
  }, [tab, salaryNotices.length, payslipPending]) // eslint-disable-line react-hooks/exhaustive-deps
  const closeBell = () => {
    setBellOpen(false)
    if (timeOffNotices.length) setSeenTimeOff(markSeen(user.id, seenTimeOff, myTimeOff))
  }
  const bellGo = (key) => { closeBell(); goToTab(key) }

  // One short toast per new answer; the details stay in the bell until opened
  useEffect(() => {
    const fresh = timeOffNotices.filter(r => !toastedTimeOff.current.has(r.id + ':' + r.status))
    if (!fresh.length) return
    fresh.forEach(r => toastedTimeOff.current.add(r.id + ':' + r.status))
    toast(e.timeOffNoticeToast, { icon: '🔔', id: 'kp-timeoff-notice' })
  }, [timeOffNotices.map(r => r.id + ':' + r.status).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opening the full list also counts as seeing the answers
  useEffect(() => {
    if (tab === 'availability' && timeOffNotices.length) setSeenTimeOff(markSeen(user.id, seenTimeOff, myTimeOff))
  }, [tab, myTimeOff]) // eslint-disable-line react-hooks/exhaustive-deps

  const goToTab = (key) => {
    setTab(key)
    if (key === 'shift' && activeJob) scrollToActiveJob()
  }

  useEffect(() => {
    if (tab === 'shift' && activeJob) scrollToActiveJob()
  }, [tab, activeJob?.id])

  useEffect(() => {
    setJobContract(null)
    if (!selectedJob?.id || selectedJob.job_category !== 'spot') return
    let alive = true
    supabase.from('spot_contracts').select('*').eq('job_id', selectedJob.id).eq('is_active', true).maybeSingle()
      .then(({ data }) => { if (alive) setJobContract(data || null) })
    return () => { alive = false }
  }, [selectedJob?.id])

  const signJobContract = async (dataUrl, signedBy) => {
    const { data, error } = await supabase.from('spot_contracts')
      .update({ signature_url: dataUrl, signed_by: signedBy, signed_at: new Date().toISOString(), status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', jobContract.id).select().single()
    if (error) return toast.error(error.message)
    setJobContract(data)
    setContractSignOpen(false)
    toast.success(e.contractSaved)
    refreshSpotContractPdf(data.id)
  }

  // Photo of the paper contract / proof on site, stored on the contract
  const contractPhotoRef = useRef()
  const addContractPhoto = async (file) => {
    if (!file || !jobContract) return
    try {
      const path = await uploadJobPhoto(`jobs/${jobContract.job_id || 'contracts'}/contract_${jobContract.id}_${Date.now()}.jpg`, file)
      const { data, error } = await supabase.from('spot_contracts').update({ proof_photos: [...(jobContract.proof_photos || []), path] }).eq('id', jobContract.id).select().single()
      if (error) throw error
      setJobContract(data)
      toast.success(e.contractPhotoSaved)
    } catch (err) { toast.error(err.message) }
  }

  // Google Calendar subscribes to the worker's private .ics feed, so every job shows up there.
  const syncMyCalendar = async () => {
    try {
      const url = await fetchCalendarFeedUrl()
      const webcal = url.replace(/^https?:/, 'webcal:')
      window.open(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`, '_blank', 'noopener')
      navigator.clipboard?.writeText(url).catch(() => {})
      toast.success(e.calSyncDone, { duration: 7000 })
    } catch {
      toast.error(e.calSyncFail)
    }
  }

  // Smart Facility: mapa 3D do local (aprovado ou rascunho) — só mostra o botão quando existe.
  // Recarrega ao voltar para o app: um mapa criado/aprovado depois de abrir o app aparece sem precisar sair.
  useEffect(() => {
    const load = () => supabase.from('facility_models').select('client_id,location_name,status')
      .then(({ data }) => setFacilityIndex(data || []))
    load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(load, 5 * 60000)
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(id) }
  }, [])
  // Job due / spot to accept: pop-up + sound + voice now, then again every 5 minutes until answered.
  const [dueAlert, setDueAlert] = useState(null)
  const dueSeenRef = useRef({})
  const dueMinute = Math.floor(clock.getTime() / 60000)
  const dueList = useMemo(() => {
    const list = dueAlertJobs(allJobs, { activeJobId: activeJob?.id, hasActiveJob: !!activeJob })
    // Quick round (Alexandre) ticks places off its own list: only spot offers alert there.
    return quickRoundOn ? list.filter(x => x.kind === 'accept') : list
  }, [allJobs, activeJob, quickRoundOn, dueMinute]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dueList.length) { setDueAlert(null); return }
    const next = dueList.find(x => dueSeenRef.current[x.job.id] !== dueAlertSlot(x.past))
    if (next) {
      dueSeenRef.current[next.job.id] = dueAlertSlot(next.past)
      setDueAlert(next)
      ringDueAlert(next, { labels: e, lang, voiceOn })
    } else {
      setDueAlert(cur => cur ? dueList.find(x => x.job.id === cur.job.id) || null : null)
    }
  }, [dueList]) // eslint-disable-line react-hooks/exhaustive-deps

  // Jobs the admin adds or offers while the app is open show up without reopening it.
  const activeJobRef = useRef(null)
  activeJobRef.current = activeJob
  useEffect(() => {
    const refresh = () => { if (!activeJobRef.current && document.visibilityState === 'visible') loadAll() }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(refresh, 3 * 60000)
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(id) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const goStartDueJob = (job) => {
    setDueAlert(null)
    setTab('shift')
    setTimeout(() => document.getElementById(`job-card-${job.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
  }

  const hasFacility = (job) => !!job?.client_id && facilityIndex.some(m => m.client_id === job.client_id
    && (!m.location_name || m.location_name === locationFromJob(job)))

  const [focusJobId, setFocusJobId] = useState(null)
  const openAvailability = () => { goToTab('calendar'); setTimeout(() => document.getElementById('my-availability')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300) }
  // AI help lives inside the job (sheet opened from the job card), not as a main tab.
  const [aiJob, setAiJob] = useState(null)
  const JobModal = ({ job, onClose }) => {
    const duration = job.started_at&&job.completed_at?Math.round((new Date(job.completed_at)-new Date(job.started_at))/60000):null
    const cl = (job.checklist_template||'').split('\n').filter(Boolean)
    const dDate = displayDate(job)
    const instructions = keyboxForJob(job)
    return (
      <div className="emp-sheet-backdrop" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}} onClick={onClose}>
        <div className="emp-sheet" style={{background:'#0d1f35',borderRadius:'24px 24px 0 0',padding:'20px 20px 50px',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
          <div style={{width:40,height:4,background:'rgba(255,255,255,0.15)',borderRadius:2,margin:'0 auto 18px'}} />
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
            <div style={{flex:1,marginRight:12}}>
              <div style={{fontSize:18,fontWeight:700,color:'#fff',lineHeight:1.3,marginBottom:4}}>{job.title}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{job.client_name}</div>
            </div>
            <div style={{fontSize:18,fontWeight:800,color:'#c19c56'}}>¥{Number(job.spot_value||job.value||0).toLocaleString()}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7,marginBottom:14}}>
            {[['📅 '+e.jobDate,dDate],['🕐 '+e.jobStart,job.scheduled_time||'—'],['▶ '+e.jobIn,job.started_at?new Date(job.started_at).toLocaleTimeString(localeOf(lang),{hour:'2-digit',minute:'2-digit'}):'—'],['🏁 '+e.jobOut,job.completed_at?new Date(job.completed_at).toLocaleTimeString(localeOf(lang),{hour:'2-digit',minute:'2-digit'}):'—'],['⏱ '+e.jobDuration,duration?`${Math.floor(duration/60)}h ${duration%60}m`:'—'],[e.jobStatus,isMissedJob(job)?e.statusIncomplete:`${tr.status[job.status]||job.status}${isRetroJob(job)?` · ${e.retroBadge}`:''}`]].map(([l,v])=>(
              <div key={l} style={{background:'rgba(255,255,255,0.06)',borderRadius:12,padding:'10px 12px'}}>
                <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3}}>{l}</div>
                <div style={{fontSize:12,fontWeight:500,color:'#fff'}}>{v}</div>
              </div>
            ))}
          </div>
          {instructions&&<div style={{background:'rgba(255,255,255,0.05)',borderRadius:12,padding:'12px 14px',marginBottom:12}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:5}}>📋 {e.instructionsKeybox}</div>
            <KeyReveal value={instructions} multiline icon="" source="employee_job" refId={job.id} label={job.title} linkColor="#c19c56" style={{fontSize:13,color:'rgba(255,255,255,0.75)',lineHeight:1.7}} />
          </div>}
          {cl.length>0&&<div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:7,letterSpacing:1,textTransform:'uppercase'}}>Checklist — {job.checklist_total ? `${job.checklist_done ?? 0}/${job.checklist_total}` : fill(e.checklistCount,{n:cl.length})}</div>
            {cl.map((label,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}><div style={{width:20,height:20,borderRadius:6,background:'rgba(255,255,255,0.08)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:10,color:'rgba(255,255,255,0.4)'}}>{i+1}</div><span style={{fontSize:13,color:'rgba(255,255,255,0.75)'}}>{label}</span></div>)}
          </div>}
          {job.notes_employee&&<div style={{background:'rgba(255,255,255,0.05)',borderRadius:12,padding:'10px 12px',marginBottom:12}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3}}>{e.yourNotes}</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.5}}>{job.notes_employee}</div>
          </div>}
          {(job.photo_start_url||job.photo_end_url)&&<div style={{marginBottom:14}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:7,letterSpacing:1,textTransform:'uppercase'}}>{e.photos}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <JobPhoto url={job.photo_start_url} label={e.photoStart} />
              <JobPhoto url={job.photo_end_url} label={e.photoEnd} />
            </div>
          </div>}
          {hasFacility(job)&&<button type="button" onClick={()=>setFacilityJob(job)} style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:8,background:'rgba(193,156,86,0.12)',border:'1px solid rgba(193,156,86,0.3)',borderRadius:14,padding:'13px',color:'#c19c56',fontSize:14,fontWeight:700,cursor:'pointer',marginBottom:10}}>{tr.facility.openModel}</button>}
          {hasMapsLink(job.address, job.title)&&<a href={mapsOpenUrl(job.address, job.title)} target="_blank" rel="noreferrer" style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,background:'rgba(96,165,250,0.1)',border:'1px solid rgba(96,165,250,0.2)',borderRadius:14,padding:'13px',textAlign:'center',color:'#60a5fa',fontSize:14,fontWeight:600,textDecoration:'none',marginBottom:10}}>🗺 {e.openMaps}</a>}
          {jobContract&&jobContract.job_id===job.id&&<div style={{background:'rgba(193,156,86,0.08)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:14,padding:'12px 14px',marginBottom:10}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:4}}>📄 {e.contractTitle} · {jobContract.contract_number}</div>
            {contractStatus(jobContract)==='approved'
              ? <div style={{fontSize:13,color:'#16a37e',fontWeight:600}}>✓ {e.contractSigned}{jobContract.signed_by?` · ${jobContract.signed_by}`:''}</div>
              : contractStatus(jobContract)==='draft'&&<button onClick={()=>setContractSignOpen(true)} style={{width:'100%',padding:'12px',borderRadius:12,border:'none',background:'linear-gradient(135deg,#c19c56,#e8c47a)',color:'#0a1929',fontSize:14,fontWeight:700,cursor:'pointer'}}>✍️ {e.contractSign}</button>}
            <input ref={contractPhotoRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={ev=>{addContractPhoto(ev.target.files?.[0]);ev.target.value=''}} />
            <button onClick={()=>contractPhotoRef.current?.click()} style={{width:'100%',marginTop:8,padding:'10px',borderRadius:12,border:'1px dashed rgba(255,255,255,0.2)',background:'none',color:'rgba(255,255,255,0.7)',fontSize:13,cursor:'pointer'}}>📷 {e.contractPhoto}{(jobContract.proof_photos||[]).length?` (${jobContract.proof_photos.length})`:''}</button>
          </div>}
          {job.scheduled_date&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
            <a href={googleCalendarUrl(job)} target="_blank" rel="noreferrer" style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:14,padding:'12px 8px',textAlign:'center',color:'#fff',fontSize:12,fontWeight:600,textDecoration:'none'}}>📅 {e.calGoogle}</a>
            <button onClick={()=>downloadJobIcs(job)} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:14,padding:'12px 8px',color:'rgba(255,255,255,0.75)',fontSize:12,fontWeight:600,cursor:'pointer'}}>🗓 {e.calIcs}</button>
            <button onClick={syncMyCalendar} style={{gridColumn:'1/-1',background:'none',border:'1px dashed rgba(255,255,255,0.15)',borderRadius:14,padding:'10px 8px',color:'rgba(255,255,255,0.6)',fontSize:12,cursor:'pointer'}}>🔄 {e.calSync}</button>
          </div>}
          {job.status!=='completed'&&<div style={{fontSize:12,fontWeight:700,marginBottom:10,color:job.photo_required?'#f87171':'rgba(255,255,255,0.5)'}}>📷 {job.photo_required?L('Before photo required to start','開始には作業前写真が必要','Foto Antes obrigatória para iniciar'):L('Before photo optional · After can be sent later','作業前写真は任意・作業後はあとで送信可','Foto Antes opcional · Depois pode ser enviada mais tarde')}</div>}
          {job.status!=='completed'&&<button onClick={()=>{ onClose(); setAiJob(job) }} style={{width:'100%',padding:'12px',borderRadius:14,border:'1px solid rgba(168,85,247,0.4)',background:'rgba(168,85,247,0.12)',color:'#d8b4fe',fontSize:13,fontWeight:700,cursor:'pointer',marginBottom:10}}>✦ {L('Ask the AI about this job','この作業についてAIに質問','Perguntar à IA sobre este job')}</button>}
          {/* One place to execute: today's jobs open in My day with checklist, photos, start and finish. */}
          {job.scheduled_date===today&&['assigned','in_progress'].includes(job.status)&&<button onClick={()=>{ onClose(); setFocusJobId(job.id); goToTab('shift') }} style={{width:'100%',padding:'14px',borderRadius:14,border:'none',background:'linear-gradient(135deg,#60a5fa,#3b82f6)',color:'#fff',fontSize:14,fontWeight:800,cursor:'pointer',marginBottom:10}}>{job.status==='in_progress'?L('▶ Continue this job','▶ この作業を続ける','▶ Continuar este job'):L('▶ Open to do this job','▶ この作業を開く','▶ Abrir para executar')}</button>}
          {job.status==='assigned'&&!activeJob&&canRegisterLate(job)&&<button onClick={()=>{ onClose(); openRetro(job) }} style={{width:'100%',padding:'14px',borderRadius:14,border:'1px solid rgba(193,156,86,0.3)',background:'rgba(193,156,86,0.12)',color:'#c19c56',fontSize:14,fontWeight:700,cursor:'pointer',marginBottom:10}}>📝 {e.retroReport}</button>}
          <button onClick={onClose} style={{width:'100%',padding:'14px',borderRadius:14,border:'none',background:'rgba(255,255,255,0.07)',color:'rgba(255,255,255,0.5)',fontSize:14,fontWeight:600,cursor:'pointer'}}>{e.close}</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`emp-backdrop${themeClass}`}>
    <div className={`emp-shell${themeClass}`} style={{width:'100%',minHeight:'100vh',background:'#060d18',display:'flex',flexDirection:'column',maxWidth:430,margin:'0 auto',WebkitTapHighlightColor:'transparent',fontFamily:'"Plus Jakarta Sans","Noto Sans JP",-apple-system,sans-serif',paddingBottom:70}}>
      <input type="file" ref={photoInputRef} accept="image/*" capture="environment" multiple style={{display:'none'}} onChange={e=>{const slot=photoInputRef.current.dataset.slot||'end';addPhoto(slot,e.target.files);e.target.value=''}} />
      <input type="file" ref={claimPhotoRef} accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){if(claimPhotoPreview)URL.revokeObjectURL(claimPhotoPreview);setClaimPhoto(f);setClaimPhotoPreview(URL.createObjectURL(f))}}} />
      <input type="file" ref={claimReceiptRef} accept="image/*,application/pdf" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){if(claimReceiptPreview)URL.revokeObjectURL(claimReceiptPreview);setClaimReceipt(f);setClaimReceiptPreview(URL.createObjectURL(f))}}} />

      {/* Called as a function, not <JobModal>, so the every-second clock re-render keeps the same DOM and scroll position */}
      {selectedJob&&JobModal({ job: selectedJob, onClose: ()=>setSelectedJob(null) })}
      {problemJob&&<ProblemSheet job={problemJob} onSend={sendProblem} onClose={()=>setProblemJob(null)} L={L} />}
      {aiJob&&(
        <div className="emp-sheet-backdrop" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:210,display:'flex',flexDirection:'column',justifyContent:'flex-end'}} onClick={()=>setAiJob(null)}>
          <div className="emp-sheet" style={{background:'#0d1f35',borderRadius:'24px 24px 0 0',padding:'14px 12px 20px',height:'85vh',display:'flex',flexDirection:'column'}} onClick={ev=>ev.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,padding:'0 6px'}}>
              <strong style={{color:'#fff',fontSize:14}}>✦ {L('AI help','AIヘルプ','Ajuda da IA')} · {businessName(aiJob)}</strong>
              <button type="button" onClick={()=>setAiJob(null)} aria-label={e.close} style={{background:'none',border:'none',color:'#fff',fontSize:22,cursor:'pointer'}}>×</button>
            </div>
            <div className="emp-ai-chat" style={{flex:1,minHeight:0}}><AIChatPanel compact mode="employee" employeeId={user.id} employeeName={user.name} /></div>
          </div>
        </div>
      )}
      {dueAlert&&<JobDueAlert item={dueAlert} others={Math.max(0, dueList.length - 1)} labels={e}
        onAccept={async job=>{ await handleAcceptSpot(job); setDueAlert(null) }}
        onDecline={async job=>{ await handleDeclineSpot(job); setDueAlert(null) }}
        onGoStart={goStartDueJob}
        onLater={()=>setDueAlert(null)} />}
      {facilityJob&&<FacilityModal clientId={facilityJob.client_id} locationName={locationFromJob(facilityJob)} title={locationFromJob(facilityJob) || facilityJob.client_name} t={tr.facility} lang={lang} job={facilityJob} employee={{ id: user?.id, name: user?.name }} onClose={()=>setFacilityJob(null)} />}
      {nfcScan&&<NfcScanSheet
        phase={nfcScan.phase}
        job={nfcScan.job}
        tags={nfcConfig.tags}
        labels={e}
        onDone={(r)=>{ const done = nfcScan.resolve; setNfcScan(null); done(r) }}
        onCancel={()=>{ const done = nfcScan.resolve; setNfcScan(null); done('cancel') }}
      />}
      {showSignature&&<SignatureModal
        jobTitle={signatureJob?.title||activeJob?.title||''}
        labels={e}
        onConfirm={(sig)=>{ const job = signatureJob || activeJob; setShowSignature(false); setSignatureJob(null); handleComplete(sig, job) }}
        onCancel={()=>{ setShowSignature(false); setSignatureJob(null) }}
      />}
      {retroSignOpen&&retroJob&&<SignatureModal
        jobTitle={retroJob.title||''}
        labels={e}
        onConfirm={(sig)=>{ setRetroSignOpen(false); submitRetro(sig) }}
        onCancel={()=>setRetroSignOpen(false)}
      />}
      {contractSignOpen&&jobContract&&<ContractSignModal
        contract={jobContract}
        labels={{ title: e.contractTitle, name: e.contractSignName, signHere: e.contractSignHere, agree: e.contractAgree, clear: e.clear, cancel: e.cancel, confirm: e.confirm }}
        onCancel={()=>setContractSignOpen(false)}
        onConfirm={signJobContract}
      />}
      {trainingModal&&<TrainingModal job={trainingModal.job} contract={trainingModal.contract} onClose={()=>setTrainingModal(null)} lang={lang} labels={e} />}
      {showAddService&&(
        <AddServiceModal
          employeeId={user.id}
          todayJobs={todayAllJobs}
          labels={e}
          lang={lang}
          busy={addServiceBusy}
          onClose={()=>!addServiceBusy&&setShowAddService(false)}
          onAdd={handleAddService}
        />
      )}
      {showPastService&&(
        <PastServiceModal
          labels={e}
          lang={lang}
          busy={pastServiceBusy}
          prefill={pastServicePrefill}
          onClose={()=>!pastServiceBusy&&setShowPastService(false)}
          onSubmit={handlePastService}
        />
      )}

      {retroJob&&(
        <div className="emp-sheet-backdrop" style={{position:'fixed',inset:0,zIndex:200,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={()=>!retroBusy&&setRetroJob(null)}>
          <div className="emp-sheet" onClick={e=>e.stopPropagation()} style={{background:'#0d1f35',borderRadius:'24px 24px 0 0',padding:20,width:'100%',maxWidth:480,maxHeight:'88vh',overflowY:'auto'}}>
            <div style={{fontSize:16,fontWeight:700,color:'#fff',marginBottom:4}}>📝 {e.retroTitle}</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:14}}>{retroJob.title.replace(/ — .*/,'')} · {retroJob.scheduled_date}</div>

            {!retroEval ? (<>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:8}}>{e.retroChecklistHint}</div>
              <ChecklistPicker checklist={retroChecklist} setChecklist={setRetroChecklist} labels={e} lang={lang} />

              <label style={{fontSize:11,color:'rgba(255,255,255,0.5)',fontWeight:600,marginTop:12,display:'block'}}>{e.retroTextLabel}</label>
              <textarea value={retroText} onChange={e=>setRetroText(e.target.value)} rows={5} placeholder={e.retroTextPlaceholder} style={{width:'100%',marginTop:6,marginBottom:12,borderRadius:12,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.04)',color:'#fff',padding:12,fontSize:14,fontFamily:'inherit',resize:'none'}} />

              <label style={{fontSize:11,color:'rgba(255,255,255,0.5)',fontWeight:600}}>{e.retroPhotoLabel}</label>
              <div style={{marginTop:6,marginBottom:16}}>
                <input type="file" accept="image/*" id="retro-photo" style={{display:'none'}} onChange={e=>setRetroPhoto(e.target.files?.[0]||null)} />
                <label htmlFor="retro-photo" style={{display:'inline-block',padding:'10px 16px',borderRadius:12,border:'1px dashed rgba(255,255,255,0.2)',color:retroPhoto?'#4ade80':'rgba(255,255,255,0.6)',fontSize:13,cursor:'pointer'}}>
                  {retroPhoto?'✅ '+retroPhoto.name.substring(0,24):`📷 ${e.retroPhotoAttach}`}
                </label>
              </div>

              <button onClick={requestRetroSignature} disabled={retroBusy || !retroChecklistOk} style={{width:'100%',padding:16,borderRadius:14,border:'none',background:retroBusy||!retroChecklistOk?'rgba(255,255,255,0.1)':'linear-gradient(135deg,#c19c56,#e8c47a)',color:retroBusy||!retroChecklistOk?'rgba(255,255,255,0.3)':'#0a1929',fontSize:15,fontWeight:800,cursor:retroBusy||!retroChecklistOk?'not-allowed':'pointer'}}>
                {retroBusy?e.retroSubmitting:!retroChecklistOk?fill(e.retroChecklistProgress,{done:retroChecklist.filter(c=>c.done).length,required:retroChecklistRequired}):e.retroSubmit}
              </button>
            </>) : (
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:13,color:'rgba(255,255,255,0.6)',marginBottom:8}}>✓ {fill(e.retroEvalChecklist, { done: retroEval.itens_feitos, total: retroEval.itens_total })}</div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.45)',marginBottom:8}}>{e.retroEvalPayNote}</div>
                {retroEval.resumo&&<div style={{fontSize:12,color:'rgba(255,255,255,0.6)',background:'rgba(255,255,255,0.04)',borderRadius:12,padding:12,marginTop:8,textAlign:'left',lineHeight:1.6}}>{retroEval.resumo}</div>}
                {(retroEval.nao_feitos||[]).length>0&&<div style={{fontSize:11,color:'#f87171',marginTop:8,textAlign:'left'}}>{fill(e.retroEvalUnrecognized, { items: retroEval.nao_feitos.join(', ') })}</div>}
                <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:12}}>{e.finalizing}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="emp-app-header">
        <div className="emp-header-top">
          <div className="emp-header-identity">
            <div className="emp-brand"><span className="emp-kp-mark">KP</span><span>KURIPURO BY JBM</span></div>
          </div>
          <div className="emp-header-actions">
            <div className={`emp-score-card ${empScore>=90?'is-good':empScore>=70?'is-mid':'is-low'}`}>
              <div className="emp-score-value">{empScore}</div>
              <div className="emp-score-label">{e.score}</div>
            </div>
            <LanguageToggle variant="dark" compact />
            <button aria-label={e.notifications} aria-expanded={bellOpen} onClick={()=>setBellOpen(true)} className="emp-header-icon-button">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
              {bellCount>0&&<div className="emp-header-notification-count">{bellCount}</div>}
            </button>
            <button aria-label={menuOpen ? e.close : e.more} aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)} className="emp-header-menu-button">
              <span></span><span></span><span></span>
              {spotJobs.length>0&&<i />}
            </button>
          </div>
        </div>
        {/* Same greeting header on every screen except the AI helper, which gets the whole height */}
        {tab!=='ai'&&<div className="ex-greet emp-hello">
          <div>
            {personalGreeting?(
              <>
                <h1 lang="pt">{personalGreeting.title} <span aria-hidden="true">{personalGreeting.emoji}</span></h1>
                <p className="emp-hello-love" lang="pt">{personalGreeting.subtitle}</p>
              </>
            ):(
              <h1>{fill(clock.getHours()<12?e.greetMorning:clock.getHours()<18?e.greetAfternoon:e.greetEvening,{name:user.name.split(' ')[0]})} <span aria-hidden="true">😊</span></h1>
            )}
            <p>{clock.toLocaleDateString(localeOf(lang),{weekday:'long',day:'numeric',month:'long'})}{tab!=='home'&&currentTabLabel?<b> · {currentTabLabel}</b>:null}</p>
          </div>
          <div><span className="ex-clock">{clock.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span></div>
        </div>}
        {!isOnline&&<div className="emp-offline-banner">
          ⚠️ {e.offline}
        </div>}
        <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
          {gpsStatus&&<div className={`emp-status-chip ${gpsStatus.includes('✅')?'is-good':gpsStatus.includes('🚫')?'is-bad':''}`}>{gpsStatus}</div>}
          {activeJob&&<div style={{background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:20,padding:'4px 12px',fontSize:12,color:'#4ade80',fontWeight:700,fontFamily:'monospace'}}>▶ {fmt(elapsed)}</div>}
          {planAlert&&tab!=='availability'&&tab!=='ai'&&<div onClick={()=>setTab('availability')} style={{background:planAlert.level==='urgent'?'#fef2f2':'#fffbeb',border:`1px solid ${planAlert.level==='urgent'?'#fecaca':'#fde68a'}`,borderRadius:20,padding:'4px 10px',fontSize:11,color:planAlert.level==='urgent'?'#b91c1c':'#b45309',cursor:'pointer',fontWeight:700}}>🗓 {e.planChip}</div>}
          {spotJobs.length>0&&<div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.1)',border:'1px solid rgba(193,156,86,0.2)',borderRadius:20,padding:'4px 10px',fontSize:10,color:'#c19c56',cursor:'pointer',fontWeight:600}}>⚡ {spotJobs.length}</div>}
        </div>
      </div>

      {payslipOpen&&statement&&(
        <PayslipPopup statement={statement} employeeId={user.id} employeeName={user.name} lang={lang}
          onClose={()=>setPayslipOpen(false)} onDone={()=>{setPayslipOpen(false);loadStatement()}} />
      )}
      {answerOpen&&(
        <SalaryAnswerPopup complaint={answerOpen} statement={statement} employeeId={user.id} employeeName={user.name} lang={lang}
          onClose={closeAnswer} onDone={()=>{closeAnswer();loadStatement()}} />
      )}

      {/* Bell: answers to day-off requests + shortcuts to messages / spot jobs */}
      {bellOpen&&(
        <div className="emp-bell-overlay" onClick={closeBell}>
          <section className="emp-bell-pop" role="dialog" aria-modal="true" aria-label={e.notifications} onClick={ev=>ev.stopPropagation()}>
            <div className="emp-bell-head"><h2>🔔 {e.notifications}</h2><button aria-label={e.close} className="emp-menu-close" onClick={closeBell}>×</button></div>
            <div className="emp-bell-list">
              {timeOffNotices.map(r=>(
                <div key={r.id} className={`emp-bell-item is-${r.status}`}>
                  <span className="emp-bell-icon" aria-hidden="true">{r.status==='approved'?'✓':'✕'}</span>
                  <div>
                    <strong>{fill(r.status==='approved'?e.timeOffNoticeApproved:e.timeOffNoticeRejected,{date:fmtDay(r.date, lang, { weekday:'short', day:'numeric', month:'short' })})}</strong>
                    {r.admin_note&&<small>{e.timeOffAdminNote}: {r.admin_note}</small>}
                  </div>
                </div>
              ))}
              {payslipPending&&<button type="button" className="emp-bell-item is-link" onClick={()=>{closeBell();setPayslipOpen(true)}}><span className="emp-bell-icon" aria-hidden="true">💴</span><div><strong>{pickLang(lang,`Check your ${monthLabel(statement.period,'en',true)} salary`,`${monthLabel(statement.period,'ja',true)}の給与を確認してください`,`Confira o salário de ${monthLabel(statement.period,'pt',true)}`)}</strong><small>¥{Number(statement.net_total||0).toLocaleString()}</small></div><b>›</b></button>}
              {salaryNotices.map(c=>(
                <button key={c.id} type="button" className={`emp-bell-item is-link is-${c.status==='resolved'?'approved':'rejected'}`} onClick={()=>{closeBell();setAnswerOpen(c)}}>
                  <span className="emp-bell-icon" aria-hidden="true">{c.status==='resolved'?'✓':'✕'}</span>
                  <div><strong>{pickLang(lang,`Answer about your ${monthLabel(c.period,'en',true)} salary`,`${monthLabel(c.period,'ja',true)}の給与についての回答`,`Resposta sobre o salário de ${monthLabel(c.period,'pt',true)}`)}</strong>{c.admin_response&&<small>{c.admin_response}</small>}</div><b>›</b>
                </button>
              ))}
              {agendaNotices.length>0&&<AgendaNoticesItem notices={agendaNotices} lang={lang} onAck={ackAgenda} />}
              {closedOffers.length>0&&(
                <div className="emp-bell-item is-rejected">
                  <span className="emp-bell-icon" aria-hidden="true">⚡</span>
                  <div><strong>{pickLang(lang,'Offer closed','オファー終了','Oferta fechada')}</strong>
                    {closedOffers.map(j=><small key={j.id} style={{display:'block'}}>{(j.title||'').split(' — ')[0]} · {j.scheduled_date?.slice(5)} — {j.employee_id?pickLang(lang,'someone else accepted','他の人が承諾','outra pessoa aceitou'):pickLang(lang,'cancelled by the office','事務所が取消','cancelada pelo escritório')}</small>)}
                  </div>
                  <button type="button" className="emp-bell-ok" onClick={dismissClosed}>OK</button>
                </div>
              )}
              {unreadMsgs>0&&<button type="button" className="emp-bell-item is-link" onClick={()=>bellGo('chat')}><span className="emp-bell-icon" aria-hidden="true">💬</span><div><strong>{e.bellMessages}</strong><small>{fill(e.unreadCount,{n:unreadMsgs})}</small></div><b>›</b></button>}
              {spotJobs.length>0&&<button type="button" className="emp-bell-item is-link" onClick={()=>bellGo('spots')}><span className="emp-bell-icon" aria-hidden="true">⚡</span><div><strong>{e.bellSpots}</strong><small>{spotJobs.length}</small></div><b>›</b></button>}
              {!timeOffNotices.length&&!unreadMsgs&&!spotJobs.length&&!payslipPending&&!salaryNotices.length&&!agendaNotices.length&&!closedOffers.length&&<p className="emp-bell-empty">{e.bellNothingNew}</p>}
            </div>
            <button type="button" className="emp-bell-all" onClick={()=>bellGo('availability')}>🗓 {e.bellSeeAllTimeOff} ›</button>
          </section>
        </div>
      )}

      {/* 3-dot dropdown */}
      {menuOpen&&(
        <div className="emp-menu-overlay" onClick={()=>setMenuOpen(false)}>
          <section className="emp-menu-panel" role="dialog" aria-modal="true" aria-label={e.more} onClick={e=>e.stopPropagation()}>
            <div className="emp-menu-head"><div><span className="emp-menu-kicker">KURIPURO BY JBM</span><h2>{e.more}</h2></div><button aria-label={e.close} className="emp-menu-close" onClick={()=>setMenuOpen(false)}>×</button></div>
            <div className="emp-menu-items">
            {menuItems.map(item=>(
              <button key={item.key} onClick={()=>{setTab(item.key);setMenuOpen(false)}} className={`emp-menu-item${tab===item.key||(item.group&&groupOf(tab)===item.group)?' is-active':''}`}>
                <span className="emp-menu-item-icon">{item.icon}</span>
                <div className="emp-menu-item-copy">
                  <div>{item.label}</div>
                  {(item.preview||item.hint)&&<div>{item.preview||item.hint}</div>}
                </div>
                {item.badge>0&&<span className={`emp-menu-badge${item.key==='chat'?' is-alert':''}`}>{item.badge}</span>}
              </button>
            ))}
            </div>
            <div className="emp-menu-footer"><button onClick={logout} className="emp-menu-logout">
              <span style={{fontSize:18}}>🚪</span> {e.logout}
            </button></div>
          </section>
        </div>
      )}

      {/* CONTENT */}
      <div className={`emp-content${tab==='ai'?' is-ai':''}${tab==='chat'?' is-chat':''}`} style={{flex:1,padding:'16px 14px 20px',overflowY:'auto',position:'relative',zIndex:1}}>

        {groupOf(tab)&&(
          <div className="tab-pills" style={{marginBottom:12,flexWrap:'wrap'}}>
            {MENU_GROUPS[groupOf(tab)].map(([k,label])=>(
              <button key={k} type="button" className={`tab-pill${tab===k?' active':''}`} onClick={()=>setTab(k)}>
                {label}{k==='spots'&&spotJobs.length>0?` (${spotJobs.length})`:''}{k==='availability'&&planAlert?' •':''}
              </button>
            ))}
          </div>
        )}

        {/* HOME */}
        {tab==='home'&&(
          <div className="emp-home ex-home">
            <PendingVideos jobs={allJobs} L={L} />
            <AfterPhotoLater jobs={allJobs.filter(j=>j.scheduled_date>=new Date(Date.parse(today+'T12:00:00Z')-(j.closed_manually_at?14:3)*864e5).toISOString().slice(0,10))} L={L} onChanged={loadAll} />

            {/* Check-in card with the map of the next location */}
            {(()=>{
              // Next = first pending job in the day's order (clock, or the manual order), never the nearest by GPS.
              const mapJob = activeJob || nextPendingJob(todayJobs) || null
              if (!mapJob) return null
              const place = businessName(mapJob)
              const coords = siteCoordsById[mapJob.id]
              const query = mapQuery(mapJob, coords)
              const distNow = herePos && coords ? Math.round(distanceMeters(herePos.lat, herePos.lng, coords.lat, coords.lng)) : null
              const stale = activeJob && isStaleActiveJob(activeJob,today,elapsed)
              return (
                <section className={`ex-checkin${activeJob?' is-active':''}${stale?' is-stale':''}`}>
                  {nearby&&!activeJob&&(
                    <div className="ex-nearby" role="status">
                      <span aria-hidden="true">📍</span>
                      <div><small>{e.nearbyService}</small><strong>{businessName(nearby.job)}</strong></div>
                      <b>{formatDistance(nearby.dist)}</b>
                    </div>
                  )}
                  <div className="ex-map">
                    <iframe title={place} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={`https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=16&output=embed`} />
                    <div className="ex-map-label"><strong>{place}</strong>{(mapJob.area||distNow!=null)&&<span>{[mapJob.area, distNow!=null?`${distNow} m`:null].filter(Boolean).join(' · ')}</span>}</div>
                    <button type="button" className="ex-checkin-btn" onClick={()=>goToTab('shift')}>
                      <span className="ex-checkin-icon" aria-hidden="true">{activeJob?'■':'⌖'}</span>{activeJob?e.checkOut:e.checkIn}
                    </button>
                  </div>
                  <button type="button" className="ex-checkin-info" onClick={()=>goToTab('shift')}>
                    <div>
                      <small>{activeJob?(stale?e.staleShiftTitle:e.activeShiftTitle):e.nextLocation}</small>
                      <strong>{place}</strong>
                      <span>{activeJob?(activeJob.scheduled_date!==today?`${activeJob.scheduled_date} · `:'')+e.tapToFinish:`${mapJob.scheduled_time||'—'} · ${fill(e.doneRemaining,{done:todayJobs.filter(j=>j.status==='completed').length,remaining:todayPendingJobs.length})}`}</span>
                    </div>
                    {activeJob?<b className="ex-timer">{stale?formatShiftElapsed(elapsed,lang):fmt(elapsed)}</b>:(()=>{
                      const nd=new Date(mapJob.scheduled_date+'T'+(mapJob.scheduled_time||'00:30')+':00')
                      const diffMs=nd-new Date()
                      if(diffMs<0) return <b className="ex-go">›</b>
                      const diffH=Math.floor(diffMs/3600000), diffM=Math.floor((diffMs%3600000)/60000)
                      return <b className="ex-countdown">{diffH>0?diffH+'h ':''}{diffM}m<small>{e.toStart}</small></b>
                    })()}
                  </button>
                </section>
              )
            })()}

            {/* No shift today */}
            {todayJobs.length===0&&!activeJob&&(
              <div className="emp-no-shift-card">
                <div className="emp-empty-icon">☀</div>
                <div className="emp-empty-kicker">{e.todayShift}</div>
                <div className="emp-empty-title">{e.noShiftToday}</div>
                {nextShiftJob&&(()=>{
                  const diffMs=new Date(nextShiftJob.scheduled_date+'T'+(nextShiftJob.scheduled_time||'00:30')+':00')-new Date()
                  return <div className="emp-empty-description">{diffMs>0&&diffMs<48*3600000?fill(e.timeAway,{time:Math.floor(diffMs/3600000)>0?`${Math.floor(diffMs/3600000)}h ${Math.floor((diffMs%3600000)/60000)}m`:`${Math.floor((diffMs%3600000)/60000)}m`}):fill(e.nextWhen,{date:nextShiftJob.scheduled_date,time:nextShiftJob.scheduled_time})}</div>
                })()}
                {nextShiftJob&&<div className="emp-next-job" role="button" tabIndex={0} onClick={()=>setSelectedJob(nextShiftJob)} onKeyDown={ev=>{if(ev.key==='Enter')setSelectedJob(nextShiftJob)}} style={{cursor:'pointer'}}><span>{nextShiftJob.title.split(' —')[0]}</span><span>{nextShiftJob.scheduled_date} · {nextShiftJob.scheduled_time}</span></div>}
              </div>
            )}

            {/* Today is finished: the next shift (e.g. tomorrow's job from the admin) */}
            {todayAllDone&&!activeJob&&laterJobs[0]&&(
              <div className="emp-no-shift-card">
                <div className="emp-empty-icon">☾</div>
                <div className="emp-empty-kicker">{e.nextShiftLabel}</div>
                <div className="emp-empty-title">{whenLabel(laterJobs[0].scheduled_date)} · {laterJobs[0].scheduled_time||'—'}</div>
                {laterJobs.filter(j=>j.scheduled_date===laterJobs[0].scheduled_date).map(j=>(
                  <div key={j.id} className="emp-next-job" role="button" tabIndex={0} onClick={()=>setSelectedJob(j)} onKeyDown={ev=>{if(ev.key==='Enter')setSelectedJob(j)}} style={{cursor:'pointer'}}><span>{j.title.split(' —')[0]}</span><span>{j.scheduled_time||'—'}</span></div>
                ))}
              </div>
            )}

            <PlanAlert alert={planAlert} e={e} lang={lang} onOpen={()=>openAvailability()} />

            {/* Summary cards (swipe sideways) */}
            <div className="ex-cards" role="list">
              {todayJobs.length>0&&(
                <button type="button" role="listitem" className="ex-card" onClick={()=>goToTab('shift')}>
                  <div className="ex-card-head"><strong>{todayAllDone?e.todayShiftDone:e.todayShift}</strong><span className="ex-card-icon">▶</span></div>
                  <div className="ex-card-big">{todayJobs.length} <small>{e.locations}</small></div>
                  <div className="ex-card-sub">{fill(e.doneRemaining,{done:todayJobs.filter(j=>j.status==='completed').length,remaining:todayPendingJobs.length})} · ⏱ {fill(e.estHours,{hours:Math.round(todayJobs.length*0.75)})}</div>
                  <div className="ex-progress"><i className="is-green" style={{width:(todayJobs.filter(j=>j.status==='completed').length/todayJobs.length*100)+'%'}} /><i style={{width:(todayJobs.filter(j=>j.status==='in_progress').length/todayJobs.length*100)+'%'}} /></div>
                  <span className="ex-pill">{todayAllDone?e.tapToReview:e.startArrow}</span>
                </button>
              )}
              {tomorrowJobs.length>0&&(
                <button type="button" role="listitem" className="ex-card" onClick={()=>goToTab('shift')}>
                  <div className="ex-card-head"><strong>{e.tomorrowShift}</strong><span className="ex-card-icon">☾</span></div>
                  <div className="ex-card-big">{tomorrowJobs.length} <small>{e.locations}</small></div>
                  <div className="ex-card-sub">{fill(e.tomorrowStarts,{time:tomorrowJobs[0].scheduled_time||'—'})} · {tomorrowJobs.map(j=>businessName(j)).slice(0,2).join(', ')}{tomorrowJobs.length>2?'…':''}</div>
                  <span className="ex-pill">{e.tomorrowSee}</span>
                </button>
              )}
              <button type="button" role="listitem" className="ex-card" onClick={()=>goToTab('salary')}>
                <div className="ex-card-head"><strong>{e.workedHours}</strong><span className="ex-card-icon">⏱</span></div>
                <div className="ex-card-big">{salaryData?.hours||0}h <small>{e.thisMonth}</small></div>
                <div className="ex-card-sub">{salaryData?.jobs||0} {e.statJobs.toLowerCase()} · ¥{(salaryData?.total||0).toLocaleString()}</div>
                {salaryData&&salaryData.fixedMax>0?(
                  <div className="ex-progress"><i className="is-green" style={{width:Math.min((salaryData.base/salaryData.fixedMax)*100,100)+'%'}} /></div>
                ):<div className="ex-progress"><i style={{width:Math.min(((salaryData?.workedDays||0)/26)*100,100)+'%'}} /></div>}
                <span className="ex-pill">{e.viewSalary}</span>
              </button>
              {payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance').length>0&&(()=>{
                const next=payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance')[0]
                return (
                  <button type="button" role="listitem" className="ex-card" onClick={()=>goToTab('salary')}>
                    <div className="ex-card-head"><strong>{e.nextPayment}</strong><span className="ex-card-icon">¥</span></div>
                    <div className="ex-card-big">¥{Number(next.amount).toLocaleString()}</div>
                    <div className="ex-card-sub">{next.payment_date}</div>
                    <span className="ex-pill">{e.viewSalary}</span>
                  </button>
                )
              })()}
            </div>
            {salaryData&&salaryData.jobs>0&&salaryData.total===0&&empData&&!(empData.salary_type==='fixed'&&Number(empData.fixed_salary||0)===0)&&(
              <div className="ex-warning">⚠️ {fill(e.salaryConfigHint,{type:salaryTypeLabel(empData.salary_type,lang)})}</div>
            )}

            {/* Pending requests + notifications */}
            {(()=>{
              const pendingClaims=claims.filter(c=>c.status==='pending').length
              const pendingEquipment=equipmentRequests.filter(r=>['pending','requested'].includes(r.status)).length
              const notifications=bellCount
              return (
                <div className="ex-duo">
                  <button type="button" className="ex-tile" onClick={()=>goToTab(pendingClaims||!pendingEquipment?'transport':'equipment')}>
                    <span>{e.pendingRequests}</span>
                    <strong>{pendingClaims+pendingEquipment}</strong>
                    <small>{fill(e.pendingBreakdown,{transport:pendingClaims,equipment:pendingEquipment})}</small>
                  </button>
                  <button type="button" className="ex-tile is-blue" onClick={()=>setBellOpen(true)}>
                    <span>{e.notifications}</span>
                    <b aria-hidden="true">🔔</b>
                    <small>{fill(e.unreadCount,{n:notifications})}</small>
                  </button>
                </div>
              )
            })()}

            {/* v1.0.96 · one destination, one name, one place: navigation is the bottom bar + menu, actions are the ＋ button. */}

            {/* Overview */}
            <div className="ex-section-title">{e.overview}</div>
            <div className="ex-overview">
              <div className="ex-ov tone-blue"><strong>{salaryData?.jobs||0}</strong><span>{e.statJobs}</span></div>
              <div className="ex-ov tone-purple"><strong>{salaryData?.hours||0}h</strong><span>{e.statHours}</span></div>
              <div className="ex-ov tone-peach"><strong>¥{(salaryData?.total||0).toLocaleString()}</strong><span>{e.statEarned}</span></div>
              <div className="ex-ov tone-gray"><strong style={{color:scoreColor(empScore)}}>{empScore}</strong><span>{e.performance} · {empScore>=90?e.scoreExcellent:empScore>=70?e.scoreGood:e.scoreNeedsWork}</span></div>
            </div>

            {/* My progress: evolution and averages from start/finish times and GPS */}
            {(()=>{
              const monthKey = today.slice(0,7)
              const prevKey = new Date(Date.UTC(Number(monthKey.slice(0,4)), Number(monthKey.slice(5,7))-2, 1)).toISOString().slice(0,7)
              const month = summarizeJobs(allJobs.filter(j=>j.scheduled_date?.startsWith(monthKey)))
              const prev = summarizeJobs(allJobs.filter(j=>j.scheduled_date?.startsWith(prevKey)))
              const weeks = weeklyEvolution(allJobs, today, 8)
              const maxJobs = Math.max(1, ...weeks.map(w=>w.completed))
              const avgDelta = month.avgMin!=null&&prev.avgMin!=null ? month.avgMin-prev.avgMin : null
              const kpis = [
                ['⏱', e.avgService, formatMinutes(month.avgMin), avgDelta!=null&&avgDelta!==0?`${avgDelta>0?'+':'−'}${formatMinutes(Math.abs(avgDelta))} ${e.vsLastMonth}`:null],
                ['🕘', e.onTime, month.onTimePct!=null?`${month.onTimePct}%`:'—', month.avgDelayMin!=null?fill(e.avgDelay,{m:month.avgDelayMin}):null],
                ['📍', e.gpsCheckins, month.gpsPct!=null?`${month.gpsPct}%`:'—', month.gpsAway?fill(e.gpsAwayCount,{n:month.gpsAway}):null],
                ['✓', e.checklistRate, month.checklistPct!=null?`${month.checklistPct}%`:'—', null],
              ]
              return (
                <section className="ex-evo">
                  <div className="ex-evo-head"><strong>{e.myProgress}</strong><small>{e.last8Weeks}</small></div>
                  <div className="ex-evo-kpis">
                    {kpis.map(([icon,label,value,sub])=>(
                      <div key={label} className="ex-evo-kpi"><span>{icon} {label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>
                    ))}
                  </div>
                  <div className="ex-evo-chart" role="img" aria-label={e.jobsPerWeek}>
                    {weeks.map((w,i)=>(
                      <div key={w.week} className={`ex-evo-col${i===weeks.length-1?' is-now':''}`} title={`${w.week}: ${w.completed} · ${formatMinutes(w.avgMin)}`}>
                        <small className="ex-evo-val">{w.completed||''}</small>
                        <i style={{height:`${Math.max(4,(w.completed/maxJobs)*100)}%`}} />
                        <span>{Number(w.week.slice(8))}/{Number(w.week.slice(5,7))}</span>
                        <em>{w.avgMin!=null?`${w.avgMin}m`:'—'}</em>
                      </div>
                    ))}
                  </div>
                  <div className="ex-evo-legend"><span><i className="is-bar" />{e.jobsPerWeek}</span><span>{e.avgMinutesRow}</span></div>
                </section>
              )
            })()}

            {/* Badges */}
            {badges.length>0&&<div className="ex-badges">
              <span>{e.badges}</span>
              <div>{badges.map(b=>{ const def=BADGE_DEFS.find(d=>d.key===b.badge_key); return <span key={b.id} title={e[`badge_${def?.key}`]||def?.name}>{def?.icon||'🏅'}</span> })}</div>
            </div>}

            {/* Spot jobs */}
            {spotJobs.length>0&&<button type="button" className="ex-spot" onClick={()=>setTab('spots')}>
              <div><strong>⚡ {fill(spotJobs.length>1?e.spotCountPlural:e.spotCount,{n:spotJobs.length})}</strong><small>{e.tapToRespond}</small></div>
              <span>›</span>
            </button>}

            <button type="button" className="ex-primary" onClick={()=>goToTab('calendar')}>{e.viewSchedule}</button>
          </div>
        )}

        {/* SHIFT */}
        {tab==='shift'&&(
          <section className="emp-shift-screen">
            <div className="emp-section-heading"><span>{e.workspace}</span><h1>{L('My day','今日の予定','Meu dia')}</h1><p>{clock.toLocaleDateString(localeOf(lang),{weekday:'long',day:'numeric',month:'long'})}</p></div>
          <ShiftView allJobs={allJobs} tomorrowJobs={tomorrowJobs} activeJob={activeJob} elapsed={elapsed} checklist={checklist} setChecklist={setChecklist} notes={notes} setNotes={setNotes} jobPhotos={jobPhotos} PhotoGrid={PhotoGrid} handleStart={handleStart} handleComplete={handleComplete} handleCompleteWithSig={handleCompleteWithSig} handleAbandonStale={handleAbandonStaleShift} submitting={submitting} overdueBusy={overdueBusy} fmt={fmt} today={today} S={S} addPhoto={addPhoto} openRetro={openRetro} setSelectedJob={setSelectedJob} serviceContracts={serviceContracts} onOpenTraining={setTrainingModal} hasFacility={hasFacility} onOpenFacility={setFacilityJob} facilityLabel={tr.facility.openModel} onOpenAddService={openAddService} onOpenPastService={openPastService} onRegisterLate={handleRegisterLate} onMoveJob={handleMoveJob} reorderBusy={reorderBusy} onAcceptSpot={handleAcceptSpot} onDeclineSpot={handleDeclineSpot} jobVideo={jobVideo} onPickVideo={pickJobVideo} onRemoveVideo={clearJobVideo} videoLabels={vt} voiceOn={voiceOn} onToggleVoice={canSpeak() ? toggleVoice : null} labels={e} lang={lang} focusJobId={focusJobId} onAskAI={setAiJob} photoStatus={photoStatus} onRetryPhotos={retryPhotos} onReportProblem={setProblemJob} />
          <TeamDay userId={user.id} L={L} />
          </section>
        )}

        {/* Quick round lives on its own screen so it does not compete with the job-by-job flow. */}
        {tab==='quickround'&&quickRoundOn&&(
          <section className="emp-shift-screen">
            <div className="emp-section-heading"><span>{L('Time only','時刻のみ','Só horário')}</span><h1>{L('Quick round','クイックラウンド','Rodada rápida')}</h1><p>{L('For days you cannot do job by job: tick each place when done. No checklist, photo or GPS.','一件ずつ作業できない日に：終わった場所を順にチェック。チェックリスト・写真・GPSなし。','Para dias em que não dá para fazer job a job: marque cada local quando terminar. Sem checklist, foto ou GPS.')}</p></div>
            <QuickRound user={user} allJobs={allJobs} onChanged={loadAll} />
          </section>
        )}

        {tab==='profile'&&<MyProfile user={user} L={L} />}

        {tab==='ai'&&(
          <section className="emp-ai-screen">
            <div className="emp-ai-chat"><AIChatPanel compact mode="employee" employeeId={user.id} employeeName={user.name} /></div>
          </section>
        )}

        {/* SPOTS */}
        {tab==='spots'&&(
          <div>
            {spotJobs.length===0?<div style={{textAlign:'center',paddingTop:60}}><div style={{fontSize:48}}>⚡</div><div style={{fontSize:15,color:'rgba(255,255,255,0.3)',marginTop:12}}>{e.noSpotJobs}</div></div>
            :spotJobs.map(j=>(
              <div key={j.id} style={{background:'rgba(193,156,86,0.06)',border:'1px solid rgba(193,156,86,0.15)',borderRadius:22,padding:18,marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div style={{flex:1,marginRight:12}}><div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:4}}>{j.title}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:1}}>📅 {displayDate(j)} · {j.scheduled_time}</div>{hasMapsLink(j.address, j.title)&&<a href={mapsOpenUrl(j.address, j.title)} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',textDecoration:'none'}}>🗺 {e.openMaps}</a>}</div>
                  <div style={{background:'rgba(193,156,86,0.15)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:14,padding:'10px 14px',textAlign:'center',flexShrink:0}}><div style={{fontSize:9,color:'#c19c56',fontWeight:700,letterSpacing:1}}>{e.extra.toUpperCase()}</div><div style={{fontSize:22,fontWeight:800,color:'#c19c56'}}>+¥{Number(j.spot_value||0).toLocaleString()}</div></div>
                </div>
                {j._open&&<div style={{fontSize:12,fontWeight:700,color:'#c19c56',marginBottom:10}}>⚡ {L('Offer to the team — the first to accept keeps it','チームへのオファー — 最初に承諾した人が担当','Oferta para a equipe — o primeiro que aceitar fica com o job')}</div>}
                {j.description&&(()=>{ const d=splitKeyLine(j.description); return <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.03)',borderRadius:10,padding:'10px 12px',marginBottom:14,lineHeight:1.6,whiteSpace:'pre-line'}}>{d.key&&<div>🔑 ••••</div>}{d.rest}</div> })()}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <button onClick={()=>handleAcceptSpot(j)} style={{padding:'15px',borderRadius:14,border:'none',background:'linear-gradient(135deg,#0F6E56,#16a37e)',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer'}}>✅ {e.accept}</button>
                  <button onClick={()=>handleDeclineSpot(j)} style={{padding:'15px',borderRadius:14,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.45)',fontSize:15,fontWeight:700,cursor:'pointer'}}>✕ {j._open?L('Not for me','今回はパス','Não posso'):e.decline}</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* HISTORY */}
        {tab==='history'&&(
          <DayGroupView allJobs={allJobs} displayDate={displayDate} today={today} setSelectedJob={setSelectedJob} handleStart={handleStart} handleComplete={handleComplete} handleCompleteWithSig={handleCompleteWithSig} activeJob={activeJob} elapsed={elapsed} checklist={checklist} setChecklist={setChecklist} notes={notes} setNotes={setNotes} PhotoGrid={PhotoGrid} submitting={submitting} fmt={fmt} S={S} labels={{ ...e, statusCompleted: tr.status.completed, statusAssigned: tr.status.assigned, statusProgress: tr.status.in_progress, statusCancelled: tr.status.cancelled }} />
        )}

        {/* SALARY */}
        {tab==='salary'&&(
          <div>
            {/* v1.0.96 · three parts: payslip (confirm / dispute), earnings by period, and one hub for salary questions */}
            <div className="tab-pills" style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
              {[['payslip',L('Payslip','給与明細','Holerite'),payslipPending?1:0],['earnings',L('Earnings','収入','Ganhos'),0],['questions',L('My salary questions','給与の質問','Minhas questões de salário'),salaryNotices.length]].map(([k,label,badge])=>(
                <button key={k} type="button" onClick={()=>setSalaryView(k)} style={{padding:'7px 12px',borderRadius:999,border:'1px solid rgba(255,255,255,0.15)',background:salaryView===k?'#c19c56':'rgba(255,255,255,0.05)',color:salaryView===k?'#0a1929':'rgba(255,255,255,0.75)',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                  {label}{badge>0?` · ${badge}`:''}
                </button>
              ))}
            </div>

            {salaryView==='payslip'&&(<>
              {statement ? (
                <div className="earn-card">
                  <h4>📋 {fill(L('Payslip {period}','{period} 給与明細','Holerite {period}'),{period:fmtPeriod(statement.period)})}</h4>
                  <div className="earn-card-row"><div><b>¥{Number(statement.net_total||0).toLocaleString()}</b><small>{fill(e.confirmBy, { deadline: getPeriodDates(statement.period).confirmDeadline, payDate: getPeriodDates(statement.period).payDate })}</small></div>
                    {(() => { const st = employeeSlipState(statement, slipLine); const t = employeeSlipText(st, L, String(slipLine?.payment_date || '').slice(0, 10)); return <span className={`earn-pill${t.tone === 'ok' ? ' is-ok' : ''}`}>{t.tone === 'ok' ? '✓ ' : t.tone === 'bad' ? '⚠ ' : ''}{t.text}</span> })()}
                  </div>
                  {statement.employee_confirmed_at&&<div className="earn-status is-ok">✓ {fill(e.salaryConfirmed, { period: fmtPeriod(statement.period), payDate: getPeriodDates(statement.period).payDate })}</div>}
                  {statement.employee_disputed_at&&<div className="earn-status is-bad">⚠ {fill(e.salaryDisputed, { period: fmtPeriod(statement.period) })}</div>}
                  {payslipPending&&<button type="button" className="earn-secondary" style={{marginTop:10,background:'#22c55e',color:'#0a1929',fontWeight:800}} onClick={()=>setPayslipOpen(true)}>✓ {L('Confirm','確認する','Confirmar')}</button>}
                  {!payslipPending&&<button type="button" className="earn-secondary" style={{marginTop:10}} onClick={()=>setPayslipOpen(true)}>{L('Open payslip','明細を開く','Abrir holerite')} ›</button>}
                </div>
              ) : <div className="earn-card"><small>{L('No payslip to confirm yet.','確認する給与明細はまだありません。','Ainda não há holerite para confirmar.')}</small></div>}
            </>)}

            {salaryView==='questions'&&(
              <div className="earn-card">
                <h4>💬 {L('My salary questions','給与の質問','Minhas questões de salário')}</h4>
                {!myQuestions.length&&<small>{L('No questions sent.','送信した質問はありません。','Nenhuma questão enviada.')}</small>}
                {myQuestions.map(c=>{
                  const st = c.status==='resolved'?['✓',L('Answered','回答済み','Respondida'),'is-ok']:c.status==='rejected'?['✕',L('Not accepted','不承認','Não aceita'),'is-bad']:['⏳',L('Waiting for the office','事務所の確認待ち','Aguardando o escritório'),'']
                  const isNew = salaryNotices.some(n=>n.id===c.id)
                  return (
                    <button key={c.id} type="button" className={`earn-status is-link ${st[2]}`} style={{display:'block',width:'100%',textAlign:'left'}} onClick={()=>c.status==='resolved'||c.status==='rejected'?setAnswerOpen(c):null}>
                      <b>{st[0]} {monthLabel(c.period,lang==='ja'?'ja':lang==='pt'?'pt':'en',true)} · {st[1]}{isNew?` · ${L('new','新着','novo')}`:''}</b>
                      <small style={{display:'block',opacity:0.75,marginTop:2}}>{String(c.created_at||'').slice(0,10)} · {String(c.description||c.category||'').slice(0,80)}</small>
                      {c.admin_response&&<small style={{display:'block',marginTop:2}}>↳ {String(c.admin_response).slice(0,120)}</small>}
                    </button>
                  )
                })}
              </div>
            )}

            {salaryView==='earnings'&&<>
            <EarningsPanel employeeId={user.id} lang={lang} theme="portal" />
            {payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance').length>0&&(
              <div className="earn-card">
                <h4>💴 {L('Upcoming payments', '支払予定', 'Próximos pagamentos')}</h4>
                {payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance').map(p=>(
                  <div key={p.id} className="earn-card-row">
                    <div><b>¥{Number(p.amount).toLocaleString()}</b><small>{p.payment_date} · {p.description||e.salary}</small></div>
                    <span className="earn-pill">{payStatusLabel(p.status)}</span>
                  </div>
                ))}
              </div>
            )}
            {(() => {
              const todayStr = tokyoToday()
              const parseAdvDate = (a) => (a.payment_date || a.received_at || a.created_at || '').slice(0, 10) || null
              const isReceived = (a) => a.status === 'paid' || (parseAdvDate(a) && parseAdvDate(a) < todayStr)
              const received = advances.filter(isReceived)
              const pending = advances.filter(a => !isReceived(a))
              return (<>
                {received.length>0&&<div className="earn-card">
                  <h4>{e.advancesReceived}</h4>
                  {received.map(a=><div key={a.id} className="earn-card-row"><div><b>¥{Number(a.amount).toLocaleString()}</b><small>{a.description}</small></div><span className="earn-pill is-ok">✓ {e.received}</span></div>)}
                  <div className="earn-card-total"><span>{e.totalReceived}</span><b>-¥{received.reduce((s,a)=>s+Number(a.amount),0).toLocaleString()}</b></div>
                </div>}
                {pending.length>0&&<div className="earn-card">
                  <h4>{e.advancesPending}</h4>
                  {pending.map(a=><div key={a.id} className="earn-card-row"><div><b>¥{Number(a.amount).toLocaleString()}</b><small>{a.description}</small></div><span className="earn-pill">{e.pendingAdv}</span></div>)}
                </div>}
              </>)
            })()}
            </>}
            {salaryView==='earnings'&&<button type="button" className="earn-secondary" onClick={async()=>{
              const today2 = tokyoToday()
              const todayJobsForPDF = allJobs.filter(j=>j.scheduled_date===today2||displayDate(j)===today2)
              if (!todayJobsForPDF.length) return toast.error(e.noJobsToday)
              const { generateDailyReport } = await import('../lib/generatePDF')
              const doc = await generateDailyReport(today2, todayJobsForPDF, user.name)
              doc.save(`report_${today2}.pdf`)
              toast.success(L('Report downloaded!', '報告書をダウンロードしました', 'Relatório baixado!'))
            }}>
              📋 {L("Today's service report (PDF)", '今日の作業報告書 (PDF)', 'Relatório de serviço de hoje (PDF)')}
            </button>}
          </div>
        )}

        {/* EQUIPMENT */}
        {tab==='equipment'&&(
          <div>
            <span style={S.label}>{e.equipmentSubmitTitle}</span>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 12, lineHeight: 1.5 }}>{e.equipmentSubmitHint}</div>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, padding: 18, marginBottom: 16 }}>
              <div style={{ marginBottom: 10 }}>
                <span style={S.label}>{e.equipmentCategory}</span>
                <select value={equipmentForm.category} onChange={ev => setEquipmentForm(f => ({ ...f, category: ev.target.value }))} style={{ ...S.input, appearance: 'none' }}>
                  <option value="supplies">{e.equipmentCatSupplies}</option>
                  <option value="tools">{e.equipmentCatTools}</option>
                  <option value="uniform">{e.equipmentCatUniform}</option>
                  <option value="safety">{e.equipmentCatSafety}</option>
                  <option value="other">{e.equipmentCatOther}</option>
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <span style={S.label}>{e.equipmentItem} *</span>
                <input value={equipmentForm.item_name} onChange={ev => setEquipmentForm(f => ({ ...f, item_name: ev.target.value }))} placeholder={e.equipmentItemPlaceholder} style={S.input} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <span style={S.label}>{e.equipmentQuantity}</span>
                <input type="number" min="1" value={equipmentForm.quantity} onChange={ev => setEquipmentForm(f => ({ ...f, quantity: ev.target.value }))} style={S.input} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <span style={S.label}>{e.equipmentLink}</span>
                <input type="url" inputMode="url" value={equipmentForm.product_url} onChange={ev => setEquipmentForm(f => ({ ...f, product_url: ev.target.value }))} placeholder={e.equipmentLinkPlaceholder} style={S.input} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={S.label}>{e.equipmentReason} *</span>
                <textarea value={equipmentForm.reason} onChange={ev => setEquipmentForm(f => ({ ...f, reason: ev.target.value }))} placeholder={e.equipmentReasonPlaceholder} rows={4} style={{ ...S.input, resize: 'none' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <span style={S.label}>{e.equipmentPhoto}</span>
                <div onClick={() => equipmentPhotoRef.current?.click()} style={{ aspectRatio: '2.2/1', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', border: equipmentPhotoPreview ? '2px solid #4ade80' : '2px dashed rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, color: 'rgba(255,255,255,0.3)' }}>
                  {equipmentPhotoPreview ? <img src={equipmentPhotoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <><span style={{ fontSize: 26 }}>📷</span><span style={{ fontSize: 10 }}>{e.equipmentPhotoAttach}</span></>}
                </div>
                <input ref={equipmentPhotoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={ev => {
                  const file = ev.target.files?.[0]
                  if (equipmentPhotoPreview) URL.revokeObjectURL(equipmentPhotoPreview)
                  setEquipmentPhoto(file || null)
                  setEquipmentPhotoPreview(file ? URL.createObjectURL(file) : null)
                }} />
              </div>
              <button onClick={handleSubmitEquipment} disabled={submittingEquipment} style={{ width: '100%', padding: '15px', borderRadius: 14, border: 'none', background: submittingEquipment ? 'rgba(255,255,255,0.07)' : 'linear-gradient(135deg,#c19c56,#e8c47a)', color: submittingEquipment ? 'rgba(255,255,255,0.25)' : '#0a1929', fontSize: 15, fontWeight: 700, cursor: submittingEquipment ? 'not-allowed' : 'pointer' }}>
                {submittingEquipment ? e.equipmentSubmitting : `📤 ${e.equipmentSubmit}`}
              </button>
            </div>
            <span style={S.label}>{e.equipmentMyRequests}</span>
            {equipmentRequests.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13, padding: '20px 0' }}>{e.equipmentNoRequests}</div>}
            {equipmentRequests.map(r => (
              <div key={r.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{r.item_name}{r.quantity > 1 ? ` × ${r.quantity}` : ''}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{(r.created_at || '').slice(0, 10)}</div>
                  </div>
                  <span style={{ fontSize: 9, borderRadius: 20, padding: '3px 9px', fontWeight: 600, textTransform: 'uppercase', background: r.status === 'approved' || r.status === 'fulfilled' ? 'rgba(74,222,128,0.12)' : r.status === 'rejected' ? 'rgba(248,113,113,0.12)' : 'rgba(251,191,36,0.12)', color: r.status === 'approved' || r.status === 'fulfilled' ? '#4ade80' : r.status === 'rejected' ? '#f87171' : '#fbbf24', border: `1px solid rgba(${r.status === 'approved' || r.status === 'fulfilled' ? '74,222,128' : r.status === 'rejected' ? '248,113,113' : '251,191,36'},0.2)` }}>
                    {equipmentStatusLabel(r.status)}
                  </span>
                </div>
                {(() => { const match = r.reason.match(/\n\n\[Product link\] (https?:\/\/\S+)/); const reason = match ? r.reason.slice(0, match.index) : r.reason; return <><div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, marginTop: 6 }}>{reason}</div>{match&&<a href={match[1]} target="_blank" rel="noreferrer" className="emp-request-product-link">↗ {match[1]}</a>}</> })()}
                {r.admin_note && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '6px 8px', marginTop: 8 }}>{e.equipmentAdminNote}: {r.admin_note}</div>}
              </div>
            ))}
          </div>
        )}

        {/* TRANSPORT */}
        {tab==='transport'&&(
          <div>
            <span style={S.label}>{L('Submit Transport Claim', '交通費を申請', 'Pedir reembolso de transporte')}</span>
            <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:20,padding:18,marginBottom:16}}>
              <div style={{marginBottom:10}}><span style={S.label}>{L('Related Job', '関連する作業', 'Serviço relacionado')}</span><select value={claimForm.job_id} onChange={e=>setClaimForm(f=>({...f,job_id:e.target.value}))} style={{...S.input,appearance:'none'}}><option value="">{L('No specific job', '特定の作業なし', 'Nenhum serviço específico')}</option>{allJobs.slice(0,30).map(j=><option key={j.id} value={j.id}>{j.title.split(' —')[0]} · {j.scheduled_date}</option>)}</select></div>
              <div style={{marginBottom:10}}><span style={S.label}>{L('Amount (¥) *', '金額 (¥) *', 'Valor (¥) *')}</span><input type="number" value={claimForm.amount} onChange={e=>setClaimForm(f=>({...f,amount:e.target.value}))} placeholder="280" style={S.input} /></div>
              <div style={{marginBottom:10}}><span style={S.label}>{L('Route', '経路', 'Trajeto')}</span><input value={claimForm.route} onChange={e=>setClaimForm(f=>({...f,route:e.target.value}))} placeholder="Shibuya → Shinjuku" style={S.input} /></div>
              <div style={{marginBottom:14}}><span style={S.label}>{L('Notes', 'メモ', 'Observações')}</span><input value={claimForm.description} onChange={e=>setClaimForm(f=>({...f,description:e.target.value}))} style={S.input} /></div>
              <div style={{marginBottom:14}}>
                <span style={S.label}>{L('Photos & Receipt', '写真・領収書', 'Fotos e recibo')}</span>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  {[{ref:claimPhotoRef,preview:claimPhotoPreview,label:L('Photo','写真','Foto'),emoji:'📷'},{ref:claimReceiptRef,preview:claimReceiptPreview,label:L('Receipt','領収書','Recibo'),emoji:'🧾'}].map(({ref,preview,label,emoji})=>(
                    <div key={label} className={`emp-claim-upload${preview?' has-preview':''}`} onClick={()=>ref.current.click()} style={{aspectRatio:'1',borderRadius:12,overflow:'hidden',cursor:'pointer',border:preview?'2px solid #4ade80':'2px dashed rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.02)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,color:'rgba(255,255,255,0.3)'}}>
                      {preview?<img src={preview} style={{width:'100%',height:'100%',objectFit:'cover'}} />:<><span style={{fontSize:26}}>{emoji}</span><span style={{fontSize:10}}>{label}</span></>}
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={handleSubmitClaim} disabled={submittingClaim} style={{width:'100%',padding:'15px',borderRadius:14,border:'none',background:submittingClaim?'rgba(255,255,255,0.07)':'linear-gradient(135deg,#0F6E56,#16a37e)',color:submittingClaim?'rgba(255,255,255,0.25)':'#fff',fontSize:15,fontWeight:700,cursor:submittingClaim?'not-allowed':'pointer'}}>
                {submittingClaim?L('Submitting...','送信中...','Enviando...'):`📤 ${L('Submit Claim','申請する','Enviar pedido')}`}
              </button>
            </div>
            <span style={S.label}>{L('My Claims', '自分の申請', 'Meus pedidos')}</span>
            {claims.length===0&&<div style={{textAlign:'center',color:'rgba(255,255,255,0.25)',fontSize:13,padding:'20px 0'}}>{L('No claims yet', '申請はまだありません', 'Nenhum pedido ainda')}</div>}
            {claims.map(c=>(
              <div key={c.id} style={S.card}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5}}>
                  <div><div style={{fontSize:13,fontWeight:600,color:'#fff'}}>¥{Number(c.amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:1}}>{c.claim_date}{c.route&&` · ${c.route}`}</div></div>
                  <span style={{fontSize:9,borderRadius:20,padding:'3px 9px',fontWeight:600,textTransform:'uppercase',background:c.status==='approved'?'rgba(74,222,128,0.12)':c.status==='rejected'?'rgba(248,113,113,0.12)':'rgba(251,191,36,0.12)',color:c.status==='approved'?'#4ade80':c.status==='rejected'?'#f87171':'#fbbf24',border:`1px solid rgba(${c.status==='approved'?'74,222,128':c.status==='rejected'?'248,113,113':'251,191,36'},0.2)`}}>{equipmentStatusLabel(c.status)}</span>
                </div>
                {c.admin_note&&<div style={{fontSize:10,color:'rgba(255,255,255,0.35)',background:'rgba(255,255,255,0.03)',borderRadius:8,padding:'6px 8px',marginTop:4}}>{e.equipmentAdminNote}: {c.admin_note}</div>}
              </div>
            ))}
          </div>
        )}

        {/* CHAT */}
        {tab==='chat'&&(
          <EmployeeChat
            messages={chatOnOffice ? officeThread(messages) : threadWith(teamMessages, user.id, chatKey)}
            teamReady={teamReady}
            sections={chatSections}
            activeKey={teamReady ? chatKey : OFFICE_KEY}
            onOpen={openChat}
            onBack={()=>setChatKey(null)}
            labels={e}
            lang={lang}
            value={newMsg}
            onChange={setNewMsg}
            onSend={sendMessage}
            onPhoto={sendChatPhoto}
            sendingPhoto={sendingChatPhoto}
            onPhotoClick={setChatLightbox}
            containerRef={chatContainerRef}
            endRef={msgEndRef}
            onScroll={handleChatScroll}
            unreadBelow={userScrolled ? (chatOnOffice ? officeUnread : teamMessages.filter(m=>m.from_employee_id===chatKey&&m.to_employee_id===user.id&&!m.read).length) : 0}
            onJumpDown={()=>{setUserScrolled(false);msgEndRef.current?.scrollIntoView({behavior:'smooth'})}}
          />
        )}
        {chatLightbox&&<PhotoLightbox url={chatLightbox} onClose={()=>setChatLightbox(null)} closeLabel={e.close} />}

        {/* CALENDAR */}
        {/* v1.0.96 · one calendar: jobs (read) and availability / day off (the only place to edit them) */}
        {(tab==='calendar'||tab==='availability')&&(<>
          <CalendarView jobs={allJobs} today={today} displayDate={displayDate} onSelect={setSelectedJob} labels={e} statusLabels={tr.status} lang={lang} />
          <div id="my-availability" style={{fontSize:11,fontWeight:800,letterSpacing:1,color:'rgba(255,255,255,0.45)',textTransform:'uppercase',margin:'22px 2px 10px'}}>🗓 {L('My availability and day off','勤務可能日と休み','Minha disponibilidade e folgas')}</div>
          <TimeOffList rows={timeOffListRows(myTimeOff, tokyoToday())} e={e} lang={lang} />
          <AvailabilityPlanner user={user} e={e} lang={lang} plans={weekPlans} onPlansChanged={loadWeekPlans} />
        </>)}

        {/* ACHIEVEMENTS */}

        {tab==='world'&&(
          <Suspense fallback={null}>
            <FacilityWorld audience="employee" viewer={{ id:user.id, name:user.name }} onClose={()=>setTab('home')} />
          </Suspense>
        )}
        {tab==='achievements'&&(
          <div>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',letterSpacing:1.5,textTransform:'uppercase',marginBottom:14}}>{fill(e.badgesEarned,{earned:badges.length,total:BADGE_DEFS.length})}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
              {BADGE_DEFS.map(def=>{
                const earned = badges.find(b=>b.badge_key===def.key)
                return (
                  <div key={def.key} style={{background:earned?'rgba(193,156,86,0.08)':'rgba(255,255,255,0.03)',border:`1px solid rgba(${earned?'193,156,86':'255,255,255'},${earned?'0.18':'0.05'})`,borderRadius:16,padding:'16px 14px',opacity:earned?1:0.45}}>
                    <div style={{fontSize:30,marginBottom:8}}>{def.icon}</div>
                    <div style={{fontSize:13,fontWeight:600,color:earned?'#c19c56':'rgba(255,255,255,0.5)'}}>{e[`badge_${def.key}`]||def.name}</div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:3,lineHeight:1.4}}>{e[`badge_${def.key}_desc`]||def.desc}</div>
                    {earned&&<div style={{fontSize:9,color:'rgba(193,156,86,0.5)',marginTop:6}}>✓ {new Date(earned.earned_at).toLocaleDateString(localeOf(lang),{day:'numeric',month:'short'})}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {quickOpen&&(
        <div className="ex-quick-overlay" onClick={()=>setQuickOpen(false)}>
          <section className="ex-quick-sheet" role="dialog" aria-modal="true" aria-label={e.quickActionTitle} onClick={ev=>ev.stopPropagation()}>
            <div className="ex-quick-grip" />
            <strong>{e.quickActionTitle}</strong>
            {quickActions.map(a=>(
              <button type="button" key={a.label} className="ex-quick-item" onClick={()=>{setQuickOpen(false);a.run()}}>
                <span>{a.icon}</span><div><b>{a.label}</b><small>{a.hint}</small></div>
              </button>
            ))}
          </section>
        </div>
      )}

      {/* BOTTOM TAB BAR */}
      <nav aria-label={L('Main navigation', 'メインナビゲーション', 'Navegação principal')} className="emp-bottom-nav" style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'rgba(6,13,24,0.97)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',borderTop:'1px solid rgba(255,255,255,0.08)',display:'flex',zIndex:50,paddingBottom:'env(safe-area-inset-bottom,0px)'}}>
        {bottomTabs.map(t=>t.key==='quick'?(
          <div key="quick" className="ex-fab-slot"><button type="button" className={`ex-fab${quickOpen?' is-open':''}`} aria-label={e.quickActionTitle} aria-expanded={quickOpen} onClick={()=>setQuickOpen(v=>!v)}>＋</button></div>
        ):(
          <button key={t.key} className={`emp-bottom-item${tab===t.key?' is-active':''}`} onClick={()=>goToTab(t.key)} style={{flex:1,padding:'10px 4px 8px',border:'none',background:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:3,position:'relative'}}>
            <div className="emp-bottom-icon" style={{fontSize:t.key==='salary'?16:18,fontWeight:700,color:tab===t.key?'#c19c56':'rgba(255,255,255,0.3)',lineHeight:1,fontFamily:t.key==='salary'?'monospace':'inherit',transition:'color 0.15s'}}>{t.icon}</div>
            <div className="emp-bottom-label" style={{fontSize:9,color:tab===t.key?'#c19c56':'rgba(255,255,255,0.25)',fontWeight:tab===t.key?600:400,transition:'color 0.15s'}}>{t.label}</div>
            {tab===t.key&&<div style={{position:'absolute',bottom:0,left:'50%',transform:'translateX(-50%)',width:20,height:2,background:'#c19c56',borderRadius:1}} />}
            {t.badge>0&&<div style={{position:'absolute',top:6,right:'calc(50% - 14px)',width:16,height:16,borderRadius:'50%',background:'#f87171',border:'2px solid #060d18',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:800,color:'#fff'}}>{t.badge}</div>}
          </button>
        ))}
      </nav>
    </div>
    </div>
  )
}

function RetroBadge({ labels }) {
  return <span style={{fontSize:9,fontWeight:800,padding:'2px 7px',borderRadius:20,color:'#fbbf24',background:'rgba(251,191,36,0.15)',border:'1px solid rgba(251,191,36,0.35)',letterSpacing:0.3}}>{labels?.retroBadge || 'Retroactive'}</span>
}

function DayGroupView({ allJobs, today, setSelectedJob, fmt, S, labels }) {
  const { lang } = useLang()
  const statusColor = { completed:'#4ade80', assigned:'#60a5fa', in_progress:'#fbbf24', cancelled:'rgba(255,255,255,0.3)' }
  const statusLabel = { completed: labels?.statusCompleted || 'Completed', assigned: labels?.statusAssigned || 'Pending', in_progress: labels?.statusProgress || 'In progress', cancelled: labels?.statusCancelled || 'Cancelled' }
  const groups = {}
  ;(allJobs||[]).forEach(j => { (groups[j.scheduled_date] = groups[j.scheduled_date] || []).push(j) })
  const dates = Object.keys(groups).sort().reverse()
  if (!dates.length) return <div style={{color:'rgba(255,255,255,0.4)',fontSize:13,padding:20,textAlign:'center'}}>{labels?.historyEmpty || 'No services found.'}</div>
  return (
    <div>
      {dates.map(date=>(
        <div key={date} style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:'#c19c56',marginBottom:8}}>{date}{date===today?(labels?.todaySuffix || ' (today)'):''} · {groups[date].length > 1 ? (labels?.serviceCountPlural || '{n} services').replace('{n}', groups[date].length) : (labels?.serviceCount || '{n} service').replace('{n}', groups[date].length)}</div>
          {sortByOrder(groups[date]).map(j=>(
            <div key={j.id} onClick={()=>setSelectedJob&&setSelectedJob(j)} style={{...(S?.card||{}),marginBottom:8,padding:12,cursor:'pointer',background:'rgba(255,255,255,0.03)',borderRadius:12,border:'1px solid rgba(255,255,255,0.06)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontSize:13,fontWeight:600,color:'#fff'}}>{(j.title||'').split(' — ')[0]}</div>
                <div style={{display:'flex',alignItems:'center',gap:6,fontSize:10,color:isMissedJob(j)?'#f87171':(statusColor[j.status]||'rgba(255,255,255,0.4)'),fontWeight:600}}>
                  {isRetroJob(j)&&<RetroBadge labels={labels} />}
                  {isMissedJob(j) ? (labels?.statusIncomplete || 'Incomplete') : j.status==='completed' && j.checklist_total ? `${j.checklist_done ?? 0}/${j.checklist_total}` : (statusLabel[j.status]||j.status)}
                </div>
              </div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginTop:2}}>
                {j.scheduled_time||'—'}
                {j.completed_at&&` · ${labels?.completedAt || 'Completed'} ${new Date(j.completed_at).toLocaleTimeString(localeOf(lang),{hour:'2-digit',minute:'2-digit'})}`}
                {(j.photo_start_url||j.photo_end_url)&&' · 📷'}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ShiftView({ allJobs, tomorrowJobs = [], activeJob, elapsed, checklist, setChecklist, notes, setNotes, jobPhotos, PhotoGrid, handleStart, handleComplete, handleCompleteWithSig, handleAbandonStale, submitting, overdueBusy, fmt, today, S, addPhoto, openRetro, setSelectedJob, serviceContracts, onOpenTraining, hasFacility, onOpenFacility, facilityLabel, onOpenAddService, onOpenPastService, onRegisterLate, onMoveJob, reorderBusy, onAcceptSpot, onDeclineSpot, jobVideo, onPickVideo, onRemoveVideo, videoLabels, voiceOn, onToggleVoice, labels, lang, focusJobId, onAskAI, photoStatus = {}, onRetryPhotos, onReportProblem }) {
  const todayJobs = sortByOrder(allJobs.filter(j=>j.scheduled_date===today))
  const todayQueue = todayJobs.filter(j => j.id !== activeJob?.id)
  const movableIds = todayQueue.filter(j => j.status === 'assigned').map(j => j.id)
  const done = todayJobs.filter(j=>j.status==='completed').length
  const total = todayJobs.length
  const beforePhotos = jobPhotos.filter(p=>p.slot==='start')
  const afterPhotos = jobPhotos.filter(p=>p.slot==='end')
  const showActivePanel = !!activeJob
  const activeIsStale = showActivePanel && isStaleActiveJob(activeJob, today, elapsed)
  const activeChecklist = showActivePanel ? resolveChecklistForJob(activeJob, checklist) : []
  const activeChecklistRequired = activeIsStale
    ? (activeChecklist.length <= 3 ? activeChecklist.length : Math.ceil(activeChecklist.length * 0.7))
    : activeChecklist.length
  const activeChecklistDone = activeChecklist.filter(c => c.done).length
  const activeChecklistBlocked = activeChecklist.length > 0 && (
    activeIsStale
      ? !checklistCompleteForRetro(activeChecklist)
      : !checklistComplete(activeChecklist)
  )
  const activeInstructions = showActivePanel ? keyboxForJob(activeJob) : null
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  // v1.0.96 · any pending job opens and can be started; by default the next one in the day's order is open.
  const [openId, setOpenId] = useState(null)
  const [reorderOpen, setReorderOpen] = useState(false)
  useEffect(() => { if (focusJobId) { setOpenId(focusJobId); setTimeout(() => document.getElementById(`job-card-${focusJobId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250) } }, [focusJobId])
  const firstNextId = activeJob ? null : todayQueue.find((j, idx) => j.status === 'assigned' && todayQueue.slice(0, idx).every(x => x.status === 'completed' || x.status === 'cancelled' || isOverdueAssignedJob(x)))?.id
  const expandedId = activeJob ? null : (openId && todayQueue.some(j => j.id === openId && j.status === 'assigned') ? openId : firstNextId)
  const photoRule = job => job.photo_required
    ? <span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:20,color:'#f87171',background:'rgba(248,113,113,0.12)'}}>📷 {L('Before photo required','作業前写真必須','Foto Antes obrigatória')}</span>
    : <span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:20,color:'rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.06)'}}>📷 {L('Photo optional','写真任意','Foto opcional')}</span>

  return (
    <div>
      {showActivePanel && (
        <div id="active-job-card" style={{...S.card,marginBottom:14,border:'1px solid rgba(251,191,36,0.45)',background:'linear-gradient(135deg,rgba(251,191,36,0.12),rgba(251,191,36,0.03))'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div>
              <div style={{fontSize:10,color:activeIsStale?'#fbbf24':'#4ade80',fontWeight:700,letterSpacing:1,marginBottom:4}}>● {activeIsStale ? labels.staleShiftTitle : labels.activeShiftTitle}</div>
              <div style={{fontSize:16,fontWeight:700,color:'#fff'}}>{activeJob.title.replace(/ — .*/,'')}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.45)',marginTop:3}}>{activeJob.scheduled_date} · {labels.tapToFinish}</div>
            </div>
            {activeIsStale&&<div style={{fontSize:13,fontWeight:700,color:'#fbbf24',fontFamily:'monospace',textAlign:'right'}}>
              {formatShiftElapsed(elapsed, lang)}
            </div>}
          </div>
          {!activeIsStale&&<ServiceTimer job={activeJob} elapsed={elapsed} history={allJobs} voiceOn={voiceOn} onToggleVoice={onToggleVoice} labels={labels} lang={lang} />}
          {activeInstructions && (
            <div style={{background:'rgba(193,156,86,0.12)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:12,padding:'10px 12px',marginBottom:12}}>
              <div style={{fontSize:10,color:'#c19c56',fontWeight:700,marginBottom:4,letterSpacing:0.5}}>🔑 {labels.keybox}</div>
              <KeyReveal value={activeInstructions} multiline icon="" source="employee_job" refId={activeJob.id} label={activeJob.title} linkColor="#c19c56" style={{fontSize:13,color:'rgba(255,255,255,0.85)',lineHeight:1.6}} />
            </div>
          )}
          {onReportProblem&&<button type="button" onClick={()=>onReportProblem(activeJob)} style={{width:'100%',padding:'11px',borderRadius:12,border:'1px solid rgba(248,113,113,0.4)',background:'rgba(248,113,113,0.1)',color:'#fca5a5',fontSize:13,fontWeight:700,cursor:'pointer',marginBottom:8}}>🛠 {L('Report a problem','問題を報告','Reportar problema')}</button>}
          {onAskAI&&<button type="button" onClick={()=>onAskAI(activeJob)} style={{width:'100%',padding:'11px',borderRadius:12,border:'1px solid rgba(168,85,247,0.4)',background:'rgba(168,85,247,0.12)',color:'#d8b4fe',fontSize:13,fontWeight:700,cursor:'pointer',marginBottom:12}}>✦ {L('Ask the AI about this job','この作業についてAIに質問','Perguntar à IA sobre este job')}</button>}
          {hasFacility?.(activeJob)&&(
            <button type="button" onClick={ev=>{ ev.stopPropagation(); onOpenFacility(activeJob) }} style={{width:'100%',padding:'12px',borderRadius:12,border:'1px solid rgba(193,156,86,0.45)',background:'rgba(193,156,86,0.14)',color:'#c19c56',fontSize:14,fontWeight:700,cursor:'pointer',marginBottom:12}}>
              {facilityLabel}
            </button>
          )}
          {!activeJob.photo_start_url && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,color:activeJob.photo_required?'#f87171':'rgba(255,255,255,0.4)',marginBottom:6,letterSpacing:1}}>📷 {labels.before} ({activeJob.photo_required?labels.required:L('optional','任意','opcional')})</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {beforePhotos.map((p,i)=>(
                  <PhotoThumb key={i} p={p} st={photoStatus[p.id]} alt={labels.before} onRetry={onRetryPhotos} L={L} />
                ))}
                <label style={{width:64,height:64,borderRadius:8,border:'1.5px dashed rgba(248,113,113,0.4)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexDirection:'column',gap:2}}>
                  <span style={{fontSize:20}}>📷</span>
                  <input type="file" accept="image/*" capture="environment" multiple style={{display:'none'}} onChange={e=>addPhoto('start',e.target.files)} />
                </label>
              </div>
            </div>
          )}
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder={labels.notes+'...'} style={{width:'100%',padding:'10px 12px',borderRadius:10,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'#fff',fontSize:13,resize:'none',height:60,boxSizing:'border-box',marginBottom:12}} />
          <div style={{marginBottom:12}}>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:6,letterSpacing:1}}>📷 {labels.after} ({afterPhotos.length}) — {labels.afterLater || L('camera or gallery · can be sent later', 'カメラまたはギャラリー・あとで送信可', 'câmera ou galeria · pode enviar depois')}</div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {afterPhotos.map((p,i)=>(
                <PhotoThumb key={i} p={p} st={photoStatus[p.id]} alt={labels.after} onRetry={onRetryPhotos} L={L} />
              ))}
              <label style={{width:64,height:64,borderRadius:8,border:'1.5px dashed rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexDirection:'column',gap:2}}>
                <span style={{fontSize:20}}>📷</span>
                <input type="file" accept="image/*" multiple style={{display:'none'}} onChange={e=>addPhoto('end',e.target.files)} />
              </label>
            </div>
          </div>
          {onPickVideo && <JobVideoPicker video={jobVideo} onPick={onPickVideo} onRemove={onRemoveVideo} labels={videoLabels} />}
          {activeIsStale && (
            <div style={{fontSize:11,color:'rgba(255,255,255,0.45)',marginBottom:8,lineHeight:1.4}}>
              {labels.staleChecklistScroll || 'Scroll to see all checklist items'} · {labels.staleChecklistMin || `min ${activeChecklistRequired}/${activeChecklist.length}`}
            </div>
          )}
          <ChecklistPicker checklist={activeChecklist} setChecklist={setChecklist} relaxed={activeIsStale} labels={labels} lang={lang} />
          <div id="active-job-finish" style={{position:'sticky',bottom:'calc(74px + env(safe-area-inset-bottom,0px))',zIndex:20,paddingTop:6}}>
          <button onClick={()=>{ if(activeChecklistBlocked){toast.error(activeIsStale?fill(labels.staleChecklistHint || 'Mark at least {required} of {total}', { required: activeChecklistRequired, total: activeChecklist.length }):labels.markAllChecklist);return}; handleCompleteWithSig(activeJob) }} disabled={submitting||activeChecklistBlocked} style={{width:'100%',padding:'16px',borderRadius:14,border:'none',background:submitting||activeChecklistBlocked?'#64748b':'linear-gradient(135deg,#4ade80,#22c55e)',color:submitting||activeChecklistBlocked?'#fff':'#0a1929',fontSize:15,fontWeight:800,cursor:submitting||activeChecklistBlocked?'not-allowed':'pointer',marginBottom:8,boxShadow:'0 6px 18px rgba(0,0,0,0.18)'}}>
            {submitting?L('Saving...','保存中...','Salvando...'):activeChecklistBlocked?`✓ ${activeChecklistDone}/${activeChecklistRequired}`:`✅ ${labels.complete}`}
          </button>
          </div>
          <button type="button" onClick={()=>handleAbandonStale?.(activeJob)} disabled={submitting} style={{width:'100%',padding:'12px',borderRadius:12,border:'1px solid rgba(251,191,36,0.35)',background:'rgba(251,191,36,0.08)',color:'#fbbf24',fontSize:13,fontWeight:600,cursor:submitting?'not-allowed':'pointer'}}>
            {labels.staleShiftReset}
          </button>
        </div>
      )}
      {!activeJob && onOpenPastService&&(
        <button
          type="button"
          onClick={()=>onOpenPastService()}
          className="emp-outline-button"
          style={{width:'100%',padding:'14px 16px',marginBottom:10,borderRadius:14,border:'1px solid rgba(193,156,86,0.35)',background:'linear-gradient(135deg,rgba(193,156,86,0.18),rgba(232,196,122,0.1))',color:'#e8c47a',fontSize:14,fontWeight:800,cursor:'pointer'}}
        >
          ✓ {labels?.pastServiceButton || 'Already did this'}
        </button>
      )}
      {!activeJob && onOpenAddService&&(
        <button
          type="button"
          onClick={onOpenAddService}
          className="emp-add-service-button"
          style={{width:'100%',padding:'14px 16px',marginBottom:14,borderRadius:14,border:'1px dashed rgba(96,165,250,0.35)',background:'rgba(96,165,250,0.08)',color:'#60a5fa',fontSize:14,fontWeight:700,cursor:'pointer'}}
        >
          + {labels?.addService || 'Add service'}
        </button>
      )}
      {total>0&&<div style={{background:'rgba(255,255,255,0.04)',borderRadius:16,padding:'14px 16px',marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{fontSize:13,fontWeight:600,color:'#fff'}}>{(labels?.locationsProgress || '{done}/{total} locations').replace('{done}', done).replace('{total}', total)}</div>
          <div style={{fontSize:12,color:done===total&&total>0?'#4ade80':'rgba(255,255,255,0.4)'}}>{done===total&&total>0?`✅ ${labels?.allDone || 'All done!'}`:(labels?.remaining || '{n} remaining').replace('{n}', total-done)}</div>
        </div>
        <div style={{height:4,background:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
          <div style={{height:'100%',width:total>0?(done/total*100)+'%':'0%',background:'linear-gradient(90deg,#60a5fa,#4ade80)',borderRadius:2,transition:'width 0.4s'}} />
        </div>
      </div>}

      {/* v1.0.102 · the employee changes the order of today's services; the admin sees the same order. */}
      {onMoveJob&&movableIds.length>1&&(
        <div className="emp-reorder">
          {!reorderOpen ? (
            <button type="button" className="emp-reorder-open" onClick={()=>setReorderOpen(true)}>
              ↕ {L('Change the order of my day','今日の順番を変える','Mudar a ordem do meu dia')}
            </button>
          ) : (
            <>
              <div className="emp-reorder-head">
                <b>↕ {L('Order of my day','今日の順番','Ordem do meu dia')}</b>
                <button type="button" className="emp-reorder-done" onClick={()=>setReorderOpen(false)}>{L('Done','完了','Pronto')}</button>
              </div>
              <p className="emp-reorder-hint">{L('Use the arrows. The office sees the same order.','矢印で並べ替え。事務所にも同じ順番が表示されます。','Use as setas. O escritório vê a mesma ordem.')}</p>
              <ol className="emp-reorder-list">
                {todayQueue.filter(j=>movableIds.includes(j.id)).map((job,i,arr)=>(
                  <li key={job.id} className="emp-reorder-item">
                    <span className="emp-reorder-n">{i+1}</span>
                    <span className="emp-reorder-name"><b>{job.title.replace(/ — .*/,'')}</b><small>{String(job.scheduled_time||'').slice(0,5)||'—'}</small></span>
                    <button type="button" className="emp-reorder-btn" disabled={reorderBusy||i===0} aria-label={labels?.moveUp||L('Move up','上へ','Subir')} onClick={()=>onMoveJob(job,-1)}>▲</button>
                    <button type="button" className="emp-reorder-btn" disabled={reorderBusy||i===arr.length-1} aria-label={labels?.moveDown||L('Move down','下へ','Descer')} onClick={()=>onMoveJob(job,1)}>▼</button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      {!activeJob && total===0&&<div className="emp-shift-empty">
        <div className="emp-empty-icon">☀</div>
        <div className="emp-empty-kicker">{labels?.todayShift || 'Today'}</div>
        <h2>{labels?.noShiftToday || labels?.noJobsToday || 'No shifts today'}</h2>
        <p>{labels?.noJobsToday || 'No jobs today'}</p>
      </div>}

      {todayQueue.map((job,idx)=>{
        const isActive = false
        const isDone = job.status==='completed'
        const isOverdue = !isDone && !isActive && job.status==='assigned' && isOverdueAssignedJob(job)
        const isCritical = isOverdue && isCriticallyOverdueJob(job)
        // Late jobs can still be checked in until the day ends; the late registration is an extra option.
        const isNext = job.id === expandedId
        const canOpen = !activeJob && job.status==='assigned' && !isNext
        const instructions = keyboxForJob(job)
        const trainingContract = contractForJob(job, serviceContracts)
        const hasTraining = trainingContract?.training_video_url

        return (
          <div key={job.id} id={isActive?'active-job-card':`job-card-${job.id}`}
            onClick={()=>{ if(isDone&&setSelectedJob) setSelectedJob(job); else if(canOpen) setOpenId(job.id) }}
            style={{...S.card,marginBottom:10,opacity:isDone?0.85:1,cursor:isDone||canOpen?'pointer':'default',border:isActive?'1px solid rgba(74,222,128,0.4)':isDone?'1px solid rgba(74,222,128,0.2)':'1px solid rgba(255,255,255,0.08)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isActive||isNext||isDone?8:0}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0,background:isDone?'rgba(74,222,128,0.2)':isActive?'rgba(74,222,128,0.15)':'rgba(255,255,255,0.06)',color:isDone?'#4ade80':isActive?'#4ade80':'rgba(255,255,255,0.4)'}}>
                  {isDone?'✓':idx+1}
                </div>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:isDone?'rgba(255,255,255,0.4)':'#fff',textDecoration:isDone?'line-through':'none'}}>{job.title.replace(/ — .*/,'')}</div>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginTop:3,flexWrap:'wrap'}}>
                    {(() => {
                      const ct = getCleaningType(job)
                      const cfg = cleaningTypesForLang(lang)[ct]
                      if (!cfg) return null
                      return (
                        <span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:20,color:cfg.color,background:ct==='deep'?'rgba(251,191,36,0.15)':'rgba(96,165,250,0.15)'}}>
                          {cfg.short}
                        </span>
                      )
                    })()}
                    {isRetroJob(job)&&<RetroBadge labels={labels} />}
                    {!isDone&&photoRule(job)}
                    <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{job.scheduled_time}{instructions&&` · ${instructions.split('\n')[0]}`}</span>
                    {canOpen&&<span style={{fontSize:10,color:'#60a5fa',fontWeight:700}}>{L('Tap to open','タップして開く','Toque para abrir')} ›</span>}
                  </div>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {isActive&&<span style={{fontSize:14,color:'#4ade80',fontWeight:700,fontFamily:'monospace'}}>▶ {fmt(elapsed)}</span>}
                {isDone&&<span style={{fontSize:10,color:'#4ade80',fontWeight:600}}>{L('View details','詳細を見る','Ver detalhes')} ›</span>}
                {hasMapsLink(job.address, job.title)&&<a href={mapsOpenUrl(job.address, job.title)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:20,textDecoration:'none'}}>🗺</a>}
                {!isDone&&<a href={googleCalendarUrl(job)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} aria-label={labels?.calGoogle} title={labels?.calGoogle} style={{fontSize:18,textDecoration:'none'}}>📅</a>}
                {!isDone&&job.job_category==='spot'&&setSelectedJob&&<button type="button" onClick={e=>{e.stopPropagation();setSelectedJob(job)}} aria-label={labels?.contractTitle} title={labels?.contractTitle} style={{fontSize:18,background:'none',border:'none',padding:0,cursor:'pointer'}}>📄</button>}
              </div>
            </div>

            {isOverdue&&(
              <div style={{background:isCritical?'rgba(248,113,113,0.12)':'rgba(251,191,36,0.1)',border:`1px solid ${isCritical?'rgba(248,113,113,0.35)':'rgba(251,191,36,0.3)'}`,borderRadius:12,padding:'12px',marginBottom:10}}>
                <div style={{fontSize:12,color:isCritical?'#f87171':'#fbbf24',fontWeight:700,marginBottom:4}}>
                  {labels.overdueTitle}
                </div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.55)',marginBottom:10,lineHeight:1.5}}>
                  {labels.overdueHint}
                </div>
                <button
                  type="button"
                  disabled={overdueBusy===job.id}
                  onClick={(e)=>{ e.stopPropagation(); onRegisterLate?.(job) }}
                  style={{width:'100%',padding:'12px 10px',borderRadius:10,border:'none',background:overdueBusy===job.id?'rgba(255,255,255,0.08)':'linear-gradient(135deg,#c19c56,#e8c47a)',color:overdueBusy===job.id?'rgba(255,255,255,0.3)':'#0a1929',fontSize:13,fontWeight:800,cursor:overdueBusy===job.id?'not-allowed':'pointer'}}
                >
                  📝 {labels.overdueRegisterLate}
                </button>
              </div>
            )}

            {isNext&&!isActive&&instructions&&(
              <KeyReveal value={instructions.split('\n')[0]} source="employee_job" refId={job.id} label={job.title} linkColor="#c19c56" style={{background:'rgba(193,156,86,0.08)',borderRadius:10,padding:'8px 10px',marginBottom:8,fontSize:12,color:'rgba(255,255,255,0.65)',lineHeight:1.5}} />
            )}

            {(isNext||isActive)&&hasFacility?.(job)&&(
              <button type="button" onClick={ev=>{ ev.stopPropagation(); onOpenFacility(job) }} style={{width:'100%',padding:'10px',borderRadius:12,border:'1px solid rgba(193,156,86,0.35)',background:'rgba(193,156,86,0.1)',color:'#c19c56',fontSize:13,fontWeight:700,cursor:'pointer',marginBottom:8}}>
                {facilityLabel}
              </button>
            )}

            {isActive&&(() => {
              const jobChecklist = resolveChecklistForJob(job, checklist)
              const checklistBlocked = jobChecklist.length > 0 && !checklistComplete(jobChecklist)
              return (
              <div>
                {instructions&&(
                  <div style={{background:'rgba(193,156,86,0.12)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:12,padding:'10px 12px',marginBottom:12}}>
                    <div style={{fontSize:10,color:'#c19c56',fontWeight:700,marginBottom:4,letterSpacing:0.5}}>🔑 {labels.keybox}</div>
                    <KeyReveal value={instructions} multiline icon="" source="employee_job" refId={job.id} label={job.title} linkColor="#c19c56" style={{fontSize:13,color:'rgba(255,255,255,0.85)',lineHeight:1.6}} />
                  </div>
                )}
                {job.photo_start_url&&(
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:6,letterSpacing:1}}>📷 {labels.before}</div>
                    <img src={viewablePhotoUrl(job.photo_start_url)} style={{width:64,height:64,borderRadius:8,objectFit:'cover'}} alt={labels.before} />
                  </div>
                )}

                {!job.photo_start_url&&(
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:'#f87171',marginBottom:6,letterSpacing:1}}>📷 {labels.before} ({labels.required})</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {beforePhotos.map((p,i)=>(
                        <img key={i} src={p.preview} style={{width:64,height:64,borderRadius:8,objectFit:'cover'}} alt={labels.before} />
                      ))}
                      <label style={{width:64,height:64,borderRadius:8,border:'1.5px dashed rgba(248,113,113,0.4)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexDirection:'column',gap:2}}>
                        <span style={{fontSize:20}}>📷</span>
                        <span style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>{labels.before}</span>
                        <input type="file" accept="image/*" capture="environment" multiple style={{display:'none'}} onChange={e=>addPhoto('start',e.target.files)} />
                      </label>
                    </div>
                  </div>
                )}

                <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder={labels.notes+'...'} style={{width:'100%',padding:'10px 12px',borderRadius:10,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'#fff',fontSize:13,resize:'none',height:60,boxSizing:'border-box',marginBottom:12}} />

                {/* AFTER photos */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:6,letterSpacing:1}}>📷 {labels.after} ({afterPhotos.length}) — {labels.afterLater || L('camera or gallery · can be sent later', 'カメラまたはギャラリー・あとで送信可', 'câmera ou galeria · pode enviar depois')}</div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    {afterPhotos.map((p,i)=>(
                      <img key={i} src={p.preview} style={{width:64,height:64,borderRadius:8,objectFit:'cover'}} alt={labels.after} />
                    ))}
                    <label style={{width:64,height:64,borderRadius:8,border:'1.5px dashed rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:20}}>📷</span>
                      <span style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>{labels.after}</span>
                      <input type="file" accept="image/*" multiple style={{display:'none'}} onChange={e=>addPhoto('end',e.target.files)} />
                    </label>
                  </div>
                </div>
                {onPickVideo && <JobVideoPicker video={jobVideo} onPick={onPickVideo} onRemove={onRemoveVideo} labels={videoLabels} />}

                <ChecklistPicker checklist={jobChecklist} setChecklist={setChecklist} labels={labels} lang={lang} />

                <button onClick={()=>{ if(!activeJob){toast.error(L('No active job','進行中の作業がありません','Nenhum serviço ativo'));return}; if(checklistBlocked){toast.error(labels.markAllChecklist);return}; handleCompleteWithSig(activeJob) }} disabled={submitting||checklistBlocked} style={{width:'100%',padding:'16px',borderRadius:14,border:'none',background:submitting||checklistBlocked?'rgba(255,255,255,0.1)':'linear-gradient(135deg,#4ade80,#22c55e)',color:'#0a1929',fontSize:15,fontWeight:800,cursor:submitting||checklistBlocked?'not-allowed':'pointer'}}>
                  {submitting?L('Saving...','保存中...','Salvando...'):checklistBlocked?`✓ Checklist ${jobChecklist.filter(c=>c.done).length}/${jobChecklist.length}`:L('✅ Done → Next','✅ 完了 → 次へ','✅ Feito → Próximo')}
                </button>
              </div>
            )})()}

            {isNext&&isPendingSpot(job)&&onAcceptSpot&&(
              <div style={{background:'rgba(193,156,86,0.1)',border:'1px solid rgba(193,156,86,0.35)',borderRadius:12,padding:12}}>
                <div style={{fontSize:13,fontWeight:700,color:'#c19c56',marginBottom:10,lineHeight:1.5}}>⚡ {labels.spotAcceptFirst}</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <button type="button" onClick={()=>onDeclineSpot?.(job)} style={{padding:'13px',borderRadius:12,border:'1px solid rgba(255,255,255,0.12)',background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.55)',fontSize:14,fontWeight:700,cursor:'pointer'}}>✕ {labels.decline}</button>
                  <button type="button" onClick={()=>onAcceptSpot(job)} style={{padding:'13px',borderRadius:12,border:'none',background:'linear-gradient(135deg,#0F6E56,#16a37e)',color:'#fff',fontSize:14,fontWeight:800,cursor:'pointer'}}>✅ {labels.accept}</button>
                </div>
              </div>
            )}

            {isNext&&!(isPendingSpot(job)&&onAcceptSpot)&&(
              <div>
                {onAskAI&&<button type="button" onClick={()=>onAskAI(job)} style={{width:'100%',padding:'11px',borderRadius:12,border:'1px solid rgba(168,85,247,0.4)',background:'rgba(168,85,247,0.12)',color:'#d8b4fe',fontSize:13,fontWeight:700,cursor:'pointer',marginBottom:12}}>✦ {L('Ask the AI about this job','この作業についてAIに質問','Perguntar à IA sobre este job')}</button>}
                {hasTraining&&(
                  <button type="button" onClick={()=>onOpenTraining({ job, contract: trainingContract })} style={{width:'100%',padding:'12px',borderRadius:12,border:'1px solid rgba(193,156,86,0.35)',background:'rgba(193,156,86,0.12)',color:'#c19c56',fontSize:14,fontWeight:700,cursor:'pointer',marginBottom:12}}>
                    🎬 {L('View cleaning manual', '清掃マニュアルを見る', 'Ver manual de limpeza')}
                  </button>
                )}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:10,color:job.photo_required?'#f87171':'rgba(255,255,255,0.4)',marginBottom:6,letterSpacing:1}}>📷 {labels.before} ({beforePhotos.length}) — {job.photo_required?labels.required:L('optional','任意','opcional')}</div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    {beforePhotos.map((p,i)=>(
                      <img key={i} src={p.preview} style={{width:64,height:64,borderRadius:8,objectFit:'cover'}} alt={labels.before} />
                    ))}
                    <label style={{width:64,height:64,borderRadius:8,border:'1.5px dashed rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:20}}>📷</span>
                      <span style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>{labels.before}</span>
                      <input type="file" accept="image/*" capture="environment" multiple style={{display:'none'}} onChange={e=>addPhoto('start',e.target.files)} />
                    </label>
                  </div>
                </div>
                {(() => { const needPhoto = job.photo_required && beforePhotos.length===0; return (
                <button onClick={()=>handleStart(job)} disabled={submitting||needPhoto} style={{width:'100%',padding:'16px',borderRadius:14,border:'none',background:submitting||needPhoto?'rgba(255,255,255,0.1)':'linear-gradient(135deg,#60a5fa,#3b82f6)',color:'#fff',fontSize:15,fontWeight:800,cursor:submitting||needPhoto?'not-allowed':'pointer'}}>
                  {submitting?L('Starting...','開始中...','Iniciando...'):needPhoto?L('📷 Take the Before photo first','📷 先に作業前の写真を撮ってください','📷 Tire a foto Antes primeiro'):`▶ ${L('Start','開始','Iniciar')} — `+job.title.replace(/ — .*/,'')}
                </button>
                ) })()}
              </div>
            )}
          </div>
        )
      })}

      {tomorrowJobs.length>0&&(
        <div style={{marginTop:18}}>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:1,color:'rgba(255,255,255,0.45)',textTransform:'uppercase',margin:'0 2px 8px'}}>☾ {labels.tomorrowShift} · {fill(labels.tomorrowStarts,{time:tomorrowJobs[0].scheduled_time||'—'})}</div>
          {tomorrowJobs.map(job=>(
            <div key={job.id} role="button" tabIndex={0} onClick={()=>setSelectedJob?.(job)} onKeyDown={ev=>{if(ev.key==='Enter')setSelectedJob?.(job)}}
              style={{...S.card,marginBottom:8,cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:'#fff'}}>{job.title.replace(/ — .*/,'')}</div>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:3}}>{job.scheduled_date} · {job.scheduled_time||'—'}</div>
              </div>
              <a href={googleCalendarUrl(job)} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()} aria-label={labels?.calGoogle} title={labels?.calGoogle} style={{fontSize:18,textDecoration:'none'}}>📅</a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


function CalendarView({ jobs, today, displayDate, onSelect, labels, statusLabels, lang }) {
  const [cm, setCm] = useState(() => { const d=new Date(); return {year:d.getFullYear(),month:d.getMonth()} })
  const { year, month } = cm
  const firstDay = new Date(year,month,1).getDay()
  const daysInMonth = new Date(year,month+1,0).getDate()
  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`
  const jobsByDate = {}
  jobs.forEach(j=>{ const d=displayDate(j); if(d?.startsWith(monthStr)){ if(!jobsByDate[d]) jobsByDate[d]=[]; jobsByDate[d].push(j) } })
  const gc = dj => { if(!dj||!dj.length) return null; if(dj.every(j=>j.status==='completed')) return '#4ade80'; if(dj.some(j=>j.status==='in_progress')) return '#fbbf24'; if(dj.some(j=>j.status==='assigned')) return '#60a5fa'; return null }
  const [sel, setSel] = useState(null)
  const selJobs = sel?(jobsByDate[sel]||[]):[]
  return (
    <div>
      <div className="emp-calendar-toolbar">
        <button aria-label={pickLang(lang,'Previous month','前の月','Mês anterior')} onClick={()=>setCm(m=>{const d=new Date(m.year,m.month-1);return{year:d.getFullYear(),month:d.getMonth()}})}>‹</button>
        <div>{new Date(year,month).toLocaleString(localeOf(lang),{month:'long',year:'numeric'})}</div>
        <button aria-label={pickLang(lang,'Next month','次の月','Próximo mês')} onClick={()=>setCm(m=>{const d=new Date(m.year,m.month+1);return{year:d.getFullYear(),month:d.getMonth()}})}>›</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:4}}>
        {pickLang(lang,['S','M','T','W','T','F','S'],['日','月','火','水','木','金','土'],['D','S','T','Q','Q','S','S']).map((d,i)=><div className="emp-calendar-weekday" key={i}>{d}</div>)}
      </div>
      <div className="emp-calendar-grid">
        {Array(firstDay).fill(null).map((_,i)=><div key={'e'+i} />)}
        {Array(daysInMonth).fill(null).map((_,i)=>{
          const day=i+1
          const dStr=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const dj=jobsByDate[dStr]||[]
          const color=gc(dj)
          const isToday=dStr===today
          const isSel=dStr===sel
          return (
            <div className={`emp-calendar-day${isToday?' is-today':''}${isSel?' is-selected':''}${dj.length?' has-jobs':''}`} key={day} onClick={()=>dj.length>0&&setSel(isSel?null:dStr)}>
              <div className="emp-calendar-day-number">{day}</div>
              {color&&<div style={{width:5,height:5,borderRadius:'50%',background:color,marginTop:2}} />}
              {dj.length>1&&<div style={{fontSize:7,color:'rgba(255,255,255,0.3)',marginTop:1}}>{dj.length}</div>}
            </div>
          )
        })}
      </div>
      <div className="emp-calendar-legend">
        {[['#4ade80', statusLabels?.completed || 'Done'],['#60a5fa', statusLabels?.assigned || 'Scheduled'],['#fbbf24', statusLabels?.in_progress || 'Active']].map(([c,l])=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:8,height:8,borderRadius:'50%',background:c}} /><span>{l}</span></div>
        ))}
      </div>
      {sel&&(
        <div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase',marginBottom:10}}>{new Date(sel+'T12:00:00').toLocaleDateString(localeOf(lang),{weekday:'long',day:'numeric',month:'long'})}</div>
          {sortByOrder(selJobs).map(j=>{
            const sc={completed:'#4ade80',assigned:'#60a5fa',in_progress:'#fbbf24',cancelled:'rgba(255,255,255,0.2)'}[j.status]
            const duration=j.started_at&&j.completed_at?Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000):null
            return (
              <div key={j.id} onClick={()=>onSelect(j)} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:14,padding:'12px 14px',marginBottom:8,cursor:'pointer'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                  <div style={{flex:1,marginRight:8}}><div style={{fontSize:13,fontWeight:600,color:'#fff'}}>{j.title.replace(/ — .*/,'')}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:1}}>{j.scheduled_time}</div></div>
                  <span style={{fontSize:9,color:sc,fontWeight:700,textTransform:'uppercase'}}>{statusLabels?.[j.status]||j.status}</span>
                </div>
                <div style={{display:'flex',gap:10,fontSize:9,color:'rgba(255,255,255,0.25)'}}>
                  {j.started_at&&<span>▶ {new Date(j.started_at).toLocaleTimeString(localeOf(lang),{hour:'2-digit',minute:'2-digit'})}</span>}
                  {j.completed_at&&<span>🏁 {new Date(j.completed_at).toLocaleTimeString(localeOf(lang),{hour:'2-digit',minute:'2-digit'})}</span>}
                  {duration&&<span>⏱ {duration}m</span>}
                  <span style={{marginLeft:'auto'}}>{labels?.details || 'details ›'}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SignatureModal({ onConfirm, onCancel, jobTitle, labels }) {
  const canvasRef = useRef()
  const [drawing, setDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const lastPos = useRef(null)

  // Paint the pad white so the saved PNG is dark ink on paper (a transparent PNG
  // with white ink showed up blank on reports and PDFs).
  const paper = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  useEffect(() => { paper() }, [])

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if (e.touches) {
      return { x:(e.touches[0].clientX-rect.left)*scaleX, y:(e.touches[0].clientY-rect.top)*scaleY }
    }
    return { x:(e.clientX-rect.left)*scaleX, y:(e.clientY-rect.top)*scaleY }
  }

  const startDraw = (e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    lastPos.current = pos
    setDrawing(true)
    setHasSignature(true)
  }

  const draw = (e) => {
    if (!drawing) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = SIGNATURE_INK
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    lastPos.current = pos
  }

  const endDraw = () => setDrawing(false)

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    paper()
    setHasSignature(false)
  }

  const confirm = () => {
    const canvas = canvasRef.current
    const dataUrl = canvas.toDataURL('image/png')
    onConfirm(dataUrl)
  }

  return (
    <div className="emp-sheet-backdrop" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:300,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
      <div className="emp-sheet" style={{background:'#0d1f35',borderRadius:'24px 24px 0 0',padding:'20px 20px 50px'}}>
        <div style={{width:40,height:4,background:'rgba(255,255,255,0.15)',borderRadius:2,margin:'0 auto 18px'}} />
        <div style={{fontSize:16,fontWeight:700,color:'#fff',marginBottom:4,textAlign:'center'}}>{labels?.signToComplete || 'Sign to complete'}</div>
        <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',textAlign:'center',marginBottom:16}}>{jobTitle}</div>

        {/* Canvas */}
        <div style={{position:'relative',borderRadius:14,overflow:'hidden',border:'1px solid #cfd8e6',marginBottom:14,background:'#fff'}}>
          <canvas ref={canvasRef} width={380} height={160}
            style={{width:'100%',height:160,display:'block',touchAction:'none'}}
            onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
            onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
          />
          {!hasSignature&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',color:'#9aa6b8',fontSize:14,pointerEvents:'none'}}>{labels?.signHere || 'Sign here with your finger'}</div>}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
          <button onClick={clear} style={{padding:'13px',borderRadius:12,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.5)',fontSize:13,cursor:'pointer'}}>{labels?.clear || 'Clear'}</button>
          <button onClick={onCancel} style={{padding:'13px',borderRadius:12,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.5)',fontSize:13,cursor:'pointer'}}>{labels?.cancel || 'Cancel'}</button>
          <button onClick={confirm} disabled={!hasSignature} style={{padding:'13px',borderRadius:12,border:'none',background:hasSignature?'linear-gradient(135deg,#c19c56,#e8c47a)':'rgba(255,255,255,0.07)',color:hasSignature?'#0a1929':'rgba(255,255,255,0.25)',fontSize:13,fontWeight:700,cursor:hasSignature?'pointer':'not-allowed'}}>
            ✓ {labels?.confirm || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TrainingModal({ job, contract, onClose, lang, labels }) {
  const embed = youtubeEmbedUrl(contract?.training_video_url)
  const items = parseTrainingChecklist(contract?.training_checklist)
  const loc = (job?.title || '').replace(/ — .*/, '')
  return (
    <div className="emp-sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="emp-sheet" onClick={e => e.stopPropagation()} style={{ background: '#0a1525', borderRadius: '20px 20px 0 0', padding: '18px 16px 28px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#c19c56', fontWeight: 700 }}>🎬 {labels?.cleaningManual || pickLang(lang, 'Cleaning manual', '清掃マニュアル', 'Manual de limpeza')}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 4 }}>{loc}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer' }}>✕</button>
        </div>
        {embed ? (
          <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 12, overflow: 'hidden', marginBottom: 14, background: '#000' }}>
            <iframe title="Training" src={embed} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 14 }}>{labels?.videoInvalid || 'Video URL invalid'}</div>
        )}
        {items.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 8, letterSpacing: 1 }}>{labels?.preWorkChecklist || pickLang(lang, 'Pre-work checklist', '作業前チェックリスト', 'Checklist antes do serviço')}</div>
            {items.map((label, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', marginBottom: 6, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: '#c19c56', fontWeight: 700 }}>{i + 1}.</span>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.45 }}>{label}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={onClose} style={{ width: '100%', marginTop: 16, padding: 14, borderRadius: 12, border: 'none', background: '#c19c56', color: '#0a1929', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          {labels?.closeAndStart || pickLang(lang, 'Close and start work', '閉じて作業を開始', 'Fechar e começar o serviço')}
        </button>
      </div>
    </div>
  )
}

// v1.0.112 · photo with its upload state: sending… / sent ✓ / failed — tap to try again
function PhotoThumb({ p, st, alt, onRetry, L }) {
  const badge = st?.state === 'sent' ? { t: '✓', bg: '#22c55e' } : st?.state === 'failed' ? { t: '!', bg: '#ef4444' } : st?.state === 'sending' ? { t: '…', bg: '#64748b' } : null
  return (
    <div style={{ position: 'relative', width: 64 }}>
      <img src={p.preview} style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', opacity: st?.state === 'sending' ? 0.6 : 1 }} alt={alt} />
      {badge && <span style={{ position: 'absolute', top: 3, right: 3, minWidth: 18, height: 18, borderRadius: 9, background: badge.bg, color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{badge.t}</span>}
      {st?.state === 'failed' && <button type="button" onClick={onRetry} style={{ width: '100%', marginTop: 3, border: 'none', borderRadius: 6, background: 'rgba(239,68,68,0.18)', color: '#fca5a5', fontSize: 9, fontWeight: 700, padding: '3px 0', cursor: 'pointer' }}>{L('Failed — retry', '失敗 — 再送', 'Falhou — tentar de novo')}</button>}
      {st?.state === 'sent' && <div style={{ fontSize: 9, color: '#86efac', textAlign: 'center', marginTop: 2 }}>{L('sent', '送信済み', 'enviado')}</div>}
    </div>
  )
}

function ProblemSheet({ job, onSend, onClose, L }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!text.trim()) return toast.error(L('Write what happened', '何があったか書いてください', 'Escreva o que aconteceu'))
    setBusy(true)
    try { await onSend({ job, text, file }); toast.success(L('Sent to the office', '事務所に送信しました', 'Enviado ao escritório')); onClose() } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <div className="emp-sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'flex-end' }} onClick={() => !busy && onClose()}>
      <div className="emp-sheet" onClick={ev => ev.stopPropagation()} style={{ width: '100%', maxWidth: 430, margin: '0 auto', background: '#0a1525', borderRadius: '20px 20px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom,0px))' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4 }}>🛠 {L('Report a problem', '問題を報告', 'Reportar problema')}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>{String(job.title || '').split(' — ')[0]} · {job.scheduled_date} — {L('goes to the office with this job', 'この作業と一緒に事務所へ送ります', 'vai para o escritório junto com este job')}</div>
        <textarea value={text} onChange={ev => setText(ev.target.value)} placeholder={L('What happened? (broken item, no key, client asked…)', '何がありましたか？（故障・鍵がない・お客様の依頼…）', 'O que aconteceu? (item quebrado, sem chave, pedido do cliente…)')} style={{ width: '100%', height: 90, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, resize: 'none', boxSizing: 'border-box', marginBottom: 10 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>
          📷 {file ? file.name : L('Add a photo (optional)', '写真を追加（任意）', 'Adicionar foto (opcional)')}
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={ev => setFile(ev.target.files?.[0] || null)} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ padding: 14, borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#fff', fontWeight: 700 }}>{L('Cancel', 'キャンセル', 'Cancelar')}</button>
          <button type="button" onClick={send} disabled={busy} style={{ padding: 14, borderRadius: 12, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 800 }}>{busy ? '…' : L('Send', '送信', 'Enviar')}</button>
        </div>
      </div>
    </div>
  )
}

function ChecklistPicker({ checklist, setChecklist, relaxed = false, labels, lang = 'en' }) {
  if (!checklist?.length) return null
  const done = checklist.filter(c => c.done).length
  const required = relaxed
    ? (checklist.length <= 3 ? checklist.length : Math.ceil(checklist.length * 0.7))
    : checklist.length
  const pct = Math.round(done / checklist.length * 100)
  const allDone = relaxed ? done >= required : done === checklist.length
  return (
    <div style={{ marginBottom: 12, maxHeight: relaxed ? 280 : undefined, overflowY: relaxed ? 'auto' : undefined, WebkitOverflowScrolling: 'touch' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }}>✓ {relaxed ? (labels?.checklistMin || 'CHECKLIST ({done}/{required} min)').replace('{done}', done).replace('{required}', required) : (labels?.checklistRequired || 'REQUIRED CHECKLIST ({done}/{total})').replace('{done}', done).replace('{total}', checklist.length)}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: allDone ? '#4ade80' : pct >= 50 ? '#fbbf24' : '#f87171' }}>{pct}%</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: allDone ? '#4ade80' : 'linear-gradient(90deg,#f87171,#4ade80)', transition: 'width 0.3s' }} />
      </div>
      {checklist.map((c, i) => (
        <div key={i} onClick={() => setChecklist(cl => cl.map((x, j) => j === i ? { ...x, done: !x.done } : x))} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', marginBottom: 5, borderRadius: 10, cursor: 'pointer', background: c.done ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${c.done ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, background: c.done ? '#4ade80' : 'transparent', border: c.done ? 'none' : '1.5px solid rgba(255,255,255,0.2)', color: '#0a1929', fontWeight: 800 }}>{c.done ? '✓' : ''}</div>
          <span style={{ fontSize: 13, color: c.done ? '#fff' : 'rgba(255,255,255,0.6)' }}>{checklistDisplayLabel(c.label, lang)}</span>
        </div>
      ))}
      {!allDone && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{relaxed ? `⚠️ ${(labels?.staleChecklistHint || 'Mark at least {required} of {total}').replace('{required}', required).replace('{total}', checklist.length)}` : `⚠️ ${labels?.markAllToFinish || 'Mark every item to finish the service.'}`}</div>}
    </div>
  )
}

function AddServiceModal({ employeeId, todayJobs, labels, lang, busy, onClose, onAdd }) {
  const [search, setSearch] = useState('')
  const [cleaningType, setCleaningType] = useState('basic')
  const [deepComponents, setDeepComponents] = useState([...ALL_DEEP_COMPONENT_IDS])
  const [picked, setPicked] = useState(null)
  const [day, setDay] = useState('today')
  const [shiftStart, setShiftStart] = useState('00:30')
  const [shiftEnd, setShiftEnd] = useState('05:00')

  const typeLabels = cleaningTypesForLang(lang)
  const locations = manualAddLocations()
  const visibleLocations = cleaningType === 'deep'
    ? locations.filter(loc => loc.group === 'OTP')
    : locations.filter(loc => !loc.deepOnly)
  const isTomorrow = day === 'tomorrow'
  const dayDate = isTomorrow ? tokyoTomorrow() : tokyoToday()
  const dayJobs = (todayJobs || []).filter(j => j.scheduled_date === dayDate)
  // Tomorrow is planned by the office: an employee adds free places, never takes a coworker's job.
  const options = buildAddServiceOptions(visibleLocations, dayJobs, employeeId, cleaningType, { allowTransfer: !isTomorrow })
  const shiftCheck = isTomorrow ? validateShiftWindow(shiftStart, shiftEnd) : { ok: true }
  const q = search.trim().toLowerCase()
  const filtered = q
    ? options.filter(o => o.location.name.toLowerCase().includes(q) || (o.location.group || '').toLowerCase().includes(q))
    : options

  const badge = (opt) => {
    if (opt.state === 'mine') return { text: labels.addServiceMine, color: '#4ade80', bg: 'rgba(74,222,128,0.12)' }
    if (opt.state === 'done_today') {
      if (isJobFullyRegistered(opt.job)) return { text: labels.addServiceDoneToday, color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' }
      return { text: labels.addServiceDoneTodayRetro, color: '#e8c47a', bg: 'rgba(193,156,86,0.15)' }
    }
    if (opt.state === 'claim') return { text: labels.addServiceClaim, color: '#34d399', bg: 'rgba(52,211,153,0.12)' }
    if (opt.state === 'transfer') return { text: fill(labels.addServiceTransfer, { name: opt.fromEmployee }), color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' }
    if (opt.state === 'blocked') return { text: labels.addServiceBlocked, color: '#f87171', bg: 'rgba(248,113,113,0.12)' }
    return { text: labels.addServiceAvailable, color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' }
  }

  const toggleDeepComponent = (id) => {
    setDeepComponents(prev => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev
        return prev.filter(c => c !== id)
      }
      return [...prev, id]
    })
  }

  const switchCleaningType = (t) => {
    setCleaningType(t)
    setPicked(null)
    if (t === 'deep') setDeepComponents([...ALL_DEEP_COMPONENT_IDS])
  }

  const deepReady = cleaningType !== 'deep' || deepComponents.length > 0
  const doneNeedsRetro = picked?.state === 'done_today' && !isJobFullyRegistered(picked.job)
  const canConfirm = picked && deepReady && shiftCheck.ok && picked.state !== 'mine' && picked.state !== 'blocked' && (picked.state !== 'done_today' || (doneNeedsRetro && !isTomorrow))

  const confirmLabel = picked?.state === 'done_today' && doneNeedsRetro
    ? labels.addServiceDoneTodayRetro
    : picked?.state === 'transfer'
      ? fill(labels.addServiceTransferConfirm, { name: picked.fromEmployee })
      : picked?.state === 'claim'
        ? labels.addServiceClaimConfirm
        : labels.addServiceConfirm

  return (
    <div className="emp-sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'flex-end' }} onClick={() => !busy && onClose()}>
      <div className="emp-sheet" onClick={e => e.stopPropagation()} style={{ background: '#0a1525', borderRadius: '20px 20px 0 0', padding: '18px 16px 28px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ flex: 1, marginRight: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>+ {labels.addServiceTitle}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 6, lineHeight: 1.5 }}>{labels.addServiceHint}</div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: busy ? 'not-allowed' : 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {['today', 'tomorrow'].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => { setDay(d); setPicked(null) }}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                background: day === d ? '#c4b5fd' : 'rgba(255,255,255,0.05)',
                color: day === d ? '#2e1065' : 'rgba(255,255,255,0.45)',
              }}
            >
              {d === 'today' ? labels.dayToday : labels.tomorrow}
            </button>
          ))}
        </div>

        {isTomorrow && (
          <div style={{ marginBottom: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(167,139,250,0.08)', border: `1px solid ${shiftCheck.ok ? 'rgba(167,139,250,0.25)' : 'rgba(248,113,113,0.45)'}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 700 }}>
                {labels.shiftStartLabel}
                <input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 15, boxSizing: 'border-box' }} />
              </label>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 700 }}>
                {labels.shiftEndLabel}
                <input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 15, boxSizing: 'border-box' }} />
              </label>
            </div>
            <div style={{ fontSize: 11, marginTop: 8, lineHeight: 1.45, color: shiftCheck.ok ? 'rgba(255,255,255,0.45)' : '#f87171', fontWeight: shiftCheck.ok ? 500 : 700 }}>
              {shiftCheck.ok
                ? fill(labels.tomorrowShiftHint, { date: dayDate, time: SHIFT_END_LIMIT })
                : shiftCheck.error === 'shift_end_after_limit' ? fill(labels.shiftEndLimit, { time: SHIFT_END_LIMIT }) : labels.shiftTimeInvalid}
            </div>
          </div>
        )}

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={labels.addServiceSearch}
          style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
        />

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['basic', 'deep'].map(t => (
            <button
              key={t}
              type="button"
              onClick={() => switchCleaningType(t)}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                background: cleaningType === t ? (t === 'deep' ? 'rgba(251,191,36,0.2)' : 'rgba(96,165,250,0.2)') : 'rgba(255,255,255,0.05)',
                color: cleaningType === t ? (t === 'deep' ? '#fbbf24' : '#60a5fa') : 'rgba(255,255,255,0.45)',
              }}
            >
              {typeLabels[t]?.short || (t === 'basic' ? labels.basicCleaning : labels.deepCleaning)}
            </button>
          ))}
        </div>

        {cleaningType === 'deep' && (
          <div style={{ marginBottom: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', marginBottom: 8, letterSpacing: 0.3 }}>{labels.deepComponentsTitle}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {DEEP_CLEAN_COMPONENTS.map(comp => {
                const on = deepComponents.includes(comp.id)
                return (
                  <button
                    key={comp.id}
                    type="button"
                    onClick={() => toggleDeepComponent(comp.id)}
                    style={{
                      padding: '10px 12px', borderRadius: 10, border: on ? '1px solid rgba(251,191,36,0.5)' : '1px solid rgba(255,255,255,0.1)',
                      background: on ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)',
                      color: on ? '#fbbf24' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {on ? '✓ ' : ''}{deepComponentLabel(comp.id, lang)}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>{labels.deepComponentsHint}</div>
          </div>
        )}

        <div style={{ maxHeight: '45vh', overflowY: 'auto', marginBottom: 14 }}>
          {filtered.map(opt => {
            const b = badge(opt)
            const selected = picked?.location?.name === opt.location.name
            const disabled = opt.state === 'mine' || opt.state === 'blocked' || (opt.state === 'done_today' && isJobFullyRegistered(opt.job))
            return (
              <button
                key={opt.location.name}
                type="button"
                disabled={disabled}
                onClick={() => setPicked(opt)}
                style={{
                  width: '100%', textAlign: 'left', padding: '12px 14px', marginBottom: 8, borderRadius: 12,
                  border: selected ? '1px solid rgba(96,165,250,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  background: selected ? 'rgba(96,165,250,0.1)' : 'rgba(255,255,255,0.03)',
                  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{opt.location.name}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{opt.location.group}</div>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '4px 8px', borderRadius: 20, color: b.color, background: b.bg, whiteSpace: 'nowrap' }}>{b.text}</span>
                </div>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          disabled={!canConfirm || busy}
          onClick={() => picked && onAdd(picked.location, cleaningType, deepComponents, picked, isTomorrow ? { date: dayDate, start: shiftStart, end: shiftEnd } : null)}
          style={{
            width: '100%', padding: 16, borderRadius: 14, border: 'none', fontSize: 15, fontWeight: 800,
            background: canConfirm && !busy ? 'linear-gradient(135deg,#60a5fa,#3b82f6)' : 'rgba(255,255,255,0.08)',
            color: canConfirm && !busy ? '#fff' : 'rgba(255,255,255,0.3)',
            cursor: canConfirm && !busy ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? '...' : picked ? confirmLabel : labels.addServiceConfirm}
        </button>
      </div>
    </div>
  )
}

function PastServiceModal({ labels, lang, busy, prefill, onClose, onSubmit }) {
  const [search, setSearch] = useState('')
  const [date, setDate] = useState(prefill?.date || tokyoToday())
  const [cleaningType, setCleaningType] = useState(prefill?.cleaningType || 'basic')
  const [deepComponents, setDeepComponents] = useState(prefill?.deepComponents || [...ALL_DEEP_COMPONENT_IDS])
  const [picked, setPicked] = useState(prefill?.location ? { location: prefill.location } : null)

  const typeLabels = cleaningTypesForLang(lang)
  const locations = manualAddLocations()
  const visibleLocations = cleaningType === 'deep'
    ? locations.filter(loc => loc.group === 'OTP')
    : locations.filter(loc => !loc.deepOnly)
  const q = search.trim().toLowerCase()
  const filtered = q
    ? visibleLocations.filter(loc => loc.name.toLowerCase().includes(q) || (loc.group || '').toLowerCase().includes(q))
    : visibleLocations
  // Late registration only for today: once the day turns the job is incomplete.
  const dateOptions = [tokyoToday()]

  const toggleDeepComponent = (id) => {
    setDeepComponents(prev => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev
        return prev.filter(c => c !== id)
      }
      return [...prev, id]
    })
  }

  const switchCleaningType = (t) => {
    setCleaningType(t)
    setPicked(null)
    if (t === 'deep') setDeepComponents([...ALL_DEEP_COMPONENT_IDS])
  }

  const deepReady = cleaningType !== 'deep' || deepComponents.length > 0
  const canConfirm = picked && deepReady

  return (
    <div className="emp-sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 270, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'flex-end' }} onClick={() => !busy && onClose()}>
      <div className="emp-sheet" onClick={e => e.stopPropagation()} style={{ background: '#0a1525', borderRadius: '20px 20px 0 0', padding: '18px 16px 28px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ flex: 1, marginRight: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#e8c47a' }}>✓ {labels.pastServiceTitle}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 6, lineHeight: 1.5 }}>{labels.pastServiceHint}</div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: busy ? 'not-allowed' : 'pointer' }}>✕</button>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, letterSpacing: 0.3 }}>{labels.pastServiceDate}</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14, paddingBottom: 4 }}>
          {dateOptions.map(d => {
            const isToday = d === tokyoToday()
            const selected = d === date
            const label = isToday ? `${d.slice(5)}${labels.todaySuffix || ' (today)'}` : d.slice(5)
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDate(d)}
                style={{
                  flexShrink: 0, padding: '8px 12px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  background: selected ? 'rgba(193,156,86,0.25)' : 'rgba(255,255,255,0.05)',
                  color: selected ? '#e8c47a' : 'rgba(255,255,255,0.45)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={labels.addServiceSearch}
          style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
        />

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['basic', 'deep'].map(t => (
            <button
              key={t}
              type="button"
              onClick={() => switchCleaningType(t)}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                background: cleaningType === t ? (t === 'deep' ? 'rgba(251,191,36,0.2)' : 'rgba(96,165,250,0.2)') : 'rgba(255,255,255,0.05)',
                color: cleaningType === t ? (t === 'deep' ? '#fbbf24' : '#60a5fa') : 'rgba(255,255,255,0.45)',
              }}
            >
              {typeLabels[t]?.short || (t === 'basic' ? labels.basicCleaning : labels.deepCleaning)}
            </button>
          ))}
        </div>

        {cleaningType === 'deep' && (
          <div style={{ marginBottom: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', marginBottom: 8, letterSpacing: 0.3 }}>{labels.deepComponentsTitle}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {DEEP_CLEAN_COMPONENTS.map(comp => {
                const on = deepComponents.includes(comp.id)
                return (
                  <button
                    key={comp.id}
                    type="button"
                    onClick={() => toggleDeepComponent(comp.id)}
                    style={{
                      padding: '10px 12px', borderRadius: 10, border: on ? '1px solid rgba(251,191,36,0.5)' : '1px solid rgba(255,255,255,0.1)',
                      background: on ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)',
                      color: on ? '#fbbf24' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {on ? '✓ ' : ''}{deepComponentLabel(comp.id, lang)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ maxHeight: '38vh', overflowY: 'auto', marginBottom: 14 }}>
          {filtered.map(loc => {
            const selected = picked?.location?.name === loc.name
            return (
              <button
                key={loc.name}
                type="button"
                onClick={() => setPicked({ location: loc })}
                style={{
                  width: '100%', textAlign: 'left', padding: '12px 14px', marginBottom: 8, borderRadius: 12,
                  border: selected ? '1px solid rgba(193,156,86,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  background: selected ? 'rgba(193,156,86,0.12)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{loc.name}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{loc.group}</div>
              </button>
            )
          })}
        </div>

        {!picked && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: 10 }}>{labels.pastServicePickLocation || 'Tap a location above to continue'}</div>}
        <button
          type="button"
          disabled={!canConfirm || busy}
          onClick={() => picked && onSubmit({ location: picked.location, date, cleaningType, deepComponents })}
          style={{
            width: '100%', padding: 16, borderRadius: 14, border: 'none', fontSize: 15, fontWeight: 800,
            background: canConfirm && !busy ? 'linear-gradient(135deg,#c19c56,#e8c47a)' : 'rgba(255,255,255,0.08)',
            color: canConfirm && !busy ? '#0a1929' : 'rgba(255,255,255,0.3)',
            cursor: canConfirm && !busy ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? '...' : labels.pastServiceConfirm}
        </button>
      </div>
    </div>
  )
}
