import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchEvaluatedIds, scoreOf } from '../lib/employeeScore'
import { isTestEmployee } from '../lib/testData'
import toast from 'react-hot-toast'
import AvailabilityAdmin from '../components/AvailabilityAdmin'
import NfcClockAdmin from '../components/NfcClockAdmin'
import { RoleBadge, RolePicker } from '../components/EmployeeRole'
import { useLang, pickLang } from '../hooks/useLang'
import { askConfirm } from '../components/ConfirmDialog'
import { tokyoToday } from '../lib/dates'
import { maskEmail, phoneTakenMessage } from '../lib/contactMask'
import { newSetupToken, setupPassword, setupLink } from '../lib/passwordLink'
import { undoToast } from '../components/UndoToast'
import SetupLinkCard from '../components/SetupLinkCard'
import { speaksPt, hasPtColumn, saveSpeaksPt } from '../lib/employeeLang'

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
// saved values stay in EN (other screens read them); the screen shows the translation
const DAY_TEXT = { Sun:['Sun','日','Dom'], Mon:['Mon','月','Seg'], Tue:['Tue','火','Ter'], Wed:['Wed','水','Qua'], Thu:['Thu','木','Qui'], Fri:['Fri','金','Sex'], Sat:['Sat','土','Sáb'] }
const CONTRACT_TEXT = { 'Full-time':['Full-time','正社員','Tempo integral'], 'Part-time':['Part-time','パート','Meio período'], 'Fixed-term':['Fixed-term','有期契約','Prazo determinado'], Hourly:['Hourly','時給','Por hora'], Freelancer:['Freelancer','業務委託','Autônomo'] }

export default function Employees() {
  const navigate = useNavigate()
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const dayText = d => L(...(DAY_TEXT[d] || [d, d, d]))
  const contractText = c => c ? L(...(CONTRACT_TEXT[c] || [c, c, c])) : '—'
  const [newLink, setNewLink] = useState(null)
  const location = useLocation()
  const tabFromUrl = search => { const v = new URLSearchParams(search).get('tab'); return v === 'availability' || v === 'register' ? v : null }
  const [tab, setTab] = useState(() => tabFromUrl(window.location.search) || 'list')
  // Opened from the day-off pop-up ("Open calendar") or Users ("+ Add user") while already on this page
  useEffect(() => { const v = tabFromUrl(location.search); if (v) setTab(v) }, [location.search])
  // opened from the global search (?search=<employee id>): show only that person, active or not
  const searchId = new URLSearchParams(location.search).get('search')
  useEffect(() => { if (searchId) setTab('list') }, [searchId])
  const [employees, setEmployees] = useState([])
  const [evaluated, setEvaluated] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  // Same rule as Users: the count is active people; inactive ones only when asked.
  const [showInactive, setShowInactive] = useState(false)
  const [pendingAvail, setPendingAvail] = useState(0)
  const [workDays, setWorkDays] = useState([])
  const [form, setForm] = useState({
    full_name:'', email:'', phone:'', address:'', job_role:'',
    contract_type:'Full-time', contract_start:'', contract_end:'',
    salary_type:'fixed', hourly_rate:0, fixed_salary:0, job_bonus_rate:0,
    hours_per_shift:0, shifts_per_week:5,
    advance_per_week:0, attendance_bonus:0, transport_reimbursed:true,
    bank_name:'', bank_branch:'', account_type:'普通', account_number:'', account_holder_katakana:'',
    notes:'', speaks_pt:false
  })
  const [recEmpId, setRecEmpId] = useState('')
  const [recClient, setRecClient] = useState('')
  const [recType, setRecType] = useState(5)
  const [recDesc, setRecDesc] = useState('')

  const COMPLAINT_TYPES = [
    { label:'Incomplete service (-5 pts)', text:L('Incomplete service (-5 pts)','作業不備（-5点）','Serviço incompleto (-5 pts)'), value:5 },
    { label:'Misconduct (-10 pts)', text:L('Misconduct (-10 pts)','不正行為（-10点）','Má conduta (-10 pts)'), value:10 },
    { label:'Lateness (-3 pts)', text:L('Lateness (-3 pts)','遅刻（-3点）','Atraso (-3 pts)'), value:3 },
    { label:'Property damage (-8 pts)', text:L('Property damage (-8 pts)','物品破損（-8点）','Dano a patrimônio (-8 pts)'), value:8 },
    { label:'Other (-2 pts)', text:L('Other (-2 pts)','その他（-2点）','Outro (-2 pts)'), value:2 },
  ]

  useEffect(() => { loadEmployees() }, [])
  useEffect(() => {
    supabase.from('employee_availability').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      .then(({ count }) => setPendingAvail(count || 0))
  }, [])

  const loadEmployees = async () => {
    setLoading(true)
    const [{ data }, scored] = await Promise.all([supabase.from('employees').select('*').order('full_name'), fetchEvaluatedIds().catch(() => new Set())])
    setEmployees(data || [])
    setEvaluated(scored)
    setLoading(false)
  }

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleDay = (d) => setWorkDays(w => w.includes(d) ? w.filter(x=>x!==d) : [...w, d])

  const handleAdd = async () => {
    if (!form.full_name || !form.email) return toast.error(L('Name and e-mail are required','氏名とメールは必須です','Nome e e-mail são obrigatórios'))
    const taken = await phoneTakenMessage(supabase, form.phone, null, L)
    if (taken) return toast.error(taken)
    // v1.0.117 · the office does not type the password: the person sets it through a one-time link
    const token = newSetupToken()
    const email = form.email.trim().toLowerCase()
    const { data: created, error } = await supabase.from('employees').insert({
      full_name: form.full_name,
      email,
      password: setupPassword(token),
      phone: form.phone,
      address: form.address,
      job_role: form.job_role.trim() || null,
      contract_type: form.contract_type,
      contract_start: form.contract_start || null,
      contract_end: form.contract_end || null,
      salary_type: form.salary_type,
      hourly_rate: parseFloat(form.hourly_rate) || 0,
      fixed_salary: parseFloat(form.fixed_salary) || 0,
      job_bonus_rate: parseFloat(form.job_bonus_rate) || 0,
      hours_per_shift: parseFloat(form.hours_per_shift) || 0,
      shifts_per_week: parseInt(form.shifts_per_week) || 0,
      work_days: JSON.stringify(workDays),
      advance_per_week: parseFloat(form.advance_per_week) || 0,
      attendance_bonus: parseFloat(form.attendance_bonus) || 0,
      transport_reimbursed: form.transport_reimbursed,
      bank_name: form.bank_name,
      bank_branch: form.bank_branch,
      account_type: form.account_type,
      account_number: form.account_number,
      account_holder_katakana: form.account_holder_katakana,
      notes: form.notes,
      score: 100,
      is_active: true,
    }).select('id').maybeSingle()
    if (error) return toast.error(error.message)
    if (form.speaks_pt && created?.id) {
      const saved = await saveSpeaksPt(created.id, true)
      if (!saved.ok) toast.error(L('Portal language not saved yet: the database update (SQL) is still pending.','ポータルの言語はまだ保存できません（データベースの更新待ち）。','O idioma do portal ainda não foi salvo: falta aplicar a atualização do banco (SQL).'))
    }
    toast.success(L('Employee registered','スタッフを登録しました','Funcionário cadastrado'))
    setNewLink({ name: form.full_name, url: setupLink('employee', email, token) })
    setForm({ full_name:'', email:'', phone:'', address:'', job_role:'', contract_type:'Full-time', contract_start:'', contract_end:'', salary_type:'fixed', hourly_rate:0, fixed_salary:0, job_bonus_rate:0, hours_per_shift:0, shifts_per_week:5, advance_per_week:0, attendance_bonus:0, transport_reimbursed:true, bank_name:'', bank_branch:'', account_type:'普通', account_number:'', account_holder_katakana:'', notes:'', speaks_pt:false })
    setWorkDays([])
    loadEmployees()
    setTab('list')
  }

  // Portal language: Portuguese speakers always get PT (no switcher); the others choose EN / JA.
  const setPortalLang = async (emp, pt) => {
    if (speaksPt(emp) === pt) return
    const saved = await saveSpeaksPt(emp.id, pt)
    if (!saved.ok) {
      return toast.error(saved.missingColumn
        ? L('Not saved: the database update (SQL) for portal language is still pending.','保存できません：ポータル言語のデータベース更新（SQL）がまだです。','Não salvou: falta aplicar a atualização do banco (SQL) do idioma do portal.')
        : saved.error?.message || 'Error')
    }
    setEmployees(list => list.map(x => x.id === emp.id ? { ...x, speaks_portuguese: pt } : x))
    toast.success(pt
      ? L(`${emp.full_name}: portal always in Portuguese`,`${emp.full_name}：ポータルは常にポルトガル語`,`${emp.full_name}: portal sempre em português`)
      : L(`${emp.full_name}: portal in English / Japanese`,`${emp.full_name}：ポータルは英語／日本語`,`${emp.full_name}: portal em inglês / japonês`))
  }

  const handleDeactivate = async (id, current, name) => {
    if (current && !(await askConfirm({
      title: L(`Deactivate ${name}?`, `${name}を無効にしますか？`, `Desativar ${name}?`),
      message: L('They can no longer sign in and stop appearing in schedules and payroll. Jobs, payments and history are kept. You can activate again at any time.',
        'ログインできなくなり、シフトや給与の対象から外れます。作業・支払い・履歴は残ります。いつでも再度有効にできます。',
        'A pessoa não consegue mais entrar e sai da escala e da folha. Jobs, pagamentos e histórico continuam guardados. Dá para reativar quando quiser.'),
      confirmLabel: L('Deactivate','無効にする','Desativar'), danger: true,
    }))) return
    const { error } = await supabase.from('employees').update({ is_active: !current }).eq('id', id)
    if (error) return toast.error(error.message)
    loadEmployees()
    if (current) undoToast(L('Deactivated','無効にしました','Desativado'), () => supabase.from('employees').update({ is_active: true }).eq('id', id), lang, loadEmployees)
    else toast.success(L('Activated','有効にしました','Ativado'))
  }

  // v1.0.117 · replaces a typed/shared password with a one-time "set your password" link
  const sendPasswordLink = async (e) => {
    if (!e.email) return toast.error(L('This person has no e-mail','メールが登録されていません','Esta pessoa não tem e-mail'))
    const ok = await askConfirm({
      title: L(`New password link for ${e.full_name}?`, `${e.full_name}のパスワード設定リンクを作成しますか？`, `Link de senha para ${e.full_name}?`),
      message: L('Their current password stops working now. They sign in again only after opening the link and creating their own password.',
        '現在のパスワードはすぐに使えなくなります。リンクから自分のパスワードを作成すると、再びログインできます。',
        'A senha atual para de funcionar agora. A pessoa só entra de novo depois de abrir o link e criar a própria senha.'),
      confirmLabel: L('Create link','リンクを作成','Criar link'), danger: true,
    })
    if (!ok) return
    const token = newSetupToken()
    const { error } = await supabase.from('employees').update({ password: setupPassword(token) }).eq('id', e.id)
    if (error) return toast.error(error.message)
    setNewLink({ name: e.full_name, url: setupLink('employee', e.email, token) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (id, name) => {
    const ok = await askConfirm({
      title: L( `Delete ${name}?`, `${name}を削除しますか？`, `Excluir ${name}?`),
      message: L(
        'This also deletes all their jobs, payments, evaluations and history. It cannot be undone. To keep the history, use Deactivate instead.',
        '作業・支払い・評価・履歴もすべて削除され、元に戻せません。履歴を残す場合は「無効にする」を使ってください。',
        'Isso também apaga todos os jobs, pagamentos, avaliações e histórico. Não dá para desfazer. Para manter o histórico, use Desativar.'),
      confirmLabel: L( 'Delete forever', '完全に削除', 'Excluir de vez'), danger: true,
    })
    if (!ok) return
    try {
      await supabase.from('jobs').delete().eq('employee_id', id)
      await supabase.from('checkins').delete().eq('employee_id', id)
      await supabase.from('complaints').delete().eq('employee_id', id)
      await supabase.from('payroll').delete().eq('employee_id', id)
      await supabase.from('evaluations').delete().eq('employee_id', id)
      await supabase.from('salary_payments').delete().eq('employee_id', id)
      await supabase.from('salary_advances').delete().eq('employee_id', id)
      await supabase.from('transport_claims').delete().eq('employee_id', id)
      await supabase.from('equipment_requests').delete().eq('employee_id', id)
      await supabase.from('badges').delete().eq('employee_id', id)
      await supabase.from('messages').delete().eq('employee_id', id)

      const { error } = await supabase.from('employees').delete().eq('id', id)
      if (error) return toast.error(L('Error deleting: ','削除エラー: ','Erro ao excluir: ') + error.message)
      toast.success(L(`${name} deleted`, `${name}を削除しました`, `${name} excluído`))
      loadEmployees()
    } catch (err) {
      toast.error(L('Error deleting: ','削除エラー: ','Erro ao excluir: ') + err.message)
    }
  }

  const handleComplaint = async () => {
    if (!recEmpId) return toast.error(L('Select employee','スタッフを選択してください','Escolha o funcionário'))
    const emp = employees.find(e=>e.id===recEmpId)
    const before = emp.score ?? 100
    const newScore = Math.max(0,(emp.score||100)-recType)
    if (!(await askConfirm({
      title: L('Register complaint?','クレームを登録しますか？','Registrar reclamação?'),
      message: L(`${emp.full_name} loses ${recType} points (${before} → ${newScore}). The complaint stays in their history.`, `${emp.full_name}さんの点数が${recType}点下がります（${before} → ${newScore}）。クレームは履歴に残ります。`, `${emp.full_name} perde ${recType} pontos (${before} → ${newScore}). A reclamação fica no histórico.`),
      confirmLabel: L('Register','登録','Registrar'), danger: true,
    }))) return
    await supabase.from('employees').update({ score:newScore }).eq('id',recEmpId)
    const { data: saved } = await supabase.from('complaints').insert({ employee_id:recEmpId, employee_name:emp.full_name, client_name:recClient, complaint_type:COMPLAINT_TYPES.find(c=>c.value===recType)?.label, points_deducted:recType, description:recDesc, complaint_date:tokyoToday() }).select('id').maybeSingle()
    undoToast(`-${recType} pts · ${emp.full_name}`, async () => {
      if (saved?.id) await supabase.from('complaints').delete().eq('id', saved.id)
      return supabase.from('employees').update({ score: before }).eq('id', emp.id)
    }, lang, loadEmployees)
    setRecEmpId(''); setRecClient(''); setRecType(5); setRecDesc('')
    loadEmployees()
  }

  const scoreColor = s => s>=90?'var(--green)':s>=70?'#EF9F27':'var(--red)'

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>setTab('list')}>{L('Active','有効','Ativos')} ({loading?'…':employees.filter(e=>e.is_active!==false).length})</button>
        <button className={`tab-pill${tab==='register'?' active':''}`} onClick={()=>setTab('register')}>+ {L('Add Employee','スタッフ追加','Novo funcionário')}</button>
        <button className={`tab-pill${tab==='complaints'?' active':''}`} onClick={()=>setTab('complaints')}>{L('Complaints','クレーム','Reclamações')}</button>
        <button className={`tab-pill${tab==='availability'?' active':''}`} onClick={()=>setTab('availability')}>🗓 {L('Availability','勤務可能日','Disponibilidade')}{pendingAvail>0?` (${pendingAvail})`:''}</button>
        <button className={`tab-pill${tab==='nfc'?' active':''}`} onClick={()=>setTab('nfc')}>📶 {L('NFC clock','NFC打刻','Ponto NFC')}</button>
      </div>

      {newLink && <SetupLinkCard name={newLink.name} url={newLink.url} lang={lang} onClose={()=>setNewLink(null)} />}

      {tab==='list' && (
        <div>
          {loading && <div aria-busy="true" aria-label={L('Loading…','読み込み中…','Carregando…')}>{[0,1,2,3].map(i => <div key={i} className="kp-skel kp-skel-row" />)}</div>}
          {employees.some(e=>e.is_active===false) && (
            <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'var(--text2)',marginBottom:12,cursor:'pointer'}}>
              <input type="checkbox" checked={showInactive} onChange={ev=>setShowInactive(ev.target.checked)} />
              {L('Show inactive','無効も表示','Mostrar inativos')} ({employees.filter(e=>e.is_active===false).length})
            </label>
          )}
          {searchId && <button type="button" className="btn btn-sm" style={{marginBottom:12}} onClick={()=>navigate('/employees')}>← {L('Show everyone','全員を表示','Mostrar todos')}</button>}
          {employees.filter(e=>searchId ? e.id===searchId : showInactive||e.is_active!==false).map(e=>{
            const days = (() => { try { return e.work_days ? JSON.parse(e.work_days) : [] } catch { return [] } })()
            return (
            <div key={e.id} className="card" style={{marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
                <div className="avatar" style={{background:'#E6F1FB',color:'#185FA5',width:44,height:44,fontSize:15,fontWeight:700}}>
                  {e.full_name?.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:15,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>{e.full_name}{isTestEmployee(e) && <span className="badge">TESTE</span>}<RoleBadge value={e.job_role} lang={lang} /></div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{maskEmail(e.email)} · {contractText(e.contract_type)}</div>
                  {e.leader_id && <div style={{fontSize:12,color:'var(--text2)'}}>{L( 'Leader', 'リーダー', 'Líder')}: <b>{employees.find(x=>x.id===e.leader_id)?.full_name || '—'}</b></div>}
                </div>
                <span className={`badge ${e.is_active!==false?'badge-green':'badge-red'}`}>{e.is_active!==false?L('Active','有効','Ativo'):L('Inactive','無効','Inativo')}</span>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
                <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                  <div style={{fontSize:20,fontWeight:700,color:scoreOf(e,evaluated)==null?'var(--text3)':scoreColor(scoreOf(e,evaluated))}}>{scoreOf(e,evaluated) ?? '—'}</div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>{L('Score','スコア','Pontuação')}</div>
                </div>
                <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                  <div style={{fontSize:13,fontWeight:600}}>
                    {e.salary_type==='fixed'?L('Fixed','固定','Fixo'):e.salary_type==='hourly'?L('Hourly','時給','Por hora'):e.salary_type==='per_job'?L('Per Job','作業ごと','Por job'):L('Mixed','混合','Misto')}
                  </div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>{L('Pay type','給与形態','Tipo de pagamento')}</div>
                </div>
                <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                  <div style={{fontSize:13,fontWeight:600}}>
                    {e.salary_type==='fixed'?'¥'+Number(e.fixed_salary||0).toLocaleString():e.salary_type==='hourly'?'¥'+e.hourly_rate+'/h':e.salary_type==='per_job'?e.job_bonus_rate+'%':L('Mixed','混合','Misto')}
                  </div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>{L('Rate','単価','Valor')}</div>
                </div>
                <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                  <div style={{fontSize:13,fontWeight:600}}>{e.shifts_per_week||0}x</div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>{L('Shifts/week','週のシフト','Turnos/semana')}</div>
                </div>
              </div>

              {days.length>0 && (
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:10}}>
                  {DAYS.map(d=>(
                    <span key={d} style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:days.includes(d)?'var(--navy)':'var(--surface2)',color:days.includes(d)?'#fff':'var(--text3)'}}>{dayText(d)}</span>
                  ))}
                </div>
              )}

              <div className="emp-portal-lang" role="group" aria-label={L('Portal language','ポータルの言語','Idioma do portal')}>
                <span>{L('Portal language','ポータルの言語','Idioma do portal')}</span>
                <button type="button" className={speaksPt(e)?'on':''} aria-pressed={speaksPt(e)} onClick={()=>setPortalLang(e,true)}>🇧🇷 {L('Portuguese','ポルトガル語','Português')}</button>
                <button type="button" className={!speaksPt(e)?'on':''} aria-pressed={!speaksPt(e)} onClick={()=>setPortalLang(e,false)}>EN / 日本語</button>
                {!hasPtColumn(e) && <small>{L('provisional — SQL pending','仮設定 — SQL未適用','provisório — falta o SQL')}</small>}
              </div>

              {e.contract_start && <div style={{fontSize:11,color:'var(--text3)',marginBottom:8}}>{L('Contract','契約','Contrato')}: {e.contract_start} → {e.contract_end||L('open','期限なし','sem fim')}</div>}

              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button className="btn btn-sm btn-primary" onClick={()=>navigate('/employees/'+e.id)}>👤 {L('Profile','プロフィール','Perfil')}</button>
                <button className="btn btn-sm" onClick={()=>handleDeactivate(e.id,e.is_active!==false,e.full_name)}>{e.is_active!==false?L('Deactivate','無効にする','Desativar'):L('Activate','有効にする','Ativar')}</button>
                <button className="btn btn-sm" onClick={()=>sendPasswordLink(e)}>🔑 {L('Password link','パスワード設定リンク','Link de senha')}</button>
                <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(e.id,e.full_name)} style={{background:'#DC2626',color:'#fff'}}>🗑️ {L('Delete','削除','Excluir')}</button>
              </div>
            </div>
          )})}
        </div>
      )}

      {tab==='register' && (
        <div className="card">
          <div className="card-title">{L('New Employee','スタッフ新規登録','Novo funcionário')}</div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:10}}>{L('Personal Info','個人情報','Dados pessoais')}</div>
          <div className="grid-2">
            <div className="form-group"><label>{L('Full Name','氏名','Nome completo')} *</label><input value={form.full_name} onChange={e=>upd('full_name',e.target.value)} placeholder="Yamamoto Hanako" /></div>
            <div className="form-group"><label>{L('E-mail (login)','メール（ログイン）','E-mail (login)')} *</label><input type="email" value={form.email} onChange={e=>upd('email',e.target.value)} placeholder="hanako@email.com" /></div>
            <div className="form-group"><label>{L('Phone','電話','Telefone')}</label><input value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="090-1234-5678" /></div>
            <div style={{gridColumn:'1/-1',fontSize:12,color:'var(--text3)',marginTop:-4,marginBottom:8}}>🔑 {L('No password here: after saving you get a link for the person to create their own password.','ここではパスワードを入力しません。保存後、本人がパスワードを作成するリンクが表示されます。','Sem senha aqui: depois de salvar aparece um link para a pessoa criar a própria senha.')}</div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>{L('Address','住所','Endereço')}</label><input value={form.address} onChange={e=>upd('address',e.target.value)} /></div>
          </div>

          <div className="form-group">
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <input type="checkbox" checked={form.speaks_pt} onChange={e=>upd('speaks_pt',e.target.checked)} style={{width:16,height:16}} />
              🇧🇷 {L('Speaks Portuguese — portal always in Portuguese (otherwise English / Japanese)','ポルトガル語を話す — ポータルは常にポルトガル語（それ以外は英語／日本語）','Fala português — portal sempre em português (senão inglês / japonês)')}
            </label>
          </div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>{L('Role','役割','Função')}</div>
          <RolePicker value={form.job_role} onChange={v=>upd('job_role',v)} lang={lang} />

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>{L('Contract','契約','Contrato')}</div>
          <div className="grid-2">
            <div className="form-group"><label>{L('Contract Type','契約形態','Tipo de contrato')}</label>
              <select value={form.contract_type} onChange={e=>upd('contract_type',e.target.value)}>
                {Object.keys(CONTRACT_TEXT).map(c=><option key={c} value={c}>{contractText(c)}</option>)}
              </select>
            </div>
            <div className="form-group"><label>{L('Shifts per Week','週のシフト数','Turnos por semana')}</label><input type="number" value={form.shifts_per_week} onChange={e=>upd('shifts_per_week',e.target.value)} /></div>
            <div className="form-group"><label>{L('Contract Start','契約開始','Início do contrato')}</label><input type="date" value={form.contract_start} onChange={e=>upd('contract_start',e.target.value)} /></div>
            <div className="form-group"><label>{L('Contract End','契約終了','Fim do contrato')}</label><input type="date" value={form.contract_end} onChange={e=>upd('contract_end',e.target.value)} /></div>
            <div className="form-group"><label>{L('Hours per Shift','1シフトの時間','Horas por turno')}</label><input type="number" value={form.hours_per_shift} onChange={e=>upd('hours_per_shift',e.target.value)} placeholder="9" /></div>
          </div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>{L('Work Days','勤務日','Dias de trabalho')}</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
            {DAYS.map(d=>(
              <button key={d} onClick={()=>toggleDay(d)} type="button" style={{padding:'7px 16px',borderRadius:20,border:'1.5px solid',borderColor:workDays.includes(d)?'var(--navy)':'var(--border)',background:workDays.includes(d)?'var(--navy)':'none',color:workDays.includes(d)?'#fff':'var(--text2)',fontSize:13,fontWeight:500,cursor:'pointer'}}>
                {dayText(d)}
              </button>
            ))}
          </div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>{L('Payment Type','支払い形態','Forma de pagamento')}</div>
          <div className="form-group">
            <label>{L('Salary Type','給与形態','Tipo de salário')}</label>
            <select value={form.salary_type} onChange={e=>upd('salary_type',e.target.value)}>
              <option value="fixed">{L('Fixed — monthly salary (¥/month)','固定 — 月給（¥/月）','Fixo — salário mensal (¥/mês)')}</option>
              <option value="hourly">{L('Hourly — paid per hour worked (¥/h)','時給 — 働いた時間分（¥/時）','Por hora — paga pelas horas trabalhadas (¥/h)')}</option>
              <option value="per_job">{L('Per Job — paid per service completed','作業ごと — 完了した作業ごとに支払い','Por job — paga por serviço concluído')}</option>
              <option value="mixed">{L('Mixed — fixed base + job bonus (%)','混合 — 固定給＋作業ボーナス（%）','Misto — base fixa + bônus por job (%)')}</option>
            </select>
          </div>
          {form.salary_type==='fixed' && <div className="form-group"><label>{L('Monthly Salary (¥)','月給（¥）','Salário mensal (¥)')}</label><input type="number" value={form.fixed_salary} onChange={e=>upd('fixed_salary',e.target.value)} /></div>}
          {form.salary_type==='hourly' && <div className="form-group"><label>{L('Hourly Rate (¥/h)','時給（¥/時）','Valor por hora (¥/h)')}</label><input type="number" value={form.hourly_rate} onChange={e=>upd('hourly_rate',e.target.value)} /></div>}
          {form.salary_type==='per_job' && <div className="form-group"><label>{L('Bonus Rate (% of job value)','ボーナス率（作業金額の%）','Bônus (% do valor do job)')}</label><input type="number" value={form.job_bonus_rate} onChange={e=>upd('job_bonus_rate',e.target.value)} /></div>}
          {form.salary_type==='mixed' && <div className="grid-2">
            <div className="form-group"><label>{L('Fixed Base (¥/mo)','固定給（¥/月）','Base fixa (¥/mês)')}</label><input type="number" value={form.fixed_salary} onChange={e=>upd('fixed_salary',e.target.value)} /></div>
            <div className="form-group"><label>{L('Job Bonus (%)','作業ボーナス（%）','Bônus por job (%)')}</label><input type="number" value={form.job_bonus_rate} onChange={e=>upd('job_bonus_rate',e.target.value)} /></div>
          </div>}

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>{L('Extras','その他手当','Extras')}</div>
          <div className="grid-2">
            <div className="form-group"><label>{L('Weekly Advance (¥)','週払い前払い（¥）','Adiantamento semanal (¥)')}</label><input type="number" value={form.advance_per_week} onChange={e=>upd('advance_per_week',e.target.value)} /></div>
            <div className="form-group"><label>{L('Completion Bonus (¥)','皆勤手当（¥）','Bônus de assiduidade (¥)')}</label><input type="number" value={form.attendance_bonus} onChange={e=>upd('attendance_bonus',e.target.value)} /></div>
          </div>
          <div className="form-group">
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <input type="checkbox" checked={form.transport_reimbursed} onChange={e=>upd('transport_reimbursed',e.target.checked)} style={{width:16,height:16}} />
              {L('Transport reimbursed','交通費支給','Transporte reembolsado')}
            </label>
          </div>
          <div className="form-group"><label>{L('Notes / Contract details','メモ・契約の詳細','Observações / detalhes do contrato')}</label><textarea value={form.notes} onChange={e=>upd('notes',e.target.value)} placeholder={L('Additional contract info…','契約の補足…','Informações extras do contrato…')} /></div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>{L('Bank Details','振込先','Dados bancários')}</div>
          <div className="grid-2">
            <div className="form-group"><label>{L('Bank Name','銀行名','Banco')}</label><input value={form.bank_name} onChange={e=>upd('bank_name',e.target.value)} placeholder="Japan Post / Mizuho..." /></div>
            <div className="form-group"><label>{L('Branch (支店)','支店','Agência (支店)')}</label><input value={form.bank_branch} onChange={e=>upd('bank_branch',e.target.value)} /></div>
            <div className="form-group"><label>{L('Account Type','口座種別','Tipo de conta')}</label>
              <select value={form.account_type} onChange={e=>upd('account_type',e.target.value)}>
                <option value="普通">普通（普通預金）</option><option value="当座">当座（当座預金）</option>
              </select>
            </div>
            <div className="form-group"><label>{L('Account Number','口座番号','Número da conta')}</label><input value={form.account_number} onChange={e=>upd('account_number',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>{L('Account Holder (katakana)','口座名義（カタカナ）','Titular da conta (katakana)')}</label><input value={form.account_holder_katakana} onChange={e=>upd('account_holder_katakana',e.target.value)} placeholder="ヤマモト ハナコ" /></div>
          </div>

          <button className="btn btn-primary" style={{marginTop:8}} onClick={handleAdd}>✅ {L('Register Employee','スタッフを登録','Cadastrar funcionário')}</button>
        </div>
      )}

      {tab==='nfc' && <NfcClockAdmin employees={employees} />}

      {tab==='availability' && <AvailabilityAdmin employees={employees} onPendingCount={setPendingAvail} />}

      {tab==='complaints' && (
        <div className="card">
          <div className="card-title">{L('Register Complaint','クレーム登録','Registrar reclamação')}</div>
          <div className="grid-2">
            <div className="form-group"><label>{L('Employee','スタッフ','Funcionário')}</label>
              <select value={recEmpId} onChange={e=>setRecEmpId(e.target.value)}>
                <option value="">{L('Select…','選択…','Escolha…')}</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>{L('Client','顧客','Cliente')}</label><input value={recClient} onChange={e=>setRecClient(e.target.value)} /></div>
            <div className="form-group"><label>{L('Type','種類','Tipo')}</label>
              <select value={recType} onChange={e=>setRecType(parseInt(e.target.value))}>
                {COMPLAINT_TYPES.map(c=><option key={c.value} value={c.value}>{c.text}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label>{L('Description','内容','Descrição')}</label><textarea value={recDesc} onChange={e=>setRecDesc(e.target.value)} /></div>
          <button className="btn btn-danger" onClick={handleComplaint}>{L('Register Complaint','クレームを登録','Registrar reclamação')}</button>
        </div>
      )}
    </div>
  )
}
