// Employee home: videos still on this phone (not confirmed by the server). Shows the state and
// a "try again" button instead of failing silently. Sending resumes from the last part sent.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { listQueuedVideos, flushVideoQueue } from '../lib/videoQueue'
import { uploadJobVideo } from '../lib/jobVideo'

export default function PendingVideos({ jobs, L }) {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const load = () => listQueuedVideos().then(setItems).catch(() => setItems([]))
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])
  if (!items.length) return null
  const titleOf = id => (jobs || []).find(j => j.id === id)?.title?.replace(/ — .*/, '') || '—'

  const retry = async () => {
    setBusy(true)
    const { sent, failed } = await flushVideoQueue(uploadJobVideo).catch(() => ({ sent: 0, failed: items.length }))
    if (sent) toast.success(L(`${sent} video(s) sent`, `動画を${sent}件送信しました`, `${sent} vídeo(s) enviado(s)`))
    if (failed) toast.error(L('Video still not sent. Check the internet and try again.', '動画をまだ送信できません。通信を確認して再試行してください。', 'O vídeo ainda não foi enviado. Confira a internet e tente de novo.'))
    setBusy(false)
    load()
  }

  return (
    <div style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 16, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.35)' }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>🎬 {L('Video not sent yet', '未送信の動画', 'Vídeo ainda não enviado')} ({items.length})</div>
      {items.map(it => (
        <div key={it.id} style={{ fontSize: 13, padding: '3px 0', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleOf(it.jobId)}</span>
          <span style={{ opacity: 0.7, flexShrink: 0 }}>{it.attempts ? L('failed', '失敗', 'falhou') : L('waiting', '待機中', 'aguardando')}{it.blob?.size ? ` · ${(it.blob.size / 1024 / 1024).toFixed(1)} MB` : ''}</span>
        </div>
      ))}
      <button type="button" disabled={busy} onClick={retry}
        style={{ marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 10, border: 'none', background: '#f87171', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
        {busy ? '…' : L('Try again', '再送する', 'Tentar de novo')}
      </button>
    </div>
  )
}
