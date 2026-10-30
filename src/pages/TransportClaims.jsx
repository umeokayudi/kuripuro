import { useState, useEffect } from 'react'
import { pendingChanged } from '../lib/adminPending'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { tokyoToday } from '../lib/dates'
import { useLang, pickLang } from '../hooks/useLang'
import { askConfirm } from '../components/ConfirmDialog'
import { undoToast } from '../components/UndoToast'
import EmptyHint from '../components/EmptyHint'

export default function TransportClaims() {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [note, setNote] = useState({})

  useEffect(() => { load() }, [])

  const load = async () => {
    pendingChanged()
    setLoading(true)
    const { data } = await supabase.from('transport_claims').select('*').order('created_at', { ascending: false })
    setClaims(data || [])
    setLoading(false)
  }

  const handleAction = async (id, status, empId, amount, empName) => {
    const yen = `¥${Number(amount).toLocaleString()}`
    const approve = status === 'approved'
    const ok = await askConfirm({
      title: approve ? L(`Approve ${yen} for ${empName}?`, `${empName}さんの${yen}を承認しますか？`, `Aprovar ${yen} para ${empName}?`) : L(`Reject the claim of ${empName}?`, `${empName}さんの申請を却下しますか？`, `Recusar o pedido de ${empName}?`),
      message: approve
        ? L(`${yen} is added to this month's pay (${tokyoToday().slice(0, 7)}) as transport reimbursement.`, `交通費として${yen}が今月（${tokyoToday().slice(0, 7)}）の給与に加算されます。`, `${yen} entra no salário deste mês (${tokyoToday().slice(0, 7)}) como reembolso de transporte.`)
        : L('Nothing is paid. The employee sees it as rejected, with your note.', '支払いはありません。スタッフには却下（メモ付き）と表示されます。', 'Nada é pago. O funcionário vê como recusado, com a sua observação.'),
      confirmLabel: approve ? L('Approve', '承認', 'Aprovar') : L('Reject', '却下', 'Recusar'), danger: !approve,
    })
    if (!ok) return
    const { error } = await supabase.from('transport_claims').update({ status, admin_note: note[id]||'' }).eq('id', id)
    if (error) return toast.error(error.message)
    let payId = null
    if (approve) {
      const { data: pay } = await supabase.from('salary_payments').insert({
        employee_id: empId, employee_name: empName,
        period: tokyoToday().slice(0, 7),
        amount, payment_date: tokyoToday(),
        description: `Transport reimbursement`, status: 'scheduled',
        payment_type: 'bonus', is_deduction: false
      }).select('id').maybeSingle()
      payId = pay?.id || null
    }
    load()
    undoToast(approve ? L(`Approved · ${yen} added to salary`, `承認 · ${yen}を給与に加算`, `Aprovado · ${yen} somado ao salário`) : L('Rejected', '却下しました', 'Recusado'), async () => {
      if (payId) { const res = await supabase.from('salary_payments').delete().eq('id', payId); if (res.error) return res }
      return supabase.from('transport_claims').update({ status: 'pending' }).eq('id', id)
    }, lang, load)
  }

  const filtered = claims.filter(c => filter === 'all' ? true : c.status === filter)
  const pending = claims.filter(c => c.status === 'pending').length
  const statusText = s => s === 'approved' ? L('Approved', '承認', 'Aprovado') : s === 'rejected' ? L('Rejected', '却下', 'Recusado') : L('Pending', '保留中', 'Pendente')

  return (
    <div>
      <div className="tab-pills">
        {[['pending', `${L('Pending', '保留中', 'Pendentes')}${pending>0?` (${pending})`:''}`], ['approved',L('Approved', '承認', 'Aprovados')], ['rejected',L('Rejected', '却下', 'Recusados')], ['all',L('All', 'すべて', 'Todos')]].map(([k,l])=>(
          <button key={k} className={`tab-pill${filter===k?' active':''}`} onClick={()=>setFilter(k)}>{l}</button>
        ))}
      </div>

      {loading && <div aria-busy="true" aria-label={L('Loading…','読み込み中…','Carregando…')}>{[0,1,2].map(i => <div key={i} className="kp-skel kp-skel-row" />)}</div>}
      {filtered.length===0 && !loading && (
        <EmptyHint icon="🚃" title={filter === 'pending' ? L('No claims waiting', '確認待ちの申請はありません', 'Nenhum pedido esperando') : L('No claims here', '申請はありません', 'Nenhum pedido aqui')}>
          {L('Employees send train/bus costs from their app (Transport). Each claim arrives here to approve; approved amounts go into that month\'s pay automatically.',
            'スタッフはアプリ（交通費）から電車・バス代を申請します。申請はここに届き、承認した金額はその月の給与に自動で加算されます。',
            'Os funcionários enviam gastos de trem/ônibus pelo app (Transporte). Cada pedido chega aqui para aprovar; o valor aprovado entra no salário do mês automaticamente.')}
        </EmptyHint>
      )}

      {filtered.map(c=>(
        <div key={c.id} className="card" style={{marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
            <div>
              <div style={{fontWeight:600,fontSize:15}}>{c.employee_name}</div>
              <div style={{fontSize:13,fontWeight:700,color:'var(--green)',marginTop:2}}>¥{Number(c.amount).toLocaleString()}</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{c.claim_date}{c.route&&` · ${c.route}`}</div>
              {c.job_title&&<div style={{fontSize:12,color:'var(--text3)'}}>Job: {c.job_title}</div>}
              {c.description&&<div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{c.description}</div>}
            </div>
            <span className={`badge ${c.status==='approved'?'badge-green':c.status==='rejected'?'badge-red':'badge-amber'}`}>{statusText(c.status)}</span>
          </div>

          {/* Photos */}
          {(c.photo_url||c.receipt_url)&&(
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              {c.photo_url&&<a href={c.photo_url} target="_blank" rel="noreferrer" className="btn btn-sm">📷 {L('Photo', '写真', 'Foto')}</a>}
              {c.receipt_url&&<a href={c.receipt_url} target="_blank" rel="noreferrer" className="btn btn-sm">🧾 {L('Receipt', '領収書', 'Recibo')}</a>}
            </div>
          )}

          {c.status==='pending'&&(
            <div>
              <div className="form-group">
                <label>{L('Admin note (optional)', '管理者メモ（任意）', 'Observação do escritório (opcional)')}</label>
                <input value={note[c.id]||''} onChange={e=>setNote(n=>({...n,[c.id]:e.target.value}))} placeholder={L('Reason for approval/rejection…', '承認・却下の理由…', 'Motivo da aprovação/recusa…')} />
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-primary" style={{flex:1}} onClick={()=>handleAction(c.id,'approved',c.employee_id,c.amount,c.employee_name)}>✅ {L('Approve', '承認', 'Aprovar')}</button>
                <button className="btn btn-danger" style={{flex:1}} onClick={()=>handleAction(c.id,'rejected',c.employee_id,c.amount,c.employee_name)}>❌ {L('Reject', '却下', 'Recusar')}</button>
              </div>
            </div>
          )}

          {c.admin_note&&c.status!=='pending'&&<div style={{fontSize:12,color:'var(--text3)',background:'var(--surface2)',borderRadius:8,padding:'8px 10px',marginTop:8}}>{L('Note', 'メモ', 'Observação')}: {c.admin_note}</div>}
        </div>
      ))}
    </div>
  )
}
