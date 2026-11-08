// v1.0.189 · Employee ☰ → Treinamento: the videos the office picked, watched inside the app with
// the YouTube player. Progress counts only seconds really played; 90% watched = ✓ done.
// Resumes where the person stopped. Required videos are marked and counted on the ☰ badge.
import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import YouTubePlayer from './YouTubePlayer'
import { loadCatalog, loadProgress, saveProgress, TRAINING_CHANGED } from '../lib/trainingVideos'
import { byCategory, endProgress, fmtDuration, summary, tickProgress, videosFor } from '../lib/trainingCore'
import '../pages/training.css'

/** ☰ badge: how many required videos this employee still has to watch. */
export function useTrainingLeft(employeeId) {
  const [left, setLeft] = useState({ requiredLeft: 0, left: 0, total: 0 })
  useEffect(() => {
    if (!employeeId) return undefined
    let alive = true
    const load = () => Promise.all([loadCatalog(), loadProgress(employeeId)])
      .then(([list, pr]) => { if (alive) setLeft(summary(list, pr, employeeId)) })
    load()
    window.addEventListener(TRAINING_CHANGED, load)
    return () => { alive = false; window.removeEventListener(TRAINING_CHANGED, load) }
  }, [employeeId])
  return left
}

export default function EmployeeTraining({ user, L }) {
  const [list, setList] = useState(null)
  const [progress, setProgress] = useState({})
  const [open, setOpen] = useState(null)
  const prRef = useRef({})
  const dirty = useRef(false)
  const lastSave = useRef(0)

  useEffect(() => {
    let alive = true
    Promise.all([loadCatalog(), loadProgress(user.id)]).then(([vids, pr]) => {
      if (!alive) return
      setList(videosFor(vids, user.id))
      prRef.current = pr
      setProgress(pr)
    })
    return () => { alive = false }
  }, [user.id])

  const flush = useCallback((force = false) => {
    if (!dirty.current) return
    if (!force && Date.now() - lastSave.current < 15000) return
    dirty.current = false
    lastSave.current = Date.now()
    saveProgress(user.id, prRef.current)
      .then(() => window.dispatchEvent(new Event(TRAINING_CHANGED)))
      .catch(() => { dirty.current = true })
  }, [user.id])

  useEffect(() => () => flush(true), [flush])

  const update = (id, fn) => {
    const before = prRef.current[id]
    const next = fn(before)
    prRef.current = { ...prRef.current, [id]: next }
    dirty.current = true
    setProgress(prRef.current)
    if (next.done && !before?.done) {
      toast.success(L('Training done ✓', '研修完了 ✓', 'Treinamento concluído ✓'))
      flush(true)
    }
  }

  if (!list) return <div className="tr-empty">…</div>

  const sum = summary(list, progress, user.id)
  const video = open && list.find(v => v.id === open)

  if (video) {
    const p = progress[video.id] || {}
    return (
      <div className="tr-wrap">
        <button type="button" className="tr-back" onClick={() => { flush(true); setOpen(null) }}>‹ {L('All videos', '動画一覧', 'Todos os vídeos')}</button>
        <YouTubePlayer
          videoId={video.yt}
          start={p.done ? 0 : Math.max(0, (p.pos || 0) - 2)}
          onTick={t => { update(video.id, prev => tickProgress(prev, t)); flush() }}
          onPause={({ current }) => { if (current) { update(video.id, prev => ({ ...(prev || {}), pos: current })); flush(true) } }}
          onEnded={({ duration }) => { update(video.id, prev => endProgress(prev, duration)); flush(true) }}
          onError={() => toast.error(L('This video cannot play here. Tell the office.', 'この動画は再生できません。事務所に連絡してください。', 'Este vídeo não abre aqui. Avise o escritório.'))}
        />
        <h2 className="tr-title">{video.title}</h2>
        <div className="tr-meta">
          {video.required && <span className="tr-req">{L('Required', '必須', 'Obrigatório')}</span>}
          {video.category && <span>{video.category}</span>}
          {video.duration_s > 0 && <span>{fmtDuration(video.duration_s)}</span>}
        </div>
        <Bar p={p} L={L} />
        {video.note && <p className="tr-note">{video.note}</p>}
      </div>
    )
  }

  if (!list.length) {
    return (
      <div className="tr-empty">
        🎓 {L('No training videos yet. The office will add them here.', 'まだ研修動画はありません。事務所がここに追加します。', 'Ainda não há vídeos de treinamento. O escritório vai colocar aqui.')}
      </div>
    )
  }

  return (
    <div className="tr-wrap">
      <div className="tr-summary">
        <b>{sum.done}/{sum.total}</b> {L('watched', '視聴済み', 'assistidos')}
        {sum.requiredLeft > 0
          ? <span className="tr-req">{L(`${sum.requiredLeft} required left`, `必須あと${sum.requiredLeft}本`, `faltam ${sum.requiredLeft} obrigatórios`)}</span>
          : sum.done === sum.total ? <span className="tr-ok">✓ {L('All done', 'すべて完了', 'Tudo feito')}</span> : null}
      </div>
      {byCategory(list).map(g => (
        <div key={g.category || '-'} className="tr-group">
          {g.category && <div className="tr-cat">{g.category}</div>}
          {g.videos.map(v => {
            const p = progress[v.id] || {}
            return (
              <button key={v.id} type="button" className={`tr-card${p.done ? ' is-done' : ''}`} onClick={() => setOpen(v.id)}>
                <span className="tr-thumb">
                  <img src={v.thumb} alt="" loading="lazy" />
                  {v.duration_s > 0 && <em>{fmtDuration(v.duration_s)}</em>}
                  {p.done && <i>✓</i>}
                </span>
                <span className="tr-card-copy">
                  <span className="tr-card-title">{v.title}</span>
                  <span className="tr-meta">
                    {v.required && !p.done && <span className="tr-req">{L('Required', '必須', 'Obrigatório')}</span>}
                    {p.done ? <span className="tr-ok">✓ {L('Watched', '視聴済み', 'Assistido')}</span>
                      : p.pct > 0 ? <span>{Math.round(p.pct * 100)}% · {L('continue', '続きから', 'continuar')}</span>
                        : <span>▶ {L('Not started', '未視聴', 'Não começou')}</span>}
                  </span>
                  {!p.done && p.pct > 0 && <span className="tr-mini"><span style={{ width: `${Math.round(p.pct * 100)}%` }} /></span>}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Bar({ p, L }) {
  const pct = Math.round((p.pct || 0) * 100)
  return (
    <div className="tr-progress">
      <div className="tr-mini"><span style={{ width: `${p.done ? 100 : pct}%` }} /></div>
      <div>{p.done
        ? <span className="tr-ok">✓ {L('Watched — training done', '視聴済み — 研修完了', 'Assistido — treinamento concluído')}</span>
        : L(`${pct}% watched · watch to the end to finish`, `${pct}% 視聴 · 最後まで見ると完了`, `${pct}% assistido · assista até o fim para concluir`)}</div>
    </div>
  )
}
