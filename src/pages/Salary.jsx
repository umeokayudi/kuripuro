import { useState, useEffect } from 'react'
import SkeletonRows from '../components/SkeletonRows'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useLang, pickLang } from '../hooks/useLang'
import EarningsPanel from '../components/EarningsPanel'
import { tokyoToday } from '../lib/dates'
import { payrollMonth, monthLastDay } from '../lib/salaryCalc'
import { isPayrollActive } from '../lib/salaryClose'

export default function Salary() {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [employees, setEmployees] = useState([])
  const [selected, setSelected] = useState(null)
  const [period, setPeriod] = useState(tokyoToday().slice(0, 7))
  const [jobs, setJobs] = useState([])
  const [advances, setAdvances] = useState([])
  const [lines, setLines] = useState([])
  const [newAdv, setNewAdv] = useState({ amount:'', desc:'' })
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadEmployees() }, [])
  useEffect(() => { if (selected) { loadJobs(); loadAdvances() } }, [selected, period])

  const loadEmployees = async () => {
    const { data } = await supabase.from('employees').select('*').order('full_name')
    setEmployees((data || []).filter(isPayrollActive))
    setLoading(false)
  }

  const loadJobs = async () => {
    const { data } = await supabase.from('jobs').select('*')
      .eq('employee_id', selected.id)
      .eq('status', 'completed')
      .gte('scheduled_date', period + '-01')
      .lte('scheduled_date', monthLastDay(period))
    setJobs(data || [])
  }

  const loadAdvances = async () => {
    const { data } = await supabase.from('salary_payments').select('*')
      .eq('employee_id', selected.id)
      .eq('period', period)
      .order('created_at')
    setLines(data || [])
    setAdvances((data || []).filter(p => p.payment_type === 'advance'))
  }

  const addAdvance = async () => {
    if (!newAdv.amount) return toast.error(L('Enter amount', '金額を入力してください', 'Informe o valor'))
    const { error } = await supabase.from('salary_payments').insert({
      employee_id: selected.id,
      employee_name: selected.full_name,
      period,
      amount: parseFloat(newAdv.amount),
      description: newAdv.desc || L('Advance payment', '前払い', 'Adiantamento'),
      payment_type: 'advance',
      status: 'scheduled',
      })
    if (error) return toast.error(error.message)
    toast.success(L('Advance registered', '前払いを登録しました', 'Adiantamento registrado'))
    setNewAdv({ amount:'', desc:'' })
    loadAdvances()
  }

  // v1.0.108 · same calculation as Fechar folha / Payments / employee app (payrollMonth).
  const calcSalary = () => {
    if (!selected) return {}
    const one = payrollMonth({ emp: selected, jobs, lines, month: period })
    const totalAdvances = advances.filter(a => a.status !== 'cancelled').reduce((s, a) => s + Number(a.amount || 0), 0)
    return { ...one, totalAdvances }
  }

  const salary = calcSalary()

  const months = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i)
    months.push(d.toISOString().slice(0,7))
  }

  return (
    <div>
      <div className="grid-2" style={{ gap:14 }}>
        {/* Employee list */}
        <div>
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-title">{L('Select Employee', 'スタッフを選択', 'Escolha o funcionário')}</div>
            <div className="form-group">
              <label>{L('Period', '期間', 'Período')}</label>
              <select value={period} onChange={e=>setPeriod(e.target.value)}>
                {months.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            {loading && <SkeletonRows rows={4} label={L('Loading…', '読み込み中…', 'Carregando…')} />}
            {employees.map(e => (
              <div key={e.id} onClick={()=>setSelected(e)} style={{ padding:'10px 12px', borderRadius:8, cursor:'pointer', background: selected?.id===e.id ? 'var(--navy)' : 'var(--surface2)', marginBottom:6, border: selected?.id===e.id ? '1px solid var(--navy)' : '1px solid transparent' }}>
                <div style={{ fontWeight:500, fontSize:13, color: selected?.id===e.id ? '#fff' : 'var(--text)' }}>{e.full_name}</div>
                <div style={{ fontSize:11, color: selected?.id===e.id ? 'rgba(255,255,255,0.6)' : 'var(--text3)' }}>
                  {e.salary_type === 'fixed' ? `${L('Fixed', '固定', 'Fixo')} ¥${Number(e.fixed_salary||0).toLocaleString()}/${L('mo', '月', 'mês')}` : e.salary_type === 'hourly' ? `¥${e.hourly_rate}/h` : L('Mixed', '混合', 'Misto')}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Salary detail */}
        <div>
          {!selected && <div className="card"><div style={{color:'var(--text3)',fontSize:13}}>{L('Select an employee to view salary', 'スタッフを選ぶと給与が表示されます', 'Escolha um funcionário para ver o salário')}</div></div>}

          {selected && <>
            <EarningsPanel key={selected.id} employeeId={selected.id} employee={selected} lang={lang} theme="admin" />
            <div className="card" style={{ marginBottom:14 }}>
              <div className="card-title">📋 {L('Contract', '契約', 'Contrato')} — {selected.full_name}</div>
              <div className="grid-2" style={{ gap:8 }}>
                {[
                  [L('Contract Type', '契約形態', 'Tipo de contrato'), selected.contract_type],
                  [L('Salary Type', '給与形態', 'Tipo de salário'), selected.salary_type],
                  [L('Base Salary', '基本給', 'Salário base'), selected.salary_type==='fixed' ? `¥${Number(selected.fixed_salary||0).toLocaleString()}/${L('mo', '月', 'mês')}` : `¥${selected.hourly_rate}/h`],
                  [L('Start Date', '開始日', 'Início'), selected.contract_start || '—'],
                  [L('End Date', '終了日', 'Fim'), selected.contract_end || '—'],
                  [L('Attendance Bonus', '皆勤手当', 'Bônus de assiduidade'), selected.attendance_bonus ? `¥${Number(selected.attendance_bonus).toLocaleString()}` : '—'],
                  [L('Weekly Advance', '週払い前払い', 'Adiantamento semanal'), selected.advance_per_week ? `¥${Number(selected.advance_per_week).toLocaleString()}` : '—'],
                  [L('Transport', '交通費', 'Transporte'), selected.transport_reimbursed ? L('Reimbursed', '支給', 'Reembolsado') : L('Not reimbursed', '支給なし', 'Não reembolsado')],
                ].map(([l,v]) => (
                  <div key={l} style={{ background:'var(--surface2)', borderRadius:8, padding:'8px 10px' }}>
                    <div style={{ fontSize:10, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.5px' }}>{l}</div>
                    <div style={{ fontSize:13, fontWeight:500, marginTop:2 }}>{v || '—'}</div>
                  </div>
                ))}
              </div>
              {selected.notes && <div style={{ marginTop:10, background:'var(--surface2)', borderRadius:8, padding:'10px 12px', fontSize:12, color:'var(--text2)' }}>{selected.notes}</div>}
            </div>

            <div className="card" style={{ marginBottom:14 }}>
              <div className="card-title">💴 {L('Salary Calculation', '給与計算', 'Cálculo do salário')} — {period}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  [L('Base salary', '基本給', 'Salário base'), `¥${salary.base?.toLocaleString()}`],
                  [L(`Jobs (${salary.jobs ?? jobs.length} completed · spot extras)`, `作業（完了${salary.jobs ?? jobs.length}件・スポット追加分）`, `Jobs (${salary.jobs ?? jobs.length} concluídos · extras spot)`), `+¥${salary.jobsPay?.toLocaleString()}`],
                  [L('Deductions', '控除', 'Descontos'), `-¥${salary.deductions?.toLocaleString()}`],
                ].map(([l,v]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                    <span style={{ color:'var(--text2)' }}>{l}</span>
                    <span style={{ fontWeight:500 }}>{v}</span>
                  </div>
                ))}
                <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', fontSize:16, fontWeight:700 }}>
                  <span>{L('NET TOTAL', '差引支給額', 'LÍQUIDO')}</span>
                  <span style={{ color:'var(--green)' }}>¥{salary.net?.toLocaleString()}</span>
                </div>
                {salary.totalAdvances > 0 && <div style={{ fontSize:12, color:'var(--text3)' }}>{L(`Advances this month: ¥${salary.totalAdvances.toLocaleString()} (paid separately; to take one out of the salary, add a deduction)`, `今月の前払い：¥${salary.totalAdvances.toLocaleString()}（別払い。給与から引く場合は控除を追加してください）`, `Adiantamentos do mês: ¥${salary.totalAdvances.toLocaleString()} (pagos à parte; para tirar do salário, adicione um desconto)`)}</div>}
              </div>
            </div>

            <div className="card" style={{ marginBottom:14 }}>
              <div className="card-title">⬇️ {L('Jobs this period', '今期の作業', 'Jobs do período')}</div>
              {jobs.length === 0 && <div style={{color:'var(--text3)',fontSize:13}}>{L('No completed jobs', '完了した作業はありません', 'Nenhum job concluído')}</div>}
              {jobs.map(j => (
                <div key={j.id} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                  <div>
                    <div style={{ fontWeight:500 }}>{j.title}</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>{j.scheduled_date}</div>
                  </div>
                  <span style={{ color:'var(--green)', fontWeight:500 }}>¥{Number(j.value||0).toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-title">💸 {L('Advances', '前払い', 'Adiantamentos')} — {period}</div>
              {advances.map(a => (
                <div key={a.id} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                  <div>
                    <div style={{ fontWeight:500 }}>{a.description}</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>{a.created_at?.slice(0,10)}</div>
                  </div>
                  <span style={{ color:'var(--red)', fontWeight:500 }}>-¥{Number(a.amount).toLocaleString()}</span>
                </div>
              ))}
              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <input type="number" value={newAdv.amount} onChange={e=>setNewAdv(a=>({...a,amount:e.target.value}))} placeholder={L('Amount ¥', '金額 ¥', 'Valor ¥')} style={{ width:120 }} className="form-group" />
                <input value={newAdv.desc} onChange={e=>setNewAdv(a=>({...a,desc:e.target.value}))} placeholder={L('Description', '内容', 'Descrição')} style={{ flex:1 }} />
                <button className="btn btn-primary" onClick={addAdvance}>+ {L('Add', '追加', 'Adicionar')}</button>
              </div>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
