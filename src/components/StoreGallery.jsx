// v1.0.154 · Client portal: photos and videos of the store, service by service (before / after).
// Shows only date, type of service and who did it — never times, values or internal notes.
import { useEffect, useState } from 'react'
import { mediaForJobs, isVideoPath } from '../lib/workMedia'
import { storagePublicUrl, periodLabels } from '../lib/workReport'
import { getCleaningType, locationNameFromTitle } from '../lib/cleaningType'
import { pickLang } from '../hooks/useLang'

export default function StoreGallery({ jobs, lang, onPhoto, showStore }) {
  const L = periodLabels(lang === 'pt' ? 'pt' : lang === 'en' ? 'en' : 'ja')
  const [limit, setLimit] = useState(12)
  const [media, setMedia] = useState(null)
  const list = (jobs || []).filter(j => j.status === 'completed').sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date))
  const shown = list.slice(0, limit)
  const key = shown.map(j => j.id).join(',')
  useEffect(() => {
    let off = false
    mediaForJobs(shown).then(m => { if (!off) setMedia(m) })
    return () => { off = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const day = d => new Date(`${d}T12:00:00`).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { month: 'short', day: 'numeric', weekday: 'short' })
  if (!list.length) return <p className="cpg-empty">{pickLang(lang, 'No finished service yet.', '完了した作業はまだありません。', 'Nenhum serviço concluído ainda.')}</p>
  return (
    <div className="cpg">
      {shown.map(j => {
        const m = media?.get(j.id) || []
        const type = j.job_category === 'spot' ? 'spot' : getCleaningType(j) === 'deep' ? 'deep' : 'basic'
        return (
          <div key={j.id} className="cpg-svc">
            <div className="cpg-h"><b>{day(j.scheduled_date)}</b><span>{L.types[type]}</span>{showStore && <span>{locationNameFromTitle(j.title)}</span>}<span>{L.who}: {j.employee_name || '—'}</span></div>
            {media === null ? <div className="cpg-load">…</div> : m.length ? (
              <div className="cpg-grid">
                {m.map(x => (
                  <figure key={x.path}>
                    {x.kind === 'video' || isVideoPath(x.path)
                      ? <video src={`${storagePublicUrl(x.path)}#t=0.5`} controls playsInline preload="metadata" />
                      : <img src={storagePublicUrl(x.path)} alt="" loading="lazy" onClick={() => onPhoto?.(storagePublicUrl(x.path))} />}
                    <em>{x.kind === 'video' ? '▶ ' : ''}{x.section === 'before' ? L.before : L.after}</em>
                  </figure>
                ))}
              </div>
            ) : <small className="cpg-empty">{pickLang(lang, 'No photo for this service.', 'この作業の写真はありません。', 'Sem foto neste serviço.')}</small>}
          </div>
        )
      })}
      {list.length > limit && <button type="button" className="cp-btn" onClick={() => setLimit(n => n + 12)}>{pickLang(lang, 'Show more', 'もっと見る', 'Ver mais')}</button>}
    </div>
  )
}
