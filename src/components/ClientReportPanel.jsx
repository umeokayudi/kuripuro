// v1.0.133 · "Relatório do Cliente" generator (Clientes). Builds a printable report (print → PDF)
// that only says day, store, type of service and who did it. See src/lib/clientReport.js.
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { clientReportRows, clientReportHtml } from '../lib/clientReport'
import { showPrintOverlay } from '../lib/openPrintHtml'
import { isTestJob } from '../lib/testData'
import { tokyoToday } from '../lib/dates'
import { useLang, pickLang } from '../hooks/useLang'

const lastDay = m => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}` }

export default function ClientReportPanel({ client, onClose }) {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [month, setMonth] = useState(tokyoToday().slice(0, 7))
  const [store, setStore] = useState('')
  const [stores, setStores] = useState([])
  const [reportLang, setReportLang] = useState('ja')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('locations').select('name').eq('client_id', client.id).then(({ data }) => setStores((data || []).map(l => l.name).filter(Boolean)))
  }, [client.id])

  const generate = async () => {
    setBusy(true)
    const from = `${month}-01`, to = lastDay(month)
    const { data, error } = await supabase.from('jobs')
      .select('*')
      .eq('client_id', client.id).eq('status', 'completed')
      .gte('scheduled_date', from).lte('scheduled_date', to).limit(2000)
    setBusy(false)
    if (error) { toast.error(error.message); return }
    let rows = clientReportRows((data || []).filter(j => !isTestJob(j)))
    if (store) rows = rows.filter(r => r.place === store)
    const name = store ? `${client.company_name} · ${store}` : client.company_name
    showPrintOverlay(clientReportHtml({ clientName: name, from, to, rows, lang: reportLang }))
  }

  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>📄 {L('Client report', '作業報告書', 'Relatório do cliente')}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{L('Shows day, store, type of service and who did it. No times, values or internal notes.', '日付・店舗・作業内容・担当のみ。時間・金額・社内メモは表示しません。', 'Mostra dia, loja, tipo de serviço e quem fez. Sem horários, valores ou notas internas.')}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        <select value={store} onChange={e => setStore(e.target.value)}>
          <option value="">{L('All stores', '全店舗', 'Todas as lojas')}</option>
          {stores.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={reportLang} onChange={e => setReportLang(e.target.value)}>
          <option value="ja">日本語</option><option value="en">English</option><option value="pt">Português</option>
        </select>
        <button className="btn btn-sm btn-primary" disabled={busy || !month} onClick={generate}>{busy ? '…' : `🖨 ${L('Generate PDF', 'PDFを作成', 'Gerar PDF')}`}</button>
        <button className="btn btn-sm" onClick={onClose}>{L('Close', '閉じる', 'Fechar')}</button>
      </div>
    </div>
  )
}
