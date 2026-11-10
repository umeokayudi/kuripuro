// v1.0.208 · Admin "Treinamento" as a COURSE builder:
//  📚 Curso       — course name, modules (in order, "liberar em sequência"), lessons from YouTube
//                   (paste links, or import a whole playlist as a module when YOUTUBE_API_KEY is set),
//                   required, who sees it, recado, pergunta rápida (quiz), move between modules.
//  ✓ Quem concluiu — each person × module, total %, certificate date.
//  ⚙ YouTube      — is the API key working, and the simple steps to turn it on.
// Employees take the course in ☰ → Treinamento. Upload videos on YouTube as "Não listado".
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import YouTubePlayer from '../components/YouTubePlayer'
import EmptyHint from '../components/EmptyHint'
import { importFromYouTube, loadCatalog, loadProgress, saveCatalog, videoInfo, youtubeStatus } from '../lib/trainingVideos'
import {
  addLessons, addModule, courseFor, fmtDuration, fmtTotal, lessonToModule, lessonsIn, moveLesson, moveModule,
  normalizeCatalog, parseYouTube, removeLesson, removeModule, thumbOf, updateLesson, updateModule, videoIdsIn,
} from '../lib/trainingCore'
import './training.css'

const NEW = '__new__'

export default function Training() {
  const { tr } = useLang()
  const [view, setView] = useState('course')
  const [cat, setCat] = useState(null)
  const [emps, setEmps] = useState([])
  const [prog, setProg] = useState({})
  const [busy, setBusy] = useState('')
  const [yt, setYt] = useState(null)
  const [courseEdit, setCourseEdit] = useState(null)
  const [modEdit, setModEdit] = useState(null)
  const [edit, setEdit] = useState(null)
  const [watch, setWatch] = useState(null)
  // adding lessons
  const [paste, setPaste] = useState('')
  const [drafts, setDrafts] = useState([])
  const [target, setTarget] = useState('')
  const [newModName, setNewModName] = useState('')
  const [required, setRequired] = useState(true)

  useEffect(() => {
    loadCatalog().then(setCat)
    supabase.from('employees').select('id,full_name,is_active').eq('is_active', true).order('full_name')
      .then(({ data }) => setEmps(data || []))
    youtubeStatus().then(setYt).catch(e => setYt({ apiKey: false, works: false, error: e.message }))
  }, [])

  useEffect(() => {
    if (view !== 'progress' || !emps.length) return
    let alive = true
    Promise.all(emps.map(e => loadProgress(e.id).then(p => [e.id, p]))).then(rows => { if (alive) setProg(Object.fromEntries(rows)) })
    return () => { alive = false }
  }, [view, emps])

  const keyOn = !!yt?.works

  const persist = async next => {
    setBusy('save')
    try { const c = normalizeCatalog(next); await saveCatalog(c); setCat(c); return true } catch (e) { toast.error(e.message); return false } finally { setBusy('') }
  }

  const stats = useMemo(() => {
    if (!cat) return {}
    const out = {}
    for (const m of cat.modules) {
      const ls = lessonsIn(cat, m.id)
      out[m.id] = { n: ls.length, s: ls.reduce((t, v) => t + (v.duration_s || 0), 0) }
    }
    return out
  }, [cat])

  const lookUp = async () => {
    const text = paste.trim()
    if (!text) return
    const one = parseYouTube(text)
    if (one && !one.videoId && text.split(/\s+/).length === 1) {
      if (!keyOn) { toast.error(tr('To import a playlist or channel, turn on the YouTube API (⚙ YouTube tab). Paste video links instead.', 'プレイリスト/チャンネル取り込みには YouTube API が必要です（⚙ YouTube タブ）。', 'Para importar playlist ou canal, ative a API do YouTube (aba ⚙ YouTube). Ou cole os links dos vídeos.')); setView('youtube'); return }
      setBusy('look')
      try {
        const r = await importFromYouTube(text)
        setDrafts(r.videos || [])
        if (r.from) { setTarget(NEW); setNewModName(r.from) }
        if (!r.videos?.length) toast(tr('No videos found there.', '動画が見つかりません。', 'Nenhum vídeo encontrado.'))
      } catch (e) { toast.error(e.message) }
      setBusy('')
      return
    }
    const ids = videoIdsIn(text)
    if (!ids.length) { toast.error(tr('No YouTube link found.', 'YouTubeのリンクが見つかりません。', 'Não achei link do YouTube.')); return }
    setBusy('look')
    const found = []
    for (const id of ids) {
      try { found.push(await videoInfo(id)) } catch (e) { found.push({ yt: id, title: '', thumb: thumbOf(id), warn: e.message }) }
    }
    setDrafts(found)
    setBusy('')
  }

  const addDrafts = async () => {
    let next = cat
    let moduleId = target
    if (!moduleId || moduleId === NEW) {
      const name = newModName.trim() || tr('Module', 'モジュール', 'Módulo') + ` ${cat.modules.length + 1}`
      const r = addModule(next, { title: name })
      next = r.cat; moduleId = r.module.id
    }
    const r = addLessons(next, moduleId, drafts.map(d => ({ ...d, required })))
    if (!r.added) { toast(tr('Those videos are already in the course.', 'すでに追加済みです。', 'Esses vídeos já estão no curso.')); return }
    if (await persist(r.cat)) {
      toast.success(tr(`${r.added} lesson(s) added`, `${r.added}本追加しました`, `${r.added} aula(s) adicionada(s)`))
      setDrafts([]); setPaste(''); setNewModName(''); setTarget(moduleId)
    }
  }

  const empName = id => emps.find(e => e.id === id)?.full_name || '?'
  const tab = k => `btn btn-sm ${view === k ? 'btn-primary' : 'btn-secondary'}`

  if (!cat) return <div style={{ padding: 20 }}>…</div>

  const moduleOptions = (
    <>
      {cat.modules.map((m, i) => <option key={m.id} value={m.id}>{i + 1}. {m.title}</option>)}
      <option value={NEW}>＋ {tr('New module…', '新しいモジュール…', 'Novo módulo…')}</option>
    </>
  )
  const targetVal = target && (target === NEW || cat.modules.some(m => m.id === target)) ? target : (cat.modules[cat.modules.length - 1]?.id || NEW)

  return (
    <div>
      <h2 className="page-head" style={{ marginBottom: 4, fontSize: 22 }}>🎓 {tr('Training', '研修', 'Treinamento')}</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)' }}>
        {tr('A course the team takes in the app (☰ → Training): modules, lessons from YouTube, a quick question after each lesson and a certificate at the end. Upload the videos as "Unlisted" on YouTube.',
          'スタッフがアプリ内（☰ → 研修）で受けるコースです：モジュール、YouTubeのレッスン、確認クイズ、修了証。動画はYouTubeに「限定公開」でアップしてください。',
          'Um curso que a equipe faz no app (☰ → Treinamento): módulos, aulas do YouTube, pergunta rápida depois da aula e certificado no final. Suba os vídeos no YouTube como "Não listado".')}
      </p>

      <div className="tra-tabs">
        <button type="button" className={tab('course')} onClick={() => setView('course')}>📚 {tr('Course', 'コース', 'Curso')} ({cat.modules.length} · {cat.videos.length})</button>
        <button type="button" className={tab('progress')} onClick={() => setView('progress')}>✓ {tr('Who completed', '修了状況', 'Quem concluiu')}</button>
        <button type="button" className={tab('youtube')} onClick={() => setView('youtube')}>
          ⚙ YouTube {yt && <span style={{ marginLeft: 4 }}>{keyOn ? '🟢' : '🟡'}</span>}
        </button>
      </div>

      {view === 'course' && (
        <>
          {/* course name */}
          <div className="card" style={{ padding: 14, marginBottom: 12, display: 'grid', gap: 8 }}>
            {courseEdit ? (
              <>
                <label className="tra-field">{tr('Course name', 'コース名', 'Nome do curso')}
                  <input className="tra-input" value={courseEdit.title} onChange={e => setCourseEdit({ ...courseEdit, title: e.target.value })} /></label>
                <label className="tra-field">{tr('What the team will learn (optional)', '学ぶ内容（任意）', 'O que a equipe vai aprender (opcional)')}
                  <textarea className="tra-input" rows={2} value={courseEdit.description} onChange={e => setCourseEdit({ ...courseEdit, description: e.target.value })} /></label>
                <div className="tra-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'save'} onClick={async () => { if (await persist({ ...cat, course: { title: courseEdit.title.trim() || cat.course.title, description: courseEdit.description.trim() } })) setCourseEdit(null) }}>✓ {tr('Save', '保存', 'Salvar')}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCourseEdit(null)}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{cat.course.title}</div>
                  {cat.course.description && <div style={{ fontSize: 13, color: 'var(--text2)' }}>{cat.course.description}</div>}
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                    {cat.modules.length} {tr('modules', 'モジュール', 'módulos')} · {cat.videos.length} {tr('lessons', 'レッスン', 'aulas')}
                    {cat.videos.some(v => v.duration_s) ? ` · ⏱ ${fmtTotal(cat.videos.reduce((t, v) => t + (v.duration_s || 0), 0))}` : ''}
                  </div>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCourseEdit({ ...cat.course })}>✎ {tr('Rename course', 'コース名を変更', 'Renomear curso')}</button>
              </div>
            )}
          </div>

          {/* add lessons */}
          <div className="card" style={{ padding: 14, marginBottom: 12, display: 'grid', gap: 10 }}>
            <b>＋ {tr('Add lessons', 'レッスンを追加', 'Adicionar aulas')}</b>
            <textarea rows={3} value={paste} onChange={e => setPaste(e.target.value)} className="tra-input"
              placeholder={tr('Paste one or more YouTube links (one per line) — or a playlist link to import it as a module', 'YouTubeのリンクを1行に1つ — プレイリストのリンクでモジュールごと取り込み', 'Cole um ou mais links do YouTube (um por linha) — ou o link de uma playlist para virar um módulo inteiro')} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'look' || !paste.trim()} onClick={lookUp}>{busy === 'look' ? '…' : `🔎 ${tr('Find videos', '動画を探す', 'Buscar vídeos')}`}</button>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                {keyOn
                  ? `🟢 ${tr('YouTube API on: playlists import as a whole module.', 'YouTube API 有効：プレイリストをモジュールとして取り込めます。', 'API do YouTube ligada: playlist entra como módulo inteiro.')}`
                  : yt ? <>🟡 {tr('Links one by one work now.', 'リンクは1本ずつ使えます。', 'Links um a um já funcionam.')} <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 4 }} onClick={() => setView('youtube')}>{tr('Turn on playlist import', 'プレイリスト取り込みを有効化', 'Ativar importar playlist')}</button></> : ''}
              </span>
            </div>
            {drafts.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                {drafts.map((d, i) => (
                  <div key={d.yt} className="tra-row" style={{ border: '1px solid var(--border,#e5e7eb)', borderRadius: 12 }}>
                    <span className="tr-thumb"><img src={d.thumb} alt="" />{d.duration_s > 0 && <em>{fmtDuration(d.duration_s)}</em>}</span>
                    <div className="tra-body">
                      <input type="text" className="tra-input" value={d.title} placeholder={tr('Lesson title', 'レッスン名', 'Título da aula')}
                        onChange={e => setDrafts(ds => ds.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
                      <span style={{ fontSize: 12, color: d.warn ? '#b45309' : 'var(--text2)' }}>{d.warn ? `⚠ ${d.warn}` : d.channel}{cat.videos.some(v => v.yt === d.yt) ? ` · ${tr('already in the course', '追加済み', 'já está no curso')}` : ''}</span>
                      <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setDrafts(ds => ds.filter((_, k) => k !== i))}>✕ {tr('Leave out', '除外', 'Tirar')}</button></div>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  <label className="tra-field" style={{ minWidth: 200 }}>{tr('Into module', '追加先モジュール', 'No módulo')}
                    <select className="tra-input" value={targetVal} onChange={e => setTarget(e.target.value)}>{moduleOptions}</select>
                  </label>
                  {targetVal === NEW && (
                    <label className="tra-field" style={{ minWidth: 220 }}>{tr('New module name', '新しいモジュール名', 'Nome do novo módulo')}
                      <input className="tra-input" value={newModName} onChange={e => setNewModName(e.target.value)} placeholder={tr('e.g. Deep Clean — basics', '例：ディープクリーン基礎', 'ex.: Deep Clean — básico')} />
                    </label>
                  )}
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 16 }}>
                    <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> {tr('Required', '必須', 'Obrigatória')}
                  </label>
                  <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 16 }} disabled={busy === 'save'} onClick={addDrafts}>✓ {tr(`Add ${drafts.length} lesson(s)`, `${drafts.length}本追加`, `Adicionar ${drafts.length} aula(s)`)}</button>
                </div>
              </div>
            )}
          </div>

          {!cat.modules.length ? (
            <EmptyHint icon="🎓" title={tr('The course is empty', 'コースはまだ空です', 'O curso ainda está vazio')}>
              {tr('Paste a YouTube link above: it becomes lesson 1 of module 1.', '上にYouTubeのリンクを貼ると、モジュール1のレッスン1になります。', 'Cole um link do YouTube acima: ele vira a aula 1 do módulo 1.')}
            </EmptyHint>
          ) : cat.modules.map((m, mi) => {
            const ls = lessonsIn(cat, m.id)
            return (
              <div key={m.id} className="tra-mod">
                <div className="tra-mod-head">
                  <span className="tr-mod-num">{mi + 1}</span>
                  {modEdit?.id === m.id ? (
                    <div className="tra-mod-title" style={{ gap: 6 }}>
                      <input className="tra-input" value={modEdit.title} onChange={e => setModEdit({ ...modEdit, title: e.target.value })} />
                      <textarea className="tra-input" rows={2} value={modEdit.description} onChange={e => setModEdit({ ...modEdit, description: e.target.value })} placeholder={tr('What this module teaches (optional)', 'このモジュールの内容（任意）', 'O que este módulo ensina (opcional)')} />
                      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                        <input type="checkbox" checked={modEdit.sequential} onChange={e => setModEdit({ ...modEdit, sequential: e.target.checked })} />
                        {tr('Open lessons in order (next one opens when the previous is done)', '順番に開放（前のレッスン完了で次が開く）', 'Liberar aulas em sequência (a próxima abre quando terminar a anterior)')}
                      </label>
                      <div className="tra-actions">
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'save'} onClick={async () => { if (await persist(updateModule(cat, m.id, { title: modEdit.title.trim() || m.title, description: modEdit.description.trim(), sequential: modEdit.sequential }))) setModEdit(null) }}>✓ {tr('Save', '保存', 'Salvar')}</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModEdit(null)}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="tra-mod-title">
                        <b>{m.title}</b>
                        <span>{stats[m.id]?.n || 0} {tr('lessons', 'レッスン', 'aulas')}{stats[m.id]?.s ? ` · ⏱ ${fmtTotal(stats[m.id].s)}` : ''} · {m.sequential ? `🔒 ${tr('in order', '順番に開放', 'em sequência')}` : tr('any order', '順不同', 'qualquer ordem')}</span>
                        {m.description && <span>{m.description}</span>}
                      </div>
                      <div className="tra-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModEdit({ ...m })}>✎ {tr('Edit', '編集', 'Editar')}</button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={mi === 0 || !!busy} onClick={() => persist(moveModule(cat, m.id, -1))}>▲</button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={mi === cat.modules.length - 1 || !!busy} onClick={() => persist(moveModule(cat, m.id, 1))}>▼</button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => {
                          if (window.confirm(tr(`Delete module "${m.title}" and its ${ls.length} lesson(s)?`, `モジュール「${m.title}」と${ls.length}本のレッスンを削除しますか？`, `Apagar o módulo "${m.title}" e suas ${ls.length} aula(s)?`))) persist(removeModule(cat, m.id))
                        }}>🗑</button>
                      </div>
                    </>
                  )}
                </div>

                {!ls.length && <div style={{ padding: 12, fontSize: 13, color: 'var(--text2)' }}>{tr('No lessons yet — add above choosing this module.', 'まだレッスンがありません。上でこのモジュールを選んで追加してください。', 'Sem aulas ainda — adicione acima escolhendo este módulo.')}</div>}
                {ls.map((v, i) => (
                  <div key={v.id} className="tra-row">
                    <button type="button" className="tr-thumb" style={{ border: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setWatch(watch === v.id ? null : v.id)} title={tr('Watch', '再生', 'Assistir')}>
                      <img src={v.thumb} alt="" loading="lazy" />{v.duration_s > 0 && <em>{fmtDuration(v.duration_s)}</em>}
                    </button>
                    <div className="tra-body">
                      {edit?.id === v.id ? (
                        <LessonForm edit={edit} setEdit={setEdit} cat={cat} emps={emps} tr={tr} busy={busy}
                          onSave={async () => {
                            let next = updateLesson(cat, v.id, { title: edit.title.trim() || v.title, note: edit.note, required: edit.required, audience: edit.audience, quiz: edit.quizOn ? edit.quiz : null })
                            if (edit.module_id !== v.module_id) next = lessonToModule(next, v.id, edit.module_id)
                            if (await persist(next)) setEdit(null)
                          }} />
                      ) : (
                        <>
                          <b style={{ overflowWrap: 'anywhere' }}>{i + 1}. {v.title}</b>
                          <div className="tr-meta">
                            {v.required ? <span className="tr-req">{tr('Required', '必須', 'Obrigatória')}</span> : <span>{tr('Optional', '任意', 'Opcional')}</span>}
                            {v.quiz && <span>❓ {tr('has a question', 'クイズあり', 'tem pergunta')}</span>}
                            <span>👥 {v.audience === 'all' ? tr('Everyone', '全員', 'Todos') : v.audience.map(empName).join(', ')}</span>
                          </div>
                          {v.note && <div style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>{v.note}</div>}
                          <div className="tra-actions">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWatch(watch === v.id ? null : v.id)}>▶ {tr('Watch', '再生', 'Assistir')}</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit({ ...v, note: v.note || '', quizOn: !!v.quiz, quiz: v.quiz || { q: '', options: ['', '', ''], answer: 0 } })}>✎ {tr('Edit / question', '編集・クイズ', 'Editar / pergunta')}</button>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={i === 0 || !!busy} onClick={() => persist(moveLesson(cat, v.id, -1))}>▲</button>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={i === ls.length - 1 || !!busy} onClick={() => persist(moveLesson(cat, v.id, 1))}>▼</button>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => {
                              if (window.confirm(tr(`Remove "${v.title}"?`, `「${v.title}」を削除しますか？`, `Tirar "${v.title}"?`))) persist(removeLesson(cat, v.id))
                            }}>🗑</button>
                          </div>
                          {watch === v.id && <YouTubePlayer videoId={v.yt} />}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
          {cat.modules.length > 0 && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={async () => {
              const r = addModule(cat, { title: `${tr('Module', 'モジュール', 'Módulo')} ${cat.modules.length + 1}` })
              if (await persist(r.cat)) { setModEdit({ ...r.module }); setTarget(r.module.id) }
            }}>＋ {tr('New module', '新しいモジュール', 'Novo módulo')}</button>
          )}
        </>
      )}

      {view === 'progress' && (
        !cat.videos.length ? <EmptyHint icon="🎓" title={tr('The course is empty', 'コースはまだ空です', 'O curso ainda está vazio')} /> : (
          <div className="card tra-scroll" style={{ padding: 4 }}>
            <table className="tra-grid">
              <thead>
                <tr>
                  <th>{tr('Person', 'スタッフ', 'Pessoa')}</th>
                  <th>{tr('Course', 'コース', 'Curso')}</th>
                  {cat.modules.map((m, i) => <th key={m.id} title={m.title}>{i + 1}. {m.title.slice(0, 16)}{m.title.length > 16 ? '…' : ''}</th>)}
                  <th>🎓</th>
                </tr>
              </thead>
              <tbody>
                {emps.map(e => {
                  const p = prog[e.id] || {}
                  const v = courseFor(cat, p, e.id)
                  return (
                    <tr key={e.id}>
                      <td>{e.full_name}</td>
                      <td style={{ fontWeight: 800, color: v.finished ? '#15803d' : v.done ? '#c2410c' : '#94a3b8' }}>{Math.round(v.pct * 100)}% <span style={{ fontWeight: 500 }}>({v.done}/{v.total})</span></td>
                      {cat.modules.map(m => {
                        const vm = v.modules.find(x => x.id === m.id)
                        if (!vm) return <td key={m.id} style={{ color: '#cbd5e1' }}>·</td>
                        return <td key={m.id} title={vm.lessons.map(l => `${l.state === 'done' ? '✓' : l.state === 'doing' ? '…' : '—'} ${l.title}`).join('\n')}>
                          {vm.complete ? <span className="tr-ok">✓</span> : vm.done ? `${vm.done}/${vm.total}` : <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                      })}
                      <td>{p._certificate_at ? new Date(p._certificate_at).toLocaleDateString() : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ padding: 8, fontSize: 12, color: 'var(--text2)' }}>✓ {tr('module completed', 'モジュール修了', 'módulo concluído')} · 2/5 {tr('lessons done', 'レッスン完了', 'aulas feitas')} · — {tr('not started', '未開始', 'não começou')} · 🎓 {tr('certificate date', '修了日', 'data do certificado')} · {tr('Hover a cell to see each lesson.', 'セルにカーソルで各レッスン表示。', 'Passe o mouse na célula para ver cada aula.')}</div>
          </div>
        )
      )}

      {view === 'youtube' && <YouTubeSetup yt={yt} tr={tr} onRecheck={() => { setYt(null); youtubeStatus().then(setYt).catch(e => setYt({ apiKey: false, works: false, error: e.message })) }} />}
    </div>
  )
}

function LessonForm({ edit, setEdit, cat, emps, tr, busy, onSave }) {
  const q = edit.quiz
  const setQ = patch => setEdit({ ...edit, quiz: { ...q, ...patch } })
  return (
    <>
      <label className="tra-field">{tr('Lesson title', 'レッスン名', 'Título da aula')}<input className="tra-input" value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label>
      <label className="tra-field">{tr('Module', 'モジュール', 'Módulo')}
        <select className="tra-input" value={edit.module_id} onChange={e => setEdit({ ...edit, module_id: e.target.value })}>
          {cat.modules.map((m, i) => <option key={m.id} value={m.id}>{i + 1}. {m.title}</option>)}
        </select>
      </label>
      <label className="tra-field">{tr('Note for the team (optional)', 'スタッフへのメモ（任意）', 'Recado para a equipe (opcional)')}<textarea rows={2} className="tra-input" value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} /></label>
      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" checked={edit.required} onChange={e => setEdit({ ...edit, required: e.target.checked })} /> {tr('Required (counts for the certificate)', '必須（修了証に必要）', 'Obrigatória (conta para o certificado)')}
      </label>
      <div style={{ fontSize: 13 }}>
        <label style={{ marginRight: 12 }}><input type="radio" checked={edit.audience === 'all'} onChange={() => setEdit({ ...edit, audience: 'all' })} /> {tr('Everyone', '全員', 'Todos')}</label>
        <label><input type="radio" checked={edit.audience !== 'all'} onChange={() => setEdit({ ...edit, audience: [] })} /> {tr('Only these people', '選んだ人だけ', 'Só estas pessoas')}</label>
      </div>
      {edit.audience !== 'all' && (
        <div className="tra-who">
          {emps.map(e => (
            <label key={e.id}>
              <input type="checkbox" checked={edit.audience.includes(e.id)}
                onChange={ev => setEdit({ ...edit, audience: ev.target.checked ? [...edit.audience, e.id] : edit.audience.filter(x => x !== e.id) })} />
              {e.full_name}
            </label>
          ))}
        </div>
      )}
      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 700 }}>
        <input type="checkbox" checked={edit.quizOn} onChange={e => setEdit({ ...edit, quizOn: e.target.checked })} /> ❓ {tr('Quick question after the video', '動画のあとに確認クイズ', 'Pergunta rápida depois do vídeo')}
      </label>
      {edit.quizOn && (
        <div style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 10, background: 'rgba(49,92,245,.05)' }}>
          <input className="tra-input" value={q.q} onChange={e => setQ({ q: e.target.value })} placeholder={tr('Question (e.g. Which product goes on the hood filter?)', '質問', 'Pergunta (ex.: Qual produto vai no filtro da coifa?)')} />
          {q.options.map((o, i) => (
            <div key={i} className="tra-quiz-opt">
              <input type="radio" name={`ans-${edit.id}`} checked={q.answer === i} onChange={() => setQ({ answer: i })} title={tr('Right answer', '正解', 'Resposta certa')} />
              <input className="tra-input" value={o} onChange={e => setQ({ options: q.options.map((x, k) => (k === i ? e.target.value : x)) })} placeholder={`${tr('Option', '選択肢', 'Opção')} ${i + 1}`} />
              {q.options.length > 2 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQ({ options: q.options.filter((_, k) => k !== i), answer: q.answer === i ? 0 : q.answer > i ? q.answer - 1 : q.answer })}>✕</button>}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {q.options.length < 5 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQ({ options: [...q.options, ''] })}>＋ {tr('Option', '選択肢', 'Opção')}</button>}
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>◉ = {tr('right answer', '正解', 'resposta certa')}</span>
          </div>
        </div>
      )}
      <div className="tra-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'save' || (edit.audience !== 'all' && !edit.audience.length)} onClick={onSave}>✓ {tr('Save', '保存', 'Salvar')}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit(null)}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
      </div>
    </>
  )
}

function YouTubeSetup({ yt, tr, onRecheck }) {
  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 16 }}>{tr('YouTube connection', 'YouTube接続', 'Conexão com o YouTube')}</b>
        {!yt ? <span className="tra-status no">…</span>
          : yt.works ? <span className="tra-status ok">🟢 {tr('API on and working', 'API 有効・正常', 'API ligada e funcionando')}</span>
            : yt.apiKey ? <span className="tra-status err">🔴 {tr('Key set but YouTube refused it', 'キーはあるがYouTubeが拒否', 'Chave colocada, mas o YouTube recusou')}</span>
              : <span className="tra-status no">🟡 {tr('Not on yet (optional)', '未設定（任意）', 'Ainda não ligada (opcional)')}</span>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRecheck}>↻ {tr('Check again', '再確認', 'Verificar de novo')}</button>
      </div>
      {yt?.error && <div style={{ fontSize: 13, color: '#991b1b' }}>YouTube: {yt.error}</div>}
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
        <b>{tr('What already works without anything:', '設定なしで使えるもの：', 'O que já funciona sem nada:')}</b> {tr('pasting video links, the player inside the app, real watch time, questions and certificate.', '動画リンクの貼り付け、アプリ内再生、実視聴時間、クイズ、修了証。', 'colar link de vídeo, o player dentro do app, tempo assistido de verdade, perguntas e certificado.')}<br />
        <b>{tr('What the API adds:', 'APIで追加されるもの：', 'O que a API acrescenta:')}</b> {tr('import a whole playlist as a module (unlisted videos too) and show each lesson length.', 'プレイリストをモジュールごと取り込み（限定公開も可）、各レッスンの長さ表示。', 'importar uma playlist inteira como módulo (vídeos não listados também) e mostrar a duração de cada aula.')}
      </div>
      <ol className="tra-steps">
        <li>{tr('Open', '開く', 'Abra')} <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">console.cloud.google.com → YouTube Data API v3</a> {tr('with your Google account and tap', 'にGoogleアカウントでログインし', 'com sua conta Google e toque em')} <b>{tr('Enable', '有効にする', 'Ativar')}</b>. {tr('(If it asks, create a project named "Kuripuro".)', '（求められたら「Kuripuro」というプロジェクトを作成）', '(Se pedir, crie um projeto chamado "Kuripuro".)')}</li>
        <li>{tr('Go to', '移動', 'Vá em')} <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">{tr('Credentials', '認証情報', 'Credenciais')}</a> → <b>{tr('Create credentials → API key', '認証情報を作成 → APIキー', 'Criar credenciais → Chave de API')}</b>. {tr('Copy the key.', 'キーをコピー。', 'Copie a chave.')}</li>
        <li>{tr('(Recommended) Edit the key → API restrictions → only "YouTube Data API v3".', '（推奨）キーを編集 → APIの制限 →「YouTube Data API v3」のみ。', '(Recomendado) Edite a chave → Restrições de API → só "YouTube Data API v3".')}</li>
        <li>{tr('In Vercel: project kuripuro → Settings → Environment Variables → add', 'Vercel：プロジェクト kuripuro → Settings → Environment Variables →', 'No Vercel: projeto kuripuro → Settings → Environment Variables → adicione')} <code>YOUTUBE_API_KEY</code> = {tr('the key', 'キー', 'a chave')} ({tr('Production and Preview', 'Production と Preview', 'Production e Preview')}).</li>
        <li>{tr('Redeploy (or Promote the next version) and tap "Check again" here — it turns 🟢.', '再デプロイ（または次のバージョンをPromote）してここで「再確認」→ 🟢 になります。', 'Faça o Redeploy (ou dê Promote na próxima versão) e toque em "Verificar de novo" aqui — fica 🟢.')}</li>
      </ol>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>
        {tr('Free: YouTube gives 10,000 units a day; importing a playlist uses about 3. Tip: keep each module as one unlisted playlist on your channel.', '無料：1日10,000ユニット、プレイリスト取り込みは約3。ヒント：モジュールごとに限定公開プレイリストを作ると便利。', 'Grátis: o YouTube dá 10.000 unidades por dia; importar uma playlist gasta umas 3. Dica: faça cada módulo como uma playlist não listada no seu canal.')}
      </div>
    </div>
  )
}
