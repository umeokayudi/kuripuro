// v1.0.142 · Admin "Videos": every video the team sent when finishing a service, in one place.
// Watch, download, or send it to the client (share sheet on the phone / link that never expires).
// Videos stay in Supabase Storage (service-photos/jobs/<jobId>/video_n.*); this page only reads them.
//
// How it finds them fast: each job with a video has a tiny public jobs/<id>/video_status.json.
// We read those 12 at a time straight from the storage CDN (no server function in between) and
// show each video as soon as it is found, with a progress line, so the page never sits empty.
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { downloadVideo, listJobVideos, readVideoStatus, videoFileName } from '../lib/jobVideo'
import { tokyoToday } from '../lib/dates'
import { useLang } from '../hooks/useLang'
import EmptyHint from '../components/EmptyHint'

const BUCKET = 'service-photos'
const PERIODS = [7, 30, 90]
const PARALLEL = 12
const mb = n => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : '')
const publicUrl = path => supabase.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null
const posterOf = path => publicUrl(path.replace(/\.[a-z0-9]+$/i, '.jpg'))
const placeOf = job => String(job.title || job.client_name || '').replace(/ — .*/, '')
const baseName = job => `${job.scheduled_date || ''}_${placeOf(job)}_${job.employee_name || ''}`

function shiftDate(ymd, days) {
  const d = new Date(`${ymd}T12:00:00+09:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const fmtDay = (ymd, lang) => {
  try {
    return new Date(`${ymd}T12:00:00+09:00`).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Tokyo' })
  } catch { return ymd }
}

/** Sends the file itself (LINE, WhatsApp, Mail…) when the device can; otherwise copies the link. */
async function sendToClient(v, tr) {
  const link = publicUrl(v.path) || v.url
  const text = tr(`Cleaning video — ${placeOf(v.job)} (${v.job.scheduled_date})`, `清掃動画 — ${placeOf(v.job)}（${v.job.scheduled_date}）`, `Vídeo da limpeza — ${placeOf(v.job)} (${v.job.scheduled_date})`)
  try {
    if (navigator.canShare && v.size && v.size < 30 * 1024 * 1024) {
      const r = await fetch(v.url)
      if (r.ok) {
        const blob = await r.blob()
        const file = new File([blob], v.file_name, { type: blob.type || 'video/mp4' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: text, text })
          return 'shared'
        }
      }
    }
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ title: text, text, url: link })
      return 'shared'
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled'
  }
  await copyLink(link)
  return 'copied'
}

async function copyLink(link) {
  try { await navigator.clipboard.writeText(link) } catch {
    const ta = document.createElement('textarea')
    ta.value = link; document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    ta.remove()
  }
}

export default function Videos() {
  const { tr, lang } = useLang()
  const today = tokyoToday()
  const [days, setDays] = useState(30)
  const [range, setRange] = useState({ from: shiftDate(today, -30), to: today })
  const [custom, setCustom] = useState(false)
  const [rows, setRows] = useState([])
  const [scan, setScan] = useState({ done: 0, total: 0, running: true, failed: 0 })
  const [error, setError] = useState('')
  const [who, setWho] = useState('')
  const [client, setClient] = useState('')
  const [q, setQ] = useState('')
  const [order, setOrder] = useState('new')
  const [playing, setPlaying] = useState(null)
  const [busy, setBusy] = useState(null)
  const runId = useRef(0)

  const pickDays = n => { setCustom(false); setDays(n); setRange({ from: shiftDate(today, -n), to: today }) }

  useEffect(() => {
    const id = ++runId.current
    const alive = () => runId.current === id
    setRows([]); setError(''); setPlaying(null); setScan({ done: 0, total: 0, running: true, failed: 0 })
    ;(async () => {
      const { data: jobs, error: err } = await supabase.from('jobs')
        .select('id,title,client_name,employee_name,scheduled_date,completed_at')
        .eq('status', 'completed').gte('scheduled_date', range.from).lte('scheduled_date', range.to)
        .order('scheduled_date', { ascending: false }).limit(1500)
      if (err) throw err
      if (!alive()) return
      const list = jobs || []
      setScan(s => ({ ...s, total: list.length }))
      let i = 0, done = 0, failed = 0
      const worker = async () => {
        while (i < list.length && alive()) {
          const job = list[i++]
          const st = await readVideoStatus(job.id)
          if (st?.status === 'failed') failed++
          if (st?.status === 'uploaded' || st?.path) {
            const videos = await listJobVideos(job.id, baseName(job)).catch(() => [])
            if (videos.length && alive()) {
              setRows(prev => [...prev, ...videos.map(v => ({
                ...v, job, key: v.path, poster: v.poster || posterOf(v.path),
                duration: st?.path === v.path ? st.duration : null,
                file_name: v.file_name || videoFileName(baseName(job), v),
              }))])
            }
          }
          done++
          if (alive() && (done % 6 === 0 || done === list.length)) setScan(s => ({ ...s, done, failed }))
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALLEL, Math.max(1, list.length)) }, worker))
      if (alive()) setScan({ done: list.length, total: list.length, running: false, failed })
    })().catch(e => { if (alive()) { setError(e.message || String(e)); setScan(s => ({ ...s, running: false })) } })
  }, [range.from, range.to])

  const people = useMemo(() => [...new Set(rows.map(r => r.job.employee_name).filter(Boolean))].sort(), [rows])
  const clients = useMemo(() => [...new Set(rows.map(r => placeOf(r.job)).filter(Boolean))].sort(), [rows])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = rows.filter(r => (!who || r.job.employee_name === who)
      && (!client || placeOf(r.job) === client)
      && (!s || `${r.job.title} ${r.job.client_name} ${r.job.employee_name}`.toLowerCase().includes(s)))
    const key = r => `${r.job.scheduled_date || ''} ${r.job.completed_at || ''} ${String(r.index).padStart(2, '0')}`
    return list.sort((a, b) => order === 'new' ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b)))
  }, [rows, who, client, q, order])
  const groups = useMemo(() => {
    const out = []
    for (const r of shown) {
      const d = r.job.scheduled_date || '—'
      if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, items: [] })
      out[out.length - 1].items.push(r)
    }
    return out
  }, [shown])
  const totalSize = shown.reduce((n, r) => n + (r.size || 0), 0)
  const filtered = who || client || q

  const run = async (key, fn) => {
    setBusy(key)
    try { await fn() } finally { setBusy(null) }
  }
  const saveOne = r => run(`dl:${r.key}`, () => downloadVideo(r).catch(() => toast.error(tr('Could not download. Try again.', 'ダウンロードできませんでした。', 'Não deu para baixar. Tente de novo.'))))
  const sendOne = r => run(`send:${r.key}`, async () => {
    const res = await sendToClient(r, tr)
    if (res === 'copied') toast.success(tr('Link copied — paste it in LINE, WhatsApp or e-mail to the client.', 'リンクをコピーしました。LINEやメールに貼り付けてお客様に送ってください。', 'Link copiado — cole no LINE, WhatsApp ou e-mail do cliente.'))
  })
  const copyOne = r => run(`link:${r.key}`, async () => {
    await copyLink(publicUrl(r.path) || r.url)
    toast.success(tr('Link copied. It opens on any phone, no login.', 'リンクをコピーしました（ログイン不要で再生できます）。', 'Link copiado. Abre em qualquer celular, sem login.'))
  })
  const saveAll = () => run('all', async () => {
    toast(tr(`Downloading ${shown.length} video(s)… if the browser asks, allow multiple downloads.`,
      `${shown.length}件の動画をダウンロード中…ブラウザが確認したら「許可」を押してください。`,
      `Baixando ${shown.length} vídeo(s)… se o navegador perguntar, permita vários downloads.`))
    for (const r of shown) {
      try { await downloadVideo(r) } catch { /* next one */ }
      await new Promise(ok => setTimeout(ok, 900))
    }
  })

  const chip = active => `btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`
  const pct = scan.total ? Math.round((scan.done / scan.total) * 100) : 0

  return (
    <div>
      <h2 className="page-head" style={{ marginBottom: 4, fontSize: 22 }}>🎬 {tr('Service videos', '作業動画', 'Vídeos dos serviços')}</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)' }}>
        {tr('Videos the team sent when finishing a service. Watch, download, or send to the client.',
          '作業完了時にスタッフが送った動画です。再生・ダウンロード・お客様への送信ができます。',
          'Vídeos que a equipe enviou ao finalizar o serviço. Assista, baixe ou envie ao cliente.')}
      </p>

      <div className="card" style={{ padding: 12, marginBottom: 12, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {PERIODS.map(n => (
            <button key={n} type="button" className={chip(!custom && days === n)} onClick={() => pickDays(n)}>
              {tr(`Last ${n} days`, `過去${n}日`, `Últimos ${n} dias`)}
            </button>
          ))}
          <button type="button" className={chip(custom)} onClick={() => setCustom(true)}>📅 {tr('Dates', '期間指定', 'Datas')}</button>
          {custom && (
            <div className="form-group" style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={range.from} max={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} style={{ width: 'auto' }} aria-label={tr('From', '開始', 'De')} />
              <span style={{ color: 'var(--text3)' }}>→</span>
              <input type="date" value={range.to} min={range.from} max={today} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} style={{ width: 'auto' }} aria-label={tr('To', '終了', 'Até')} />
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <select value={who} onChange={e => setWho(e.target.value)} aria-label={tr('Employee', 'スタッフ', 'Funcionário')}>
              <option value="">👤 {tr('All employees', '全スタッフ', 'Todos os funcionários')}</option>
              {people.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <select value={client} onChange={e => setClient(e.target.value)} aria-label={tr('Place', '場所', 'Local')}>
              <option value="">🏢 {tr('All places', '全ての場所', 'Todos os locais')}</option>
              {clients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`🔎 ${tr('Search', '検索', 'Buscar')}`} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <select value={order} onChange={e => setOrder(e.target.value)} aria-label={tr('Order', '並び順', 'Ordem')}>
              <option value="new">{tr('Newest first', '新しい順', 'Mais recentes primeiro')}</option>
              <option value="old">{tr('Oldest first', '古い順', 'Mais antigos primeiro')}</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            {tr(`${shown.length} video(s)`, `${shown.length}件`, `${shown.length} vídeo(s)`)}{totalSize ? ` · ${mb(totalSize)}` : ''}
            {filtered && <> · <button type="button" onClick={() => { setWho(''); setClient(''); setQ('') }} style={{ border: 'none', background: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', padding: 0, fontSize: 12 }}>{tr('clear filters', 'フィルター解除', 'limpar filtros')}</button></>}
          </div>
          {shown.length > 1 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={saveAll} disabled={!!busy}>
              ⬇ {tr(`Download all (${shown.length})`, `すべてダウンロード (${shown.length})`, `Baixar todos (${shown.length})`)}
            </button>
          )}
        </div>
      </div>

      {scan.running && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>
            {scan.total
              ? tr(`Checking services… ${scan.done}/${scan.total}`, `作業を確認中… ${scan.done}/${scan.total}`, `Conferindo serviços… ${scan.done}/${scan.total}`)
              : tr('Loading services…', '作業を読み込み中…', 'Carregando serviços…')}
          </div>
          <div style={{ height: 4, borderRadius: 4, background: 'var(--surface2, #e5e7eb)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent, #2563eb)', transition: 'width .2s' }} />
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: 13, color: 'var(--red, #ef4444)', marginBottom: 10 }}>⚠️ {error}</div>}
      {!scan.running && scan.failed > 0 && (
        <div style={{ fontSize: 12, color: '#b45309', marginBottom: 10 }}>
          ⚠️ {tr(`${scan.failed} video(s) failed to upload in this period — the employee can send again from the phone.`,
            `この期間に送信失敗の動画が${scan.failed}件あります。スタッフがスマホから再送できます。`,
            `${scan.failed} vídeo(s) falharam no envio neste período — o funcionário pode reenviar pelo celular.`)}
        </div>
      )}
      {!scan.running && !shown.length && !error && (
        <EmptyHint icon="🎬" title={filtered ? tr('No video with these filters', '条件に合う動画はありません', 'Nenhum vídeo com esses filtros') : tr('No videos in this period', 'この期間の動画はありません', 'Nenhum vídeo neste período')}>
          {tr(`Checked ${scan.total} finished service(s). Videos appear here when the employee adds one while finishing the service.`,
            `完了した作業 ${scan.total} 件を確認しました。スタッフが作業完了時に動画を追加するとここに表示されます。`,
            `Conferi ${scan.total} serviço(s) finalizado(s). O vídeo aparece aqui quando o funcionário adiciona um ao finalizar o serviço.`)}
        </EmptyHint>
      )}

      {groups.map(g => (
        <div key={g.day} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', margin: '0 0 8px' }}>{fmtDay(g.day, lang)} · {g.items.length}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {g.items.map(r => (
              <div key={r.key} className="card" style={{ padding: 10, minWidth: 0 }}>
                {playing === r.key ? (
                  <video src={r.url} poster={r.poster || undefined} controls autoPlay playsInline preload="auto"
                    style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 8, background: '#000' }} />
                ) : (
                  <button type="button" onClick={() => setPlaying(r.key)} aria-label={tr('Play video', '動画を再生', 'Tocar vídeo')}
                    style={{ position: 'relative', display: 'block', width: '100%', aspectRatio: '16 / 9', borderRadius: 8, border: 'none', padding: 0, cursor: 'pointer', overflow: 'hidden', background: '#111' }}>
                    {r.poster && <img src={r.poster} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                    <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▶</span>
                    </span>
                    {r.duration ? <span style={{ position: 'absolute', right: 6, bottom: 6, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 4, padding: '1px 6px' }}>{r.duration}s</span> : null}
                  </button>
                )}
                <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{placeOf(r.job) || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                  👤 {r.job.employee_name || '—'}{r.size ? ` · ${mb(r.size)}` : ''}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => sendOne(r)} disabled={busy === `send:${r.key}`}>
                    {busy === `send:${r.key}` ? '…' : `📤 ${tr('Send to client', 'お客様へ送る', 'Enviar ao cliente')}`}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => saveOne(r)} disabled={busy === `dl:${r.key}`}>
                    {busy === `dl:${r.key}` ? tr('Downloading…', 'ダウンロード中…', 'Baixando…') : `⬇ ${tr('Download', 'ダウンロード', 'Baixar')}`}
                  </button>
                </div>
                <button type="button" onClick={() => copyOne(r)} style={{ marginTop: 6, width: '100%', border: 'none', background: 'none', color: 'var(--text2)', fontSize: 12, cursor: 'pointer', padding: 4 }}>
                  🔗 {tr('Copy link', 'リンクをコピー', 'Copiar link')}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
