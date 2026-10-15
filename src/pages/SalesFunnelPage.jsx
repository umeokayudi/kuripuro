import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { salesGet } from '../lib/salesApi'
import { tokyoToday } from '../lib/dates'
import SalesFunnel from '../components/SalesFunnel'
import { funnelCopy } from '../lib/salesPhases'

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
    <div className="fn-page-head"><div><div className="sales-kicker">KURIPURO · SALES</div><h1>{t.title}</h1><p>{t.sub}</p></div></div>
    {error && <div className="card sales-setup-note"><p>{error}</p></div>}
    {!data && !error && <div className="card">{t.loading}</div>}
    {data && <SalesFunnel data={data} lang={lang} today={data.today || tokyoToday()} isAdmin onChanged={load} />}
  </div>
}
