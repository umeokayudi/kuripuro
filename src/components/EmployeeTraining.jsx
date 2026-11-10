// v1.0.208 · Employee ☰ → Treinamento as a COURSE: modules with lessons in order, "Continuar"
// button, lessons that open one after the other, a quick question after a lesson, and a
// certificate at the end. Videos play inside the app with the YouTube player; only seconds really
// played count (90% = watched). Resumes where the person stopped.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import YouTubePlayer from './YouTubePlayer'
import { loadCatalog, loadProgress, saveProgress, TRAINING_CHANGED } from '../lib/trainingVideos'
import { answerQuiz, courseFor, endProgress, fmtDuration, fmtTotal, lessonAfter, summary, tickProgress } from '../lib/trainingCore'
import { showPrintOverlay } from '../lib/openPrintHtml'
import { escapeHtml } from '../lib/escapeHtml'
import '../pages/training.css'

/** ☰ badge: how many required lessons this employee still has to do. */
export function useTrainingLeft(employeeId) {
  const [left, setLeft] = useState({ requiredLeft: 0, left: 0, total: 0 })
  useEffect(() => {
    if (!employeeId) return undefined
    let alive = true
    const load = () => Promise.all([loadCatalog(), loadProgress(employeeId)])
      .then(([cat, pr]) => { if (alive) setLeft(summary(cat, pr, employeeId)) })
    load()
    window.addEventListener(TRAINING_CHANGED, load)
    return () => { alive = false; window.removeEventListener(TRAINING_CHANGED, load) }
  }, [employeeId])
  return left
}

function certificateHtml({ name, course, view, at, L }) {
  const date = new Date(at || Date.now()).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
  const mods = view.modules.map(m => `<li>${escapeHtml(m.title)} — ${m.done}/${m.total}</li>`).join('')
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${escapeHtml(L('Certificate', '修了証', 'Certificado'))}</title>
<style>@page{size:A4 landscape;margin:0}body{margin:0;font-family:-apple-system,'Segoe UI',sans-serif;color:#172033}
.c{box-sizing:border-box;width:297mm;height:210mm;padding:22mm;border:10px solid #315cf5;display:flex;flex-direction:column;justify-content:center;text-align:center;background:#fff}
.k{color:#315cf5;letter-spacing:.3em;font-size:13px;font-weight:800}h1{font-size:44px;margin:10px 0 4px}.n{font-size:34px;font-weight:800;margin:18px 0 6px;border-bottom:2px solid #dbe3ef;display:inline-block;padding:0 30px 6px}
p{font-size:16px;color:#475569;margin:6px 0}ul{list-style:none;padding:0;margin:14px 0 0;font-size:13px;color:#64748b}.f{margin-top:26px;font-size:13px;color:#64748b}</style></head>
<body><div class="c"><div class="k">KURIPURO BY JBM</div><h1>${escapeHtml(L('Certificate of completion', '修了証', 'Certificado de conclusão'))}</h1>
<p>${escapeHtml(L('This certifies that', '以下の者が修了したことを証します', 'Certificamos que'))}</p><div><span class="n">${escapeHtml(name)}</span></div>
<p>${escapeHtml(L('completed the course', 'コースを修了しました', 'concluiu o curso'))} <b>${escapeHtml(course.title)}</b></p>
<p>${view.done} ${escapeHtml(L('lessons', 'レッスン', 'aulas'))}${view.seconds ? ` · ${escapeHtml(fmtTotal(view.seconds))}` : ''}</p><ul>${mods}</ul>
<div class="f">${escapeHtml(date)}</div></div></body></html>`
}

export default function EmployeeTraining({ user, L }) {
  const [cat, setCat] = useState(null)
  const [progress, setProgress] = useState({})
  const [open, setOpen] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [pick, setPick] = useState(null)
  const prRef = useRef({})
  const dirty = useRef(false)
  const lastSave = useRef(0)

  useEffect(() => {
    let alive = true
    Promise.all([loadCatalog(), loadProgress(user.id)]).then(([c, pr]) => {
      if (!alive) return
      setCat(c)
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

  const view = useMemo(() => (cat ? courseFor(cat, progress, user.id) : null), [cat, progress, user.id])

  // first time the whole course is done: remember the date for the certificate
  useEffect(() => {
    if (!view?.finished || prRef.current._certificate_at) return
    prRef.current = { ...prRef.current, _certificate_at: new Date().toISOString() }
    dirty.current = true
    setProgress(prRef.current)
    flush(true)
    toast.success(L('Course completed! 🎓', 'コース修了！🎓', 'Curso concluído! 🎓'))
  }, [view?.finished, flush, L])

  const setP = (id, fn) => {
    const before = prRef.current[id]
    const next = fn(before)
    prRef.current = { ...prRef.current, [id]: next }
    dirty.current = true
    setProgress(prRef.current)
    return { before, next }
  }

  if (!view) return <div className="tr-empty">…</div>

  if (!view.total) {
    return (
      <div className="tr-empty">
        🎓 {L('No lessons yet. The office will add the course here.', 'まだレッスンはありません。事務所がここにコースを追加します。', 'Ainda não há aulas. O escritório vai colocar o curso aqui.')}
      </div>
    )
  }

  const flat = view.modules.flatMap(m => m.lessons.map(l => ({ ...l, module: m })))
  const lesson = open && flat.find(l => l.id === open)

  if (lesson) {
    const p = progress[lesson.id] || {}
    const watched = !!p.done
    const finished = watched && (!lesson.quiz || p.quiz_ok)
    const after = lessonAfter(view, lesson.id)
    const goNext = () => { flush(true); setPick(null); setOpen(after && after.state !== 'locked' ? after.id : null); window.scrollTo?.({ top: 0 }) }
    return (
      <div className="tr-wrap">
        <button type="button" className="tr-back" onClick={() => { flush(true); setPick(null); setOpen(null) }}>‹ {L('Course', 'コース', 'Curso')}</button>
        <div className="tr-crumb">{lesson.module.title} · {L(`Lesson ${lesson.index + 1} of ${lesson.module.total}`, `レッスン ${lesson.index + 1}/${lesson.module.total}`, `Aula ${lesson.index + 1} de ${lesson.module.total}`)}</div>
        <YouTubePlayer
          key={lesson.id}
          videoId={lesson.yt}
          start={p.done ? 0 : Math.max(0, (p.pos || 0) - 2)}
          onTick={t => {
            const { before, next } = setP(lesson.id, prev => tickProgress(prev, t))
            if (next.done && !before?.done) {
              toast.success(lesson.quiz ? L('Watched ✓ Now answer the question below', '視聴完了 ✓ 下の質問に答えてください', 'Assistido ✓ Agora responda a pergunta abaixo') : L('Lesson done ✓', 'レッスン完了 ✓', 'Aula concluída ✓'))
              flush(true)
            } else flush()
          }}
          onPause={({ current }) => { if (current) { setP(lesson.id, prev => ({ ...(prev || {}), pos: current })); flush(true) } }}
          onEnded={({ duration }) => { setP(lesson.id, prev => endProgress(prev, duration)); flush(true) }}
          onError={() => toast.error(L('This video cannot play here. Tell the office.', 'この動画は再生できません。事務所に連絡してください。', 'Este vídeo não abre aqui. Avise o escritório.'))}
        />
        <h2 className="tr-title">{lesson.title}</h2>
        <div className="tr-meta">
          {lesson.required && <span className="tr-req">{L('Required', '必須', 'Obrigatória')}</span>}
          {lesson.duration_s > 0 && <span>{fmtDuration(lesson.duration_s)}</span>}
        </div>
        <Bar p={p} L={L} />
        {lesson.note && <p className="tr-note">{lesson.note}</p>}

        {lesson.quiz && (
          <div className={`tr-quiz${p.quiz_ok ? ' is-ok' : ''}`}>
            <div className="tr-quiz-head">❓ {L('Quick question', '確認クイズ', 'Pergunta rápida')}</div>
            {!watched && !p.quiz_ok
              ? <div className="tr-quiz-lock">🔒 {L('Opens when you finish watching the video.', '動画を最後まで見ると表示されます。', 'Abre quando você terminar de assistir o vídeo.')}</div>
              : (
                <>
                  <div className="tr-quiz-q">{lesson.quiz.q}</div>
                  {lesson.quiz.options.map((o, i) => {
                    const right = p.quiz_ok && i === lesson.quiz.answer
                    const wrong = !p.quiz_ok && pick?.i === i && !pick.ok
                    return (
                      <button key={i} type="button" disabled={p.quiz_ok} className={`tr-opt${right ? ' is-right' : ''}${wrong ? ' is-wrong' : ''}`}
                        onClick={() => {
                          const { p: np, ok } = answerQuiz(prRef.current[lesson.id], lesson, i)
                          setP(lesson.id, () => np)
                          setPick({ i, ok })
                          flush(true)
                          if (ok) toast.success(L('Right! Lesson done ✓', '正解！レッスン完了 ✓', 'Certo! Aula concluída ✓'))
                        }}>
                        {right ? '✓ ' : wrong ? '✕ ' : ''}{o}
                      </button>
                    )
                  })}
                  {pick && !pick.ok && !p.quiz_ok && <div className="tr-quiz-try">{L('Not this one. Try again — if in doubt, watch the video again.', '違います。もう一度。迷ったら動画をもう一度見てください。', 'Não é essa. Tente de novo — se tiver dúvida, assista o vídeo de novo.')}</div>}
                </>
              )}
          </div>
        )}

        {finished && (after
          ? <button type="button" className="tr-cta" onClick={goNext}>{L('Next lesson', '次のレッスン', 'Próxima aula')} › <small>{after.title}</small></button>
          : <button type="button" className="tr-cta" onClick={goNext}>🎓 {L('Back to the course', 'コースに戻る', 'Voltar ao curso')}</button>)}
      </div>
    )
  }

  const pct = Math.round(view.pct * 100)
  return (
    <div className="tr-wrap">
      <div className="tr-hero">
        <div className="tr-hero-top">
          <div>
            <div className="tr-hero-title">{view.course.title}</div>
            {view.course.description && <div className="tr-hero-desc">{view.course.description}</div>}
          </div>
          <div className="tr-ring" style={{ '--p': pct }}><span>{pct}%</span></div>
        </div>
        <div className="tr-meta">
          <span>{view.modules.length} {L('modules', 'モジュール', 'módulos')}</span>
          <span>{view.done}/{view.total} {L('lessons', 'レッスン', 'aulas')}</span>
          {view.seconds > 0 && <span>⏱ {fmtTotal(view.seconds)}</span>}
          {view.requiredLeft > 0 && <span className="tr-req">{L(`${view.requiredLeft} required left`, `必須あと${view.requiredLeft}`, `faltam ${view.requiredLeft} obrigatórias`)}</span>}
        </div>
        {view.next
          ? <button type="button" className="tr-cta" onClick={() => setOpen(view.next.id)}>
              ▶ {view.done ? L('Continue', '続きから', 'Continuar') : L('Start the course', 'コースを始める', 'Começar o curso')}
              <small>{view.next.module.title} · {view.next.title}</small>
            </button>
          : view.finished && (
            <button type="button" className="tr-cta is-gold" onClick={() => showPrintOverlay(certificateHtml({ name: user.name || '', course: view.course, view, at: view.certificateAt, L }))}>
              🎓 {L('Course completed — see my certificate', 'コース修了 — 修了証を見る', 'Curso concluído — ver meu certificado')}
            </button>
          )}
      </div>

      {view.modules.map((m, mi) => {
        const isOpen = expanded === m.id || (expanded == null && view.next?.module.id === m.id)
        return (
          <div key={m.id} className={`tr-mod${m.complete ? ' is-done' : ''}`}>
            <button type="button" className="tr-mod-head" onClick={() => setExpanded(isOpen ? '' : m.id)} aria-expanded={isOpen}>
              <span className="tr-mod-num">{m.complete ? '✓' : mi + 1}</span>
              <span className="tr-mod-copy">
                <b>{m.title}</b>
                <span>{m.done}/{m.total} {L('lessons', 'レッスン', 'aulas')}{m.sequential ? '' : ` · ${L('any order', '順不同', 'qualquer ordem')}`}</span>
                <span className="tr-mini"><span style={{ width: `${Math.round((m.done / m.total) * 100)}%` }} /></span>
              </span>
              <span className="tr-chev">{isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen && (
              <div className="tr-mod-body">
                {m.description && <p className="tr-mod-desc">{m.description}</p>}
                {m.lessons.map(l => (
                  <button key={l.id} type="button" disabled={l.state === 'locked'} className={`tr-card is-${l.state}`} onClick={() => setOpen(l.id)}>
                    <span className="tr-thumb">
                      <img src={l.thumb} alt="" loading="lazy" />
                      {l.duration_s > 0 && <em>{fmtDuration(l.duration_s)}</em>}
                      {l.state === 'done' && <i>✓</i>}
                      {l.state === 'locked' && <i className="lk">🔒</i>}
                    </span>
                    <span className="tr-card-copy">
                      <span className="tr-card-title">{l.index + 1}. {l.title}</span>
                      <span className="tr-meta">
                        {l.state === 'done' && <span className="tr-ok">✓ {L('Done', '完了', 'Concluída')}</span>}
                        {l.state === 'doing' && (l.p.done && l.quiz && !l.p.quiz_ok
                          ? <span>❓ {L('answer the question', '質問に回答', 'responder a pergunta')}</span>
                          : <span>{Math.round((l.p.pct || 0) * 100)}% · {L('continue', '続きから', 'continuar')}</span>)}
                        {l.state === 'open' && <span>▶ {L('Not started', '未視聴', 'Não começou')}</span>}
                        {l.state === 'locked' && <span>🔒 {L('Finish the previous lesson', '前のレッスンを完了してください', 'Termine a aula anterior')}</span>}
                        {l.required && l.state !== 'done' && <span className="tr-req">{L('Required', '必須', 'Obrigatória')}</span>}
                        {l.quiz && <span>❓</span>}
                      </span>
                      {l.state === 'doing' && !l.p.done && <span className="tr-mini"><span style={{ width: `${Math.round((l.p.pct || 0) * 100)}%` }} /></span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {view.finished && view.next && (
        <button type="button" className="tr-cta is-gold" onClick={() => showPrintOverlay(certificateHtml({ name: user.name || '', course: view.course, view, at: view.certificateAt, L }))}>
          🎓 {L('Required part done — see my certificate', '必須完了 — 修了証を見る', 'Parte obrigatória concluída — ver meu certificado')}
        </button>
      )}
    </div>
  )
}

function Bar({ p, L }) {
  const pct = Math.round((p.pct || 0) * 100)
  return (
    <div className="tr-progress">
      <div className="tr-mini"><span style={{ width: `${p.done ? 100 : pct}%` }} /></div>
      <div>{p.done
        ? <span className="tr-ok">✓ {L('Video watched', '動画視聴済み', 'Vídeo assistido')}</span>
        : L(`${pct}% watched · watch to the end to finish`, `${pct}% 視聴 · 最後まで見ると完了`, `${pct}% assistido · assista até o fim para concluir`)}</div>
    </div>
  )
}
