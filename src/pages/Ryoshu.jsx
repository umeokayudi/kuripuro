import { useState } from 'react'
import { useLang } from '../hooks/useLang'
import { Icons } from '../components/Icons'
import toast from 'react-hot-toast'

const ISSUED = [
  { num: 'REC-2026-060', to: 'Clinic Sakura Co., Ltd.', service: 'Cleaning May 2026', amount: 360000, date: '2026-05-31' },
  { num: 'REC-2026-059', to: 'Hotel Grand Co., Ltd.', service: 'Cleaning May 2026', amount: 450000, date: '2026-05-31' },
  { num: 'REC-2026-058', to: 'Tokyo Office Inc.', service: 'Cleaning May 2026', amount: 300000, date: '2026-05-31' },
]

export default function Ryoshu() {
  const { t } = useLang()
  const [tab, setTab] = useState('generate')
  const [form, setForm] = useState({
    to: 'Hotel Grand Co., Ltd.',
    service: 'Cleaning Service — June 2026',
    amount: 450000,
    date: '2026-06-11',
    num: 'REC-2026-061',
  })

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const tax = Math.round(form.amount / 11)
  const excl = form.amount - tax
  const [y, m, d] = form.date.split('-')

  const downloadPDF = async () => {
    try {
      const { default: jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a5' })

      doc.setFont('helvetica')
      doc.setFontSize(9)
      doc.setTextColor(130, 130, 130)
      doc.text(`No. ${form.num}`, 10, 12)
      doc.text(`${y}年${m}月${d}日`, 148 - 10, 12, { align: 'right' })

      doc.setFontSize(18)
      doc.setTextColor(13, 33, 55)
      doc.text('領　収　書', 74, 24, { align: 'center' })

      doc.setLineWidth(0.4)
      doc.setDrawColor(200, 200, 200)
      doc.line(10, 27, 138, 27)

      doc.setFontSize(11)
      doc.setTextColor(30, 30, 30)
      doc.text(`${form.to} 御中`, 10, 34)

      doc.setFontSize(9)
      doc.setTextColor(130, 130, 130)
      doc.text('金額', 74, 44, { align: 'center' })
      doc.setFontSize(22)
      doc.setTextColor(13, 33, 55)
      doc.text(`¥${Number(form.amount).toLocaleString()}`, 74, 54, { align: 'center' })
      doc.setFontSize(8)
      doc.setTextColor(130, 130, 130)
      doc.text('(税込)', 74, 59, { align: 'center' })

      doc.line(10, 63, 138, 63)

      const rows = [
        ['内容', form.service],
        ['税抜金額', `¥${excl.toLocaleString()}`],
        ['消費税 (10%)', `¥${tax.toLocaleString()}`],
        ['合計', `¥${Number(form.amount).toLocaleString()}`],
      ]
      let y2 = 70
      doc.setFontSize(9)
      rows.forEach(([label, val], i) => {
        doc.setTextColor(130, 130, 130)
        doc.text(label, 10, y2)
        doc.setTextColor(30, 30, 30)
        if (i === rows.length - 1) { doc.setFont('helvetica', 'bold') }
        doc.text(val, 138, y2, { align: 'right' })
        doc.setFont('helvetica', 'normal')
        doc.line(10, y2 + 2, 138, y2 + 2)
        y2 += 9
      })

      doc.setDrawColor(200, 200, 200)
      doc.line(10, y2 + 2, 138, y2 + 2)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(13, 33, 55)
      doc.text('KuriPuro by JBM 株式会社', 10, y2 + 10)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(130, 130, 130)
      doc.text('〒 160-0023 東京都新宿区西新宿', 10, y2 + 16)
      doc.text('登録番号: T1234567890123', 10, y2 + 21)

      doc.save(`${form.num}.pdf`)
      toast.success('PDF downloaded')
    } catch (e) {
      toast.error('PDF generation failed. Install jspdf.')
    }
  }

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab === 'generate' ? ' active' : ''}`} onClick={() => setTab('generate')}>{t.ryoshu.generate}</button>
        <button className={`tab-pill${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>{t.ryoshu.history}</button>
      </div>

      {tab === 'generate' && (
        <div className="grid-2" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-title"><Icons.settings /> {t.ryoshu.generate}</div>
            <div className="form-group"><label>{t.ryoshu.to}</label><input value={form.to} onChange={e => upd('to', e.target.value)} /></div>
            <div className="form-group"><label>{t.ryoshu.service}</label><input value={form.service} onChange={e => upd('service', e.target.value)} /></div>
            <div className="form-group"><label>{t.ryoshu.amount}</label><input type="number" value={form.amount} onChange={e => upd('amount', parseInt(e.target.value) || 0)} /></div>
            <div className="form-group"><label>{t.ryoshu.date}</label><input type="date" value={form.date} onChange={e => upd('date', e.target.value)} /></div>
            <div className="form-group"><label>{t.ryoshu.number}</label><input value={form.num} onChange={e => upd('num', e.target.value)} /></div>
            <button className="btn btn-primary" onClick={downloadPDF}><Icons.download /> {t.ryoshu.download}</button>
          </div>

          <div>
            <div className="ryoshu-paper">
              <div className="ryoshu-header">
                <span>No. {form.num}</span>
                <span>{y}年{m}月{d}日</span>
              </div>
              <div className="ryoshu-title">{t.ryoshu.receiptLabel}</div>
              <div className="ryoshu-recipient">{form.to} 御中</div>
              <div className="ryoshu-amount">
                <div className="amt-label">金額</div>
                <div className="amt-val">¥{Number(form.amount).toLocaleString()}</div>
                <div className="amt-label">{t.ryoshu.taxIncl}</div>
              </div>
              <div className="ryoshu-row"><span style={{ color: 'var(--text3)' }}>内容</span><span>{form.service}</span></div>
              <div className="ryoshu-row"><span style={{ color: 'var(--text3)' }}>税抜金額</span><span>¥{excl.toLocaleString()}</span></div>
              <div className="ryoshu-row"><span style={{ color: 'var(--text3)' }}>{t.ryoshu.tax}</span><span>¥{tax.toLocaleString()}</span></div>
              <div className="ryoshu-row"><span>{t.ryoshu.total}</span><span>¥{Number(form.amount).toLocaleString()}</span></div>
              <div className="ryoshu-footer">
                <div className="company-name">KuriPuro by JBM 株式会社</div>
                <div>{t.ryoshu.companyAddress}</div>
                <div>{t.ryoshu.regNumber}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <div className="card-title"><Icons.file /> {t.ryoshu.issued}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t.ryoshu.number}</th><th>{t.ryoshu.to}</th><th>{t.ryoshu.service}</th><th>{t.ryoshu.amount}</th><th>{t.ryoshu.date}</th><th></th></tr>
              </thead>
              <tbody>
                {ISSUED.map(r => (
                  <tr key={r.num}>
                    <td style={{ fontWeight: 500 }}>{r.num}</td>
                    <td>{r.to}</td>
                    <td>{r.service}</td>
                    <td>¥{r.amount.toLocaleString()}</td>
                    <td>{r.date}</td>
                    <td><button className="btn btn-sm"><Icons.download /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
