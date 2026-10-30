import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { salesGet } from '../lib/salesApi'
import { tokyoToday } from '../lib/dates'
import SalesFunnel from '../components/SalesFunnel'
import { funnelCopy, clientsOutsideFunnel } from '../lib/salesPhases'
import { Link } from 'react-router-dom'
import { pickLang } from '../hooks/useLang'

// Admin: every seller's clients on one board, each with its own client page.
export default function SalesFunnelPage() {
  const { lang } = useLang()
  const t = funnelCopy(lang)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setData(await salesGet('/api/sales-data', lang)); setError('') }
    catch (e) { setError(e.message); toast.error(e.message) }
  }, [lang])
  useEffect(() => { load() }, [load])
  return <div className="fn-page">
    <div className="fn-page-head"><div><div className="sales-kicker">KURIPURO · SALES</div><h1>{t.title}</h1><p>{t.sub}</p>
      {data && clientsOutsideFunnel(data).length > 0 && (() => { const out = clientsOutsideFunnel(data); return <p className="sales-muted" style={{ marginTop: 4 }}>
        {pickLang(lang, `+ ${out.length} active clients from before the funnel (${out.slice(0, 3).map(c => c.company_name).join(', ')}${out.length > 3 ? '…' : ''}) are not on this board — `, `+ ファネル導入前からの稼働中顧客${out.length}件（${out.slice(0, 3).map(c => c.company_name).join('、')}${out.length > 3 ? '…' : ''}）はこのボードに表示されません — `, `+ ${out.length} clientes ativos de antes do funil (${out.slice(0, 3).map(c => c.company_name).join(', ')}${out.length > 3 ? '…' : ''}) não aparecem aqui — `)}
        <Link to="/clients">{pickLang(lang, 'see Clients', '顧客を見る', 'ver em Clientes')}</Link></p> })()}
    </div></div>
    {error && <div className="card sales-setup-note"><p>{error}</p></div>}
    {!data && !error && <div className="card">{t.loading}</div>}
    {data && <SalesFunnel data={data} lang={lang} today={data.today || tokyoToday()} isAdmin onChanged={load} />}
  </div>
}
