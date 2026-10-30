// v1.0.106 · The client report on screen: admin preview and client portal show the same thing.
// Day only (never a time), type, who did it, before/after photos, video player, checklist,
// notes marked "visible to the client", deep cleaning state and what is scheduled next.
import JobPhotos from './JobPhotos'
import JobVideos from './JobVideos'
import { reportDay, reportMonth, rt, typeLabel } from '../lib/clientReportText'
import './client-report.css'

export default function ClientReportView({ content, lang, onPhoto }) {
  if (!content) return null
  const L = (k, v) => rt(lang, k, v)
  const t = content.totals || {}
  const locs = (content.locations || []).filter(l => l.services.length || l.next.length)
  return (
    <div className="crp">
      <div className="crp-cover">
        <div className="crp-brand">KuriPuro</div>
        <h3>{L('title')}</h3>
        <p><b>{content.client?.name}</b> · {L('period')}: {reportMonth(content.period, lang)}</p>
        <div className="crp-kpis">
          <div className="crp-kpi"><small>{L('locations')}</small><b>{t.locations || 0}</b></div>
          <div className="crp-kpi"><small>{L('services')}</small><b>{t.services || 0}</b></div>
          <div className="crp-kpi"><small>{L('basicDeep')}</small><b>{t.basic || 0} × {t.deep || 0}</b>{t.spot ? <span>+ {t.spot} {L('spot')}</span> : null}</div>
        </div>
      </div>
      {!locs.length && <div className="crp-loc crp-empty">{L('noService')}</div>}
      {locs.map(l => (
        <section key={l.name} className="crp-loc">
          <div className="crp-loc-h">
            <b>🏬 {l.name}</b>
            <span>{l.services.length} · {L('basic')} {l.counts.basic} · {L('deep')} {l.counts.deep}{l.counts.spot ? ` · ${L('spot')} ${l.counts.spot}` : ''}</span>
          </div>
          <div className="crp-deep">
            🧽 {L('deepState')}: {L('lastDone')} <b>{reportDay(l.deep?.last, lang)}</b> · {L('nextExpected')} <b>{reportDay(l.deep?.next, lang)}</b>
            {l.checklist ? <> · ✓ {L('checklistOf', { x: l.checklist.done, y: l.checklist.total })}</> : null}
          </div>
          {!l.services.length && <div className="crp-empty">{L('noService')}</div>}
          {l.services.map(s => (
            <div key={s.job_id} className="crp-svc">
              <div className="crp-svc-h">
                <span>{reportDay(s.date, lang)}<span className={`crp-tag ${s.type}`}>{typeLabel(s.type, lang)}</span>{s.what ? <em> · {s.what}</em> : null}</span>
                <span>{L('by')}: {s.by || '—'}</span>
              </div>
              {(s.before || s.after) && (
                <div className="crp-media">
                  <JobPhotos photoStartUrl={s.before} photoEndUrl={s.after} beforeLabel={L('before')} afterLabel={L('after')} size={120} onPhotoClick={onPhoto} />
                </div>
              )}
              {s.video && <div className="crp-media"><JobVideos jobId={s.job_id} lazy label={`🎬 ${L('video')}`} /></div>}
              {s.checklist && <div className="crp-line">✓ {L('checklist')}: {L('checklistOf', { x: s.checklist.done, y: s.checklist.total })}</div>}
              {(s.notes || []).map((n, i) => <div key={i} className="crp-note">📝 {n.text}</div>)}
            </div>
          ))}
          <div className="crp-next">
            📅 <b>{L('next')}:</b> {l.next.length ? l.next.map(n => `${reportDay(n.date, lang)} (${typeLabel(n.type, lang)})`).join(' · ') : L('noNext')}
          </div>
        </section>
      ))}
    </div>
  )
}
