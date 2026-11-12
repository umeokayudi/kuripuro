// v1.0.190 · Admin "Treinamento": pick the YouTube videos the team must watch (paste links, or
// import a whole playlist/channel when YOUTUBE_API_KEY is set), mark required, choose who sees each,
// order them, and see who watched what. Employees watch in ☰ → Treinamento.
// Tip: upload as "Não listado" on YouTube — only people with the link (the app) can see it.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import YouTubePlayer from '../components/YouTubePlayer'
import EmptyHint from '../components/EmptyHint'
import { importFromYouTube, loadCatalog, loadProgress, saveCatalog, videoInfo, youtubeStatus } from '../lib/trainingVideos'
import { addVideos, fmtDuration, moveVideo, parseYouTube, sortVideos, summary, thumbOf, videoIdsIn, visibleTo } from '../lib/trainingCore'
import './training.css'

export default function Training() {
  const { tr } = useLang()
  const [view, setView] = useState('videos')
  const [list, setList] = useState(null)
  const [emps, setEmps] = useState([])
  const [prog, setProg] = useState({})
  const [paste, setPaste] = useState('')
  const [drafts, setDrafts] = useState([])
  const [busy, setBusy] = useState('')
  const [keyOn, setKeyOn] = useState(null)
  const [edit, setEdit] = useState(null)
  const [watch, setWatch] = useState(null)
  const [cat, setCat] = useState('')
  const [required, setRequired] = useState(true)

  useEffect(() => {
    loadCatalog().then(v => setList(sortVideos(v)))
    supabase.from('employees').select('id,full_name,is_active').eq('is_active', true).order('full_name')
      .then(({ data }) => setEmps(data || []))
    youtubeStatus().then(s => setKeyOn(!!s.apiKey)).catch(() => setKeyOn(false))
  }, [])

  useEffect(() => {
    if (view !== 'progress' || !emps.length) return
    let alive = true
    Promise.all(emps.map(e => loadProgress(e.id).then(p => [e.id, p]))).then(rows => { if (alive) setProg(Object.fromEntries(rows)) })
    return () => { alive = false }
  }, [view, emps])

  const categories = useMemo(() => [...new Set((list || []).map(v => v.category).filter(Boolean))], [list])

  const persist = async next => {
    setBusy('save')
    try { await saveCatalog(next); setList(sortVideos(next)); return true } catch (e) { toast.error(e.message); return false } finally { setBusy('') }
  }

  const lookUp = async () => {
    const text = paste.trim()
    if (!text) return
    const one = parseYouTube(text)
    if (one && !one.videoId && text.split(/\s+/).length === 1) {
      if (!keyOn) { toast.error(tr('To import a playlist or channel, YOUTUBE_API_KEY must be set in Vercel. Paste video links instead.', 'プレイリスト/チャンネルの取り込みにはVercelのYOUTUBE_API_KEYが必要です。動画リンクを貼ってください。', 'Para importar playlist ou canal, a YOUTUBE_API_KEY precisa estar no Vercel. Cole os links dos vídeos.')); return }
      setBusy('look')
      try {
        const r = await importFromYouTube(text)
        setDrafts(r.videos || [])
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
    const r = addVideos(list, drafts.map(d => ({ ...d, category: cat, required })))
    if (!r.added) { toast(tr('Those videos are already in the list.', 'すでに追加済みです。', 'Esses vídeos já estão na lista.')); return }
    if (await persist(r.list)) {
      toast.success(tr(`${r.added} video(s) added`, `${r.added}本追加しました`, `${r.added} vídeo(s) adicionado(s)`))
      setDrafts([]); setPaste('')
    }
  }

  const saveEdit = async () => {
    const next = list.map(v => (v.id === edit.id ? { ...v, ...edit, title: edit.title.trim() || v.title } : v))
    if (await persist(next)) setEdit(null)
  }

  const remove = async v => {
    if (!window.confirm(tr(`Remove "${v.title}" from training?`, `「${v.title}」を研修から外しますか？`, `Tirar "${v.title}" do treinamento?`))) return
    persist(list.filter(x => x.id !== v.id))
  }

  const empName = id => emps.find(e => e.id === id)?.full_name || '?'

  if (!list) return <div style={{ padding: 20 }}>…</div>

  return (
    <div>
      <h2 className="page-head" style={{ marginBottom: 4, fontSize: 22 }}>🎓 {tr('Training', '研修', 'Treinamento')}</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)' }}>
        {tr('YouTube videos the team watches in the app (☰ → Training). Upload them as "Unlisted" on YouTube so only people with the link can see them.',
          'スタッフがアプリ内（☰ → 研修）で見るYouTube動画です。YouTubeでは「限定公開」でアップすると、リンクを知っている人だけが見られます。',
          'Vídeos do YouTube que a equipe assiste no app (☰ → Treinamento). Suba no YouTube como "Não listado": só quem tem o link vê.')}
      </p>

      <div className="tra-tabs">
        <button type="button" className={`btn btn-sm ${view === 'videos' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('videos')}>🎬 {tr('Videos', '動画', 'Vídeos')} ({list.length})</button>
        <button type="button" className={`btn btn-sm ${view === 'progress' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('progress')}>✓ {tr('Who watched', '視聴状況', 'Quem assistiu')}</button>
      </div>

      {view === 'videos' && (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 12, display: 'grid', gap: 10 }}>
            <b>＋ {tr('Add videos', '動画を追加', 'Adicionar vídeos')}</b>
            <textarea rows={3} value={paste} onChange={e => setPaste(e.target.value)} className="input"
              placeholder={tr('Paste one or more YouTube links (one per line) — or a playlist / channel link', 'YouTubeのリンクを1行に1つ貼る（複数可）— プレイリスト/チャンネルのリンクも可', 'Cole um ou mais links do YouTube (um por linha) — ou o link de uma playlist / canal')} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'look' || !paste.trim()} onClick={lookUp}>{busy === 'look' ? '…' : `🔎 ${tr('Find videos', '動画を探す', 'Buscar vídeos')}`}</button>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                {keyOn
                  ? `✓ ${tr('YouTube API on: playlists and channels can be imported (unlisted videos too, if they are in a playlist).', 'YouTube API有効：プレイリスト・チャンネルを取り込めます（限定公開もプレイリストに入れれば可）。', 'API do YouTube ligada: dá para importar playlist e canal (vídeos não listados também, se estiverem numa playlist).')}`
                  : keyOn === false ? `ℹ️ ${tr('Links one by one work now. To import a whole playlist/channel, add YOUTUBE_API_KEY in Vercel.', '動画リンクは今すぐ使えます。プレイリスト/チャンネル一括取り込みはVercelにYOUTUBE_API_KEYを追加。', 'Links um a um já funcionam. Para importar playlist/canal inteiro, coloque a YOUTUBE_API_KEY no Vercel.')}` : ''}
              </span>
            </div>
            {drafts.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                {drafts.map((d, i) => (
                  <div key={d.yt} className="tra-row" style={{ border: '1px solid var(--border,#e5e7eb)', borderRadius: 12 }}>
                    <span className="tr-thumb"><img src={d.thumb} alt="" />{d.duration_s > 0 && <em>{fmtDuration(d.duration_s)}</em>}</span>
                    <div className="tra-body">
                      <input type="text" className="input" value={d.title} placeholder={tr('Title', 'タイトル', 'Título')}
                        onChange={e => setDrafts(ds => ds.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
                      <span style={{ fontSize: 12, color: d.warn ? '#b45309' : 'var(--text2)' }}>{d.warn ? `⚠ ${d.warn}` : d.channel}{list.some(v => v.yt === d.yt) ? ` · ${tr('already in the list', '追加済み', 'já está na lista')}` : ''}</span>
                      <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setDrafts(ds => ds.filter((_, k) => k !== i))}>✕ {tr('Leave out', '除外', 'Tirar')}</button></div>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  <input type="text" className="input" list="tra-cats" value={cat} onChange={e => setCat(e.target.value)} style={{ maxWidth: 220 }}
                    placeholder={tr('Category (e.g. Deep Clean)', 'カテゴリ（例：ディープクリーン）', 'Categoria (ex.: Deep Clean)')} />
                  <datalist id="tra-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                    <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> {tr('Required', '必須', 'Obrigatório')}
                  </label>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'save'} onClick={addDrafts}>✓ {tr(`Add ${drafts.length} to training`, `${drafts.length}本を研修に追加`, `Adicionar ${drafts.length} ao treinamento`)}</button>
                </div>
              </div>
            )}
          </div>

          {!list.length ? (
            <EmptyHint icon="🎓" title={tr('No training videos yet', '研修動画はまだありません', 'Ainda não há vídeos de treinamento')}>
              {tr('Paste a YouTube link above.', '上にYouTubeのリンクを貼ってください。', 'Cole um link do YouTube acima.')}
            </EmptyHint>
          ) : (
            <div className="card" style={{ padding: 4 }}>
              {list.map((v, i) => (
                <div key={v.id} className="tra-row">
                  <button type="button" className="tr-thumb" style={{ border: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setWatch(watch === v.id ? null : v.id)} title={tr('Watch', '再生', 'Assistir')}>
                    <img src={v.thumb} alt="" loading="lazy" />{v.duration_s > 0 && <em>{fmtDuration(v.duration_s)}</em>}
                  </button>
                  <div className="tra-body">
                    {edit?.id === v.id ? (
                      <>
                        <input type="text" className="input" value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} />
                        <input type="text" className="input" list="tra-cats" value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value })} placeholder={tr('Category', 'カテゴリ', 'Categoria')} />
                        <datalist id="tra-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
                        <textarea rows={2} className="input" value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} placeholder={tr('Note for the team (optional)', 'スタッフへのメモ（任意）', 'Recado para a equipe (opcional)')} />
                        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                          <input type="checkbox" checked={edit.required} onChange={e => setEdit({ ...edit, required: e.target.checked })} /> {tr('Required', '必須', 'Obrigatório')}
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
                        <div className="tra-actions">
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'save' || (edit.audience !== 'all' && !edit.audience.length)} onClick={saveEdit}>✓ {tr('Save', '保存', 'Salvar')}</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit(null)}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <b style={{ overflowWrap: 'anywhere' }}>{v.title}</b>
                        <div className="tr-meta">
                          {v.required && <span className="tr-req">{tr('Required', '必須', 'Obrigatório')}</span>}
                          {v.category && <span>{v.category}</span>}
                          <span>👥 {v.audience === 'all' ? tr('Everyone', '全員', 'Todos') : v.audience.map(empName).join(', ')}</span>
                        </div>
                        {v.note && <div style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>{v.note}</div>}
                        <div className="tra-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWatch(watch === v.id ? null : v.id)}>▶ {tr('Watch', '再生', 'Assistir')}</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit({ ...v, note: v.note || '', category: v.category || '' })}>✎ {tr('Edit', '編集', 'Editar')}</button>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={i === 0 || !!busy} onClick={() => persist(moveVideo(list, v.id, -1))}>▲</button>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={i === list.length - 1 || !!busy} onClick={() => persist(moveVideo(list, v.id, 1))}>▼</button>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => remove(v)}>🗑 {tr('Remove', '削除', 'Tirar')}</button>
                        </div>
                        {watch === v.id && <YouTubePlayer videoId={v.yt} />}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === 'progress' && (
        !list.length ? <EmptyHint icon="🎓" title={tr('No training videos yet', '研修動画はまだありません', 'Ainda não há vídeos de treinamento')} /> : (
          <div className="card tra-scroll" style={{ padding: 4 }}>
            <table className="tra-grid">
              <thead>
                <tr>
                  <th>{tr('Person', 'スタッフ', 'Pessoa')}</th>
                  <th>{tr('Done', '完了', 'Feito')}</th>
                  {list.map(v => <th key={v.id} title={v.title}>{v.required ? '★ ' : ''}{v.title.slice(0, 18)}{v.title.length > 18 ? '…' : ''}</th>)}
                </tr>
              </thead>
              <tbody>
                {emps.map(e => {
                  const p = prog[e.id] || {}
                  const s = summary(list, p, e.id)
                  return (
                    <tr key={e.id}>
                      <td>{e.full_name}</td>
                      <td style={{ fontWeight: 700, color: s.requiredLeft ? '#c2410c' : '#15803d' }}>{s.done}/{s.total}{s.requiredLeft ? ` · ${tr(`${s.requiredLeft} req.`, `必須${s.requiredLeft}`, `${s.requiredLeft} obrig.`)}` : ''}</td>
                      {list.map(v => {
                        if (!visibleTo(v, e.id)) return <td key={v.id} style={{ color: '#cbd5e1' }}>·</td>
                        const x = p[v.id]
                        return <td key={v.id} title={x?.done_at ? new Date(x.done_at).toLocaleString() : ''}>
                          {x?.done ? <span className="tr-ok">✓</span> : x?.pct > 0 ? `${Math.round(x.pct * 100)}%` : <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ padding: 8, fontSize: 12, color: 'var(--text2)' }}>★ {tr('required', '必須', 'obrigatório')} · ✓ {tr('watched (90%+ really played)', '視聴済み（実再生90%以上）', 'assistido (90%+ realmente tocado)')} · % {tr('started', '視聴中', 'começou')} · — {tr('not started', '未視聴', 'não começou')}</div>
          </div>
        )
      )}
    </div>
  )
}
