import { useState, useEffect } from 'react'
import SkeletonRows from '../components/SkeletonRows'
import { useSearchParams, Link } from 'react-router-dom'
import { tokyoToday } from '../lib/dates'
import { supabase } from '../lib/supabase'
import { escapeHtml } from '../lib/escapeHtml'
import { useLang } from '../hooks/useLang'
import toast from 'react-hot-toast'
import { askConfirm } from '../components/ConfirmDialog'

// v1.0.96 · a receipt is made FROM an invoice (no free form): client, amount and tax come from the
// invoice, and receipt_number = R-<first 8 of the invoice id> keeps the link (no new column needed).
// The screen follows the account language; the printed receipt stays in Japanese (it goes to the client).
export const receiptNumberFor = (faturaId) => `R-${String(faturaId || '').slice(0, 8)}`
const invoiceOf = (r, faturas) => {
  const key = String(r.receipt_number || '').replace(/^R-/, '')
  return key ? faturas.find(f => f.id.startsWith(key)) : null
}

export default function Ryoshu() {
  const { t, tr, locale } = useLang()
  const [searchParams] = useSearchParams()
  const wanted = searchParams.get('fatura')
  const [receipts, setReceipts] = useState([])
  const [faturas, setFaturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const emptyForm = () => ({ fatura_id:'', description:'', issue_date:tokyoToday() })
  const [form, setForm] = useState(emptyForm)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [r, f] = await Promise.all([
      supabase.from('ryoshu').select('*').order('issue_date', { ascending:false }).limit(100),
      supabase.from('faturas').select('id,client_id,client_name,period_start,period_end,issue_date,subtotal,tax_amount,total,tax_rate,status,paid_at').order('issue_date', { ascending:false }).limit(300),
    ])
    setReceipts(r.data||[]); setFaturas(f.data||[])
    setLoading(false)
  }

  // Opened from an invoice ("🧾 Receipt" in Invoices): the form starts filled with it.
  useEffect(() => {
    if (!wanted || !faturas.length) return
    if (faturas.some(f => f.id === wanted)) { setForm({ ...emptyForm(), fatura_id: wanted }); setShowForm(true) }
  }, [wanted, faturas.length])

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))
  // Only invoices that were really billed can get a receipt; one receipt per invoice.
  const billable = faturas.filter(f => ['sent','pending','overdue','paid'].includes(f.status))
  const taken = new Set(receipts.map(r => invoiceOf(r, faturas)?.id).filter(Boolean))
  const inv = faturas.find(f => f.id === form.fatura_id)
  const fmtInv = f => `${f.client_name} · ${f.period_start || f.issue_date || ''}${f.period_end ? ` → ${f.period_end}` : ''} · ¥${Number(f.total||0).toLocaleString(locale)}`

  const handleCreate = async () => {
    if (!inv) return toast.error(tr('Choose the invoice','請求書を選択してください','Escolha a fatura'))
    if (taken.has(inv.id) && !(await askConfirm({ message: tr('This invoice already has a receipt. Make another one?','この請求書には領収書があります。もう一枚作りますか？','Essa fatura já tem recibo. Fazer outro?') }))) return
    const total = Number(inv.total||0)
    const tax = Number(inv.tax_amount ?? 0)
    const { error } = await supabase.from('ryoshu').insert({
      receipt_number: receiptNumberFor(inv.id),
      client_id: inv.client_id||null,
      client_name: inv.client_name,
      amount: Number(inv.subtotal ?? (total - tax)), tax_amount: tax, total_amount: total,
      tax_rate: Number(inv.tax_rate ?? 10),
      description: form.description,
      issue_date: form.issue_date,
      status: 'issued'
    })
    if (error) return toast.error(error.message)
    toast.success(tr('Receipt created','領収書を作成しました','Recibo criado'))
    setForm(emptyForm())
    setShowForm(false); load()
  }

  const handleDelete = async (id) => {
    if (!(await askConfirm({ message: tr('Delete this receipt?','この領収書を削除しますか？','Apagar este recibo?'), danger: true }))) return
    await supabase.from('ryoshu').delete().eq('id', id)
    toast(tr('Deleted','削除しました','Apagado')); load()
  }

  const handlePrint = (r) => {
    const w = window.open('', '_blank')
    const clientName = escapeHtml(r.client_name)
    const issueDate = escapeHtml(r.issue_date)
    const description = escapeHtml(r.description || 'サービス代として')
    w.document.write(`
      <html><head><title>領収書</title>
      <style>body{font-family:sans-serif;padding:40px;max-width:400px;margin:0 auto}
      h1{text-align:center;font-size:24px;margin-bottom:30px}
      .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}
      .total{font-size:20px;font-weight:bold;color:#0F6E56}
      .stamp{border:3px solid red;color:red;padding:4px 12px;display:inline-block;transform:rotate(-15deg);font-size:18px;font-weight:bold;margin-top:20px}
      </style></head>
      <body>
        <h1>領収書</h1>
        ${r.receipt_number ? `<div class="row"><span>No.</span><span>${escapeHtml(r.receipt_number)}</span></div>` : ''}
        <div class="row"><span>発行日</span><span>${issueDate}</span></div>
        <div class="row"><span>宛名</span><span>${clientName} 御中</span></div>
        <div class="row"><span>但し書き</span><span>${description}</span></div>
        <div class="row"><span>小計</span><span>¥${Number(r.amount||0).toLocaleString()}</span></div>
        <div class="row"><span>消費税 (${r.tax_rate}%)</span><span>¥${Number(r.tax_amount||0).toLocaleString()}</span></div>
        <div class="row total"><span>合計金額</span><span>¥${Number(r.total_amount||0).toLocaleString()}</span></div>
        <div style="margin-top:30px;text-align:center"><div class="stamp">領収済</div></div>
        <div style="margin-top:40px;text-align:right"><p>KuriPuro by JBM</p></div>
      </body></html>
    `)
    w.document.close()
    w.print()
  }

  const totalMonth = receipts.filter(r=>r.issue_date?.startsWith(tokyoToday().slice(0,7))).reduce((s,r)=>s+Number(r.total_amount||0),0)

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <h2 className="page-head" style={{margin:0,fontSize:22}}>{t.sidebar.ryoshu}</h2>
          <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{tr('This month', '今月合計', 'Este mês')}: <strong>¥{totalMonth.toLocaleString()}</strong></div>
        </div>
        <button className="btn btn-primary" onClick={()=>setShowForm(!showForm)}>+ {tr('New receipt', '新規作成', 'Novo recibo')}</button>
      </div>

      {showForm&&(
        <div className="card" style={{marginBottom:16,border:'1px solid var(--navy)'}}>
          <div className="card-title">{tr('New receipt','新規領収書','Novo recibo')}</div>
          <div className="grid-2">
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>{tr('Invoice','請求書','Fatura')} *</label>
              <select value={form.fatura_id} onChange={e=>upd('fatura_id',e.target.value)}>
                <option value="">{tr('Choose the invoice…','請求書を選択…','Escolha a fatura…')}</option>
                {billable.map(f=><option key={f.id} value={f.id}>{fmtInv(f)}{taken.has(f.id) ? ` · ${tr('has receipt','領収書あり','já tem recibo')}` : ''}</option>)}
              </select>
              {billable.length===0&&<small style={{color:'var(--text3)'}}>{tr('No sent or paid invoice yet.','送付済み・入金済みの請求書がありません。','Nenhuma fatura enviada ou paga ainda.')}</small>}
            </div>
            <div className="form-group"><label>{tr('Receipt date','発行日','Data do recibo')}</label><input type="date" value={form.issue_date} onChange={e=>upd('issue_date',e.target.value)} /></div>
            <div className="form-group"><label>{tr('Note on the receipt (但し書き)','但し書き','Observação no recibo (但し書き)')}</label><input value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="サービス代として" /></div>
          </div>
          {inv&&<div style={{background:'var(--surface2)',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:13}}>
            {inv.client_name} · {tr('Subtotal','小計','Subtotal')}: ¥{Number(inv.subtotal ?? 0).toLocaleString(locale)} + {tr('tax','税','imposto')}: ¥{Number(inv.tax_amount ?? 0).toLocaleString(locale)} = <strong>{tr('Total','合計','Total')}: ¥{Number(inv.total||0).toLocaleString(locale)}</strong>
            {inv.status!=='paid'&&<div style={{color:'var(--amber)',marginTop:4}}>⚠️ {tr('This invoice is not marked paid yet.','この請求書はまだ入金済みではありません。','Esta fatura ainda não está marcada como paga.')}</div>}
          </div>}
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" onClick={handleCreate}>✅ {tr('Create','作成','Criar')}</button>
            <button className="btn" onClick={()=>setShowForm(false)}>{tr('Cancel','キャンセル','Cancelar')}</button>
          </div>
        </div>
      )}

      {loading&&<SkeletonRows rows={3} label={tr('Loading…','読み込み中…','Carregando…')} />}
      {receipts.length===0&&!loading&&<div className="card"><div style={{color:'var(--text3)',fontSize:13}}>{tr('No receipts yet.','領収書はまだありません。','Nenhum recibo ainda.')}</div></div>}
      {receipts.map(r=>(
        <div key={r.id} className="card" style={{marginBottom:10}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
            <div>
              <div style={{fontWeight:600,fontSize:15}}>{r.client_name} 御中</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{r.issue_date} · {r.description||'サービス代'}</div>
              {(() => { const f = invoiceOf(r, faturas); return f
                ? <div style={{fontSize:12,marginTop:2}}>🧾 {tr('Invoice','請求書','Fatura')}: <Link to={`/faturas?search=${f.id}`}>{f.period_start || f.issue_date}{f.period_end ? ` → ${f.period_end}` : ''}</Link> · {f.status}</div>
                : <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{tr('Not linked to an invoice','請求書と未連携','Sem fatura vinculada')}</div> })()}
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:16,fontWeight:700,color:'var(--green)'}}>¥{Number(r.total_amount||0).toLocaleString()}</div>
              <div style={{fontSize:11,color:'var(--text3)'}}>{tr('incl. tax','税込','com imposto')} ({r.tax_rate}%)</div>
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-sm btn-primary" onClick={()=>handlePrint(r)}>🖨️ {tr('Print', '印刷', 'Imprimir')}</button>
            <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(r.id)}>🗑 {tr('Delete', '削除', 'Excluir')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
