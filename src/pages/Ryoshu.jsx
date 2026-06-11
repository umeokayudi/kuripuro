import { useState } from 'react'
import { useLang } from '../hooks/useLang'
import { Icons } from '../components/Icons'
import toast from 'react-hot-toast'

const ISSUED = [
  { num: 'REC-2026-060', to: 'Clinic Sakura Co., Ltd.', service: 'Cleaning May 2026', amount: 360000, date: '2026-05-31' },
  { num: 'REC-2026-059', to: 'Hotel Grand Co., Ltd.', service: 'Cleaning May 2026', amount: 450000, date: '2026-05-31' },
]

export default function Ryoshu() {
  const { t } = useLang()
  const [tab, setTab] = useState('generate')
  const [form, setForm] = useState({ to:'', service:'', amount:0, date: new Date().toISOString().split('T')[0], num:'REC-2026-061' })
  const upd = (k,v) => setForm(f=>({...f,[k]:v}))
  const tax = Math.round(form.amount/11)
  const excl = form.amount - tax
  const [y,m,d] = form.date.split('-')

  const printRyoshu = () => {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${form.num}</title>
<style>body{font-family:-apple-system,Arial,sans-serif;padding:40px;color:#1a2636;max-width:420px;margin:0 auto}.header{display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-bottom:10px}h1{text-align:center;font-size:22px;letter-spacing:8px;margin-bottom:16px}.recipient{font-size:14px;padding-bottom:10px;border-bottom:1px solid #ddd;margin-bottom:16px}.amount{text-align:center;margin:20px 0}.amount .lbl{font-size:11px;color:#aaa}.amount .val{font-size:34px;font-weight:700;color:#0d2137}.row{display:flex;justify-content:space-between;padding:6px 0;font-size:12px;border-bottom:1px solid #eee}.row:last-child{font-weight:700;font-size:13px;border-bottom:none}.footer{margin-top:20px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#aaa}.company{font-size:14px;font-weight:700;color:#1a2636;margin-bottom:4px}@media print{body{padding:20px}}</style>
</head><body>
<div class="header"><span>No. ${form.num}</span><span>${y}年${m}月${d}日</span></div>
<h1>領　収　書</h1>
<div class="recipient">${form.to} 御中</div>
<div class="amount"><div class="lbl">金額</div><div class="val">¥${Number(form.amount).toLocaleString()}</div><div class="lbl">（税込）</div></div>
<div class="row"><span style="color:#aaa">内容</span><span>${form.service}</span></div>
<div class="row"><span style="color:#aaa">税抜金額</span><span>¥${excl.toLocaleString()}</span></div>
<div class="row"><span style="color:#aaa">消費税（10%）</span><span>¥${tax.toLocaleString()}</span></div>
<div class="row"><span>合計</span><span>¥${Number(form.amount).toLocaleString()}</span></div>
<div class="footer"><div class="company">KuriPuro by JBM 株式会社</div><div>〒 160-0023 東京都新宿区西新宿</div><div>登録番号: T1234567890123</div></div>
</body></html>`
    const win = window.open('','_blank')
    win.document.write(html)
    win.document.close()
    setTimeout(()=>win.print(),400)
    toast.success('Print dialog opened')
  }

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='generate'?' active':''}`} onClick={()=>setTab('generate')}>Generate</button>
        <button className={`tab-pill${tab==='history'?' active':''}`} onClick={()=>setTab('history')}>History</button>
      </div>

      {tab==='generate' && (
        <div className="grid-2" style={{gap:16}}>
          <div className="card">
            <div className="card-title">Generate 領収書</div>
            <div className="form-group"><label>To (受取人)</label><input value={form.to} onChange={e=>upd('to',e.target.value)} /></div>
            <div className="form-group"><label>Service</label><input value={form.service} onChange={e=>upd('service',e.target.value)} /></div>
            <div className="form-group"><label>Amount (¥)</label><input type="number" value={form.amount} onChange={e=>upd('amount',parseInt(e.target.value)||0)} /></div>
            <div className="form-group"><label>Date</label><input type="date" value={form.date} onChange={e=>upd('date',e.target.value)} /></div>
            <div className="form-group"><label>Receipt No.</label><input value={form.num} onChange={e=>upd('num',e.target.value)} /></div>
            <button className="btn btn-primary" onClick={printRyoshu}><Icons.download /> Print / Save PDF</button>
          </div>
          <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:10,padding:24,fontFamily:'serif'}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#aaa',marginBottom:10}}><span>No. {form.num}</span><span>{y}年{m}月{d}日</span></div>
            <div style={{textAlign:'center',fontSize:20,fontWeight:700,letterSpacing:8,marginBottom:14}}>領　収　書</div>
            <div style={{fontSize:14,paddingBottom:10,borderBottom:'1px solid #ddd',marginBottom:14}}>{form.to} 御中</div>
            <div style={{textAlign:'center',margin:'16px 0'}}>
              <div style={{fontSize:11,color:'#aaa'}}>金額</div>
              <div style={{fontSize:30,fontWeight:700,color:'#0d2137'}}>¥{Number(form.amount).toLocaleString()}</div>
              <div style={{fontSize:11,color:'#aaa'}}>（税込）</div>
            </div>
            {[['内容',form.service],['税抜金額','¥'+excl.toLocaleString()],['消費税(10%)','¥'+tax.toLocaleString()],['合計','¥'+Number(form.amount).toLocaleString()]].map(([l,v])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:12,borderBottom:'1px solid #eee'}}><span style={{color:'#aaa'}}>{l}</span><span>{v}</span></div>
            ))}
            <div style={{marginTop:14,fontSize:11,color:'#aaa',borderTop:'1px solid #ddd',paddingTop:10}}>
              <div style={{fontWeight:700,fontSize:13,color:'#1a2636'}}>KuriPuro by JBM 株式会社</div>
              <div>〒 160-0023 東京都新宿区西新宿</div>
            </div>
          </div>
        </div>
      )}

      {tab==='history' && (
        <div className="card">
          <div className="card-title">Issued Receipts</div>
          <table><thead><tr><th>No.</th><th>To</th><th>Service</th><th>Amount</th><th>Date</th></tr></thead>
          <tbody>{ISSUED.map(r=><tr key={r.num}><td style={{fontWeight:500}}>{r.num}</td><td>{r.to}</td><td>{r.service}</td><td>¥{r.amount.toLocaleString()}</td><td>{r.date}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  )
}
