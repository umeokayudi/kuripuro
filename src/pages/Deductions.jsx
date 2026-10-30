import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { askConfirm } from '../components/ConfirmDialog'
import { isDeductionToReview, reviewText, approvePatch, rejectPatch } from '../lib/deductionReview'
import { tokyoToday } from '../lib/dates'
import { useLang, pickLang } from '../hooks/useLang'
import { undoToast } from '../components/UndoToast'

export default function Deductions() {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [employees, setEmployees] = useState([])
  const [history, setHistory] = useState([])
  const [form, setForm] = useState({ employee_id:'', amount:'', description:'', payment_date: tokyoToday(), deduction_type:'damage' })

  const TYPES = [
    // `label` is what gets saved in the description (kept in EN); `text` is what the screen shows.
    { key:'damage', label:'Property Damage', text:L('Property Damage','物品破損','Dano a patrimônio') },
    { key:'absence', label:'Unjustified Absence', text:L('Unjustified Absence','無断欠勤','Falta sem justificativa') },
    { key:'lateness', label:'Repeated Lateness', text:L('Repeated Lateness','遅刻の繰り返し','Atrasos repetidos') },
    { key:'equipment', label:'Equipment Loss', text:L('Equipment Loss','備品紛失','Perda de equipamento') },
    { key:'advance', label:'Advance Deduction', text:L('Advance Deduction','前払いの控除','Desconto de adiantamento') },
    { key:'other', label:'Other', text:L('Other','その他','Outro') },
  ]

  useEffect(() => { load() }, [])

  const load = async () => {
    const [e, h] = await Promise.all([
      supabase.from('employees').select('id,full_name').eq('is_active',true).order('full_name'),
      supabase.from('salary_payments').select('*').eq('is_deduction',true).order('created_at',{ascending:false}).limit(60),
    ])
    setEmployees(e.data||[])
    setHistory(h.data||[])
  }

  const handleAdd = async () => {
    if (!form.employee_id||!form.amount||!form.description) return toast.error(L('Fill all fields','すべての項目を入力してください','Preencha todos os campos'))
    const emp = employees.find(e=>e.id===form.employee_id)
    const { error } = await supabase.from('salary_payments').insert({
      employee_id: form.employee_id,
      employee_name: emp?.full_name,
      period: form.payment_date.slice(0,7),
      amount: parseFloat(form.amount),
      payment_date: form.payment_date,
      description: `[${TYPES.find(t=>t.key===form.deduction_type)?.label}] ${form.description}`,
      status: 'scheduled',
      payment_type: 'deduction',
      is_deduction: true,
    })
    if (error) return toast.error(error.message)
    const { data: empScore } = await supabase.from('employees').select('score').eq('id', form.employee_id).maybeSingle()
    if (empScore) {
      const newScore = Math.max(0, (empScore.score || 100) - 5)
      await supabase.from('employees').update({ score: newScore }).eq('id', form.employee_id)
    }
    toast.success(L('Deduction added','控除を追加しました','Desconto adicionado'))
    setForm({ employee_id:'', amount:'', description:'', payment_date:tokyoToday(), deduction_type:'damage' })
    load()
  }

  // v1.0.117 · remove = cancel (the row stays in History) so it can be undone.
  const handleDelete = async (d) => {
    const ok = await askConfirm({
      title: L('Remove this deduction?','この控除を取り消しますか？','Remover este desconto?'),
      message: L(`${d.employee_name} · -¥${Number(d.amount).toLocaleString()}\nIt stops counting in this month's pay (${d.period || d.payment_date?.slice(0,7)}). It stays in the history as cancelled.`,
        `${d.employee_name} · -¥${Number(d.amount).toLocaleString()}\n${d.period || d.payment_date?.slice(0,7)} の給与から引かれなくなります。履歴には「取消」として残ります。`,
        `${d.employee_name} · -¥${Number(d.amount).toLocaleString()}\nDeixa de ser descontado no salário do mês (${d.period || d.payment_date?.slice(0,7)}). Fica no histórico como cancelado.`),
      confirmLabel: L('Remove','取り消す','Remover'), danger: true,
    })
    if (!ok) return
    const before = d.status
    const { error } = await supabase.from('salary_payments').update({ status: 'cancelled' }).eq('id', d.id)
    if (error) return toast.error(error.message)
    load()
    undoToast(L('Deduction removed','控除を取り消しました','Desconto removido'), () => supabase.from('salary_payments').update({ status: before }).eq('id', d.id), lang, load)
  }

  // Automatic suggestions: a person decides before anything reaches the payslip.
  const review = async (d, approve) => {
    let amount = null
    if (approve) {
      const typed = await askConfirm({ title: L('Approve deduction','控除を承認','Aprovar desconto'), message: `${d.employee_name}\n${reviewText(d)}`, reasonRequired: true, defaultReason: String(Number(d.amount)), reason: L('Amount (¥) to deduct','控除額（¥）','Valor (¥) a descontar'), confirmLabel: L('Approve (¥)','承認（¥）','Aprovar (¥)') })
      if (!typed) return
      amount = Math.max(0, Math.round(Number(String(typed).replace(/[^\d.]/g, '')) || 0))
      if (!amount) return toast.error(L('Enter the amount in yen','金額（円）を入力してください','Informe o valor em ienes'))
    } else if (!(await askConfirm({ title: L('Reject this suggestion?','この提案を却下しますか？','Rejeitar esta sugestão?'), message: `${reviewText(d)}\n${L('Nothing is deducted from pay.','給与からは引かれません。','Nada é descontado do salário.')}`, confirmLabel: L('Reject','却下','Rejeitar'), danger: true }))) return
    const { error } = await supabase.from('salary_payments').update(approve ? approvePatch(d, amount) : rejectPatch(d)).eq('id', d.id)
    if (error) return toast.error(error.message)
    toast.success(approve ? L('Deduction approved','控除を承認しました','Desconto aprovado') : L('Suggestion rejected','提案を却下しました','Sugestão rejeitada'))
    load()
  }
  const toReview = history.filter(isDeductionToReview)

  return (
    <div>
      <div className="card" style={{marginBottom:16}}>
        <div className="card-title">➖ {L('New Deduction','控除の新規登録','Novo desconto')}</div>
        <div className="grid-2">
          <div className="form-group">
            <label>{L('Employee','スタッフ','Funcionário')} *</label>
            <select value={form.employee_id} onChange={e=>setForm(f=>({...f,employee_id:e.target.value}))}>
              <option value="">{L('Select employee…','スタッフを選択…','Escolha o funcionário…')}</option>
              {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>{L('Type','種類','Tipo')} *</label>
            <select value={form.deduction_type} onChange={e=>setForm(f=>({...f,deduction_type:e.target.value}))}>
              {TYPES.map(t=><option key={t.key} value={t.key}>{t.text}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>{L('Amount (¥)','金額（¥）','Valor (¥)')} *</label>
            <input type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder={L('e.g. 5000','例: 5000','ex.: 5000')} />
          </div>
          <div className="form-group">
            <label>{L('Date','日付','Data')}</label>
            <input type="date" value={form.payment_date} onChange={e=>setForm(f=>({...f,payment_date:e.target.value}))} />
          </div>
          <div className="form-group" style={{gridColumn:'1/-1'}}>
            <label>{L('Description','内容','Descrição')} *</label>
            <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder={L('Reason for deduction…','控除の理由…','Motivo do desconto…')} />
          </div>
        </div>
        <button className="btn btn-danger" onClick={handleAdd}>➖ {L('Apply Deduction','控除を適用','Aplicar desconto')}</button>
      </div>

      {toReview.length>0&&(
        <div className="card" style={{marginBottom:16,border:'1px solid #f59e0b'}}>
          <div className="card-title">🤖 {L('Automatic suggestions to review','確認待ちの自動提案','Sugestões automáticas para revisar')} ({toReview.length})</div>
          <div style={{fontSize:12,color:'var(--text3)',marginBottom:8}}>{L('From checklists not finished. They do not count in pay until approved.','未完了のチェックリストから作成。承認するまで給与には反映されません。','Vêm de checklists não terminados. Só entram no salário depois de aprovados.')}</div>
          {toReview.map(d=>(
            <div key={d.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'10px 0',borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:500,fontSize:13}}>{d.employee_name} · {L('suggested','提案','sugerido')} -¥{Number(d.amount).toLocaleString()}</div>
                <div style={{fontSize:11,color:'var(--text3)'}}>{d.payment_date} · {reviewText(d)}</div>
              </div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn btn-sm" onClick={()=>review(d,false)}>✕ {L('Reject','却下','Rejeitar')}</button>
                <button className="btn btn-sm btn-primary" onClick={()=>review(d,true)}>✓ {L('Approve','承認','Aprovar')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">{L('History','履歴','Histórico')}</div>
        {history.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>{L('No deductions yet. Deductions added above appear here.','控除はまだありません。上で追加するとここに表示されます。','Nenhum desconto ainda. Os descontos aplicados acima aparecem aqui.')}</div>}
        {history.filter(d=>!isDeductionToReview(d)).map(d=>(
          <div key={d.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
            <div>
              <div style={{fontWeight:500,fontSize:13}}>{d.employee_name}</div>
              <div style={{fontSize:12,color:'var(--red)',fontWeight:600}}>-¥{Number(d.amount).toLocaleString()}</div>
              <div style={{fontSize:11,color:'var(--text3)'}}>{d.payment_date} · {d.description}</div>
            </div>
            {d.status==='cancelled'?<span className="badge">{d.description?.startsWith('✕')?L('Rejected','却下','Rejeitado'):L('Cancelled','取消','Cancelado')}</span>:<button className="btn btn-sm btn-danger" onClick={()=>handleDelete(d)}>{L('Remove','取り消す','Remover')}</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
