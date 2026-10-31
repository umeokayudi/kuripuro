// Employee home: videos still on this phone (not confirmed by the server). Shows the live state
// (sending %, waiting for internet, failed) and a "try again" button only when something failed.
// Sending resumes from the last part sent.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { listQueuedVideos, flushVideoQueue, onVideoQueueChange, sendingProgress } from '../lib/videoQueue'
import { uploadJobVideo, videoAlreadyUploaded } from '../lib/jobVideo'

export default function PendingVideos({ jobs, L }) {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine !== false)
  const load = () => listQueuedVideos().then(setItems).catch(() => setItems([]))
  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    // Progress changes re-render; the list itself is re-read when a video enters or leaves.
    const off = onVideoQueueChange(() => { setTick(n => n + 1); load() })
    const net = () => setOnline(navigator.onLine !== false)
    window.addEventListener('online', net)
    window.addEventListener('offline', net)
    return () => { clearInterval(t); off(); window.removeEventListener('online', net); window.removeEventListener('offline', net) }
  }, [])
  if (!items.length) return null
  const titleOf = id => (jobs || []).find(j => j.id === id)?.title?.replace(/ — .*/, '') || '—'

  const rows = items.map(it => {
    const p = sendingProgress(it.id)
    const state = p != null ? 'sending' : !online ? 'offline' : it.attempts ? 'failed' : 'waiting'
    return { it, p, state }
  })
  const sending = rows.filter(r => r.state === 'sending').length
  const failed = rows.filter(r => r.state === 'failed').length
  // Red only when something really failed; while sending it is just information.
  const bad = failed > 0 && !sending

  const retry = async () => {
    setBusy(true)
    const res = await flushVideoQueue(uploadJobVideo, { alreadySent: videoAlreadyUploaded }).catch(() => ({ sent: 0, failed: items.length }))
    if (res.sent) toast.success(L(`${res.sent} video(s) sent`, `動画を${res.sent}件送信しました`, `${res.sent} vídeo(s) enviado(s)`))
    if (res.failed) toast.error(L('Video still not sent. Check the internet and try again.', '動画をまだ送信できません。通信を確認して再試行してください。', 'O vídeo ainda não foi enviado. Confira a internet e tente de novo.'))
    setBusy(false)
    load()
  }

  const label = ({ state, p }) => ({
    sending: L(`sending ${Math.round(p * 100)}%`, `送信中 ${Math.round(p * 100)}%`, `enviando ${Math.round(p * 100)}%`),
    offline: L('no internet, will send later', '通信なし・後で送信', 'sem internet, envia depois'),
    failed: L('failed', '失敗', 'falhou'),
    waiting: L('in line', '順番待ち', 'na fila'),
  })[state]

  const title = sending
    ? L('Sending video', '動画を送信中', 'Enviando vídeo')
    : bad ? L('Video not sent yet', '未送信の動画', 'Vídeo ainda não enviado') : L('Video waiting to send', '送信待ちの動画', 'Vídeo esperando envio')

  return (
    <div style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 16, background: bad ? 'rgba(248,113,113,0.1)' : 'rgba(59,130,246,0.08)', border: `1px solid ${bad ? 'rgba(248,113,113,0.35)' : 'rgba(59,130,246,0.3)'}` }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>🎬 {title} ({items.length})</div>
      {rows.map(r => (
        <div key={r.it.id} style={{ fontSize: 13, padding: '3px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleOf(r.it.jobId)}</span>
            <span style={{ opacity: 0.75, flexShrink: 0 }}>{label(r)}{r.it.blob?.size ? ` · ${(r.it.blob.size / 1024 / 1024).toFixed(1)} MB` : ''}</span>
          </div>
          {r.state === 'sending' && (
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(59,130,246,0.15)', marginTop: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(3, Math.round(r.p * 100))}%`, background: '#3b82f6', transition: 'width .3s' }} />
            </div>
          )}
        </div>
      ))}
      {sending > 0 && (
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          {L('You can keep using the app. Keep it open until it finishes.', 'アプリはそのまま使えます。終わるまで開いておいてください。', 'Pode continuar usando o app. Deixe ele aberto até terminar.')}
        </div>
      )}
      {!sending && online && (
        <button type="button" disabled={busy} onClick={retry}
          style={{ marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 10, border: 'none', background: bad ? '#f87171' : '#3b82f6', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
          {busy ? '…' : bad ? L('Try again', '再送する', 'Tentar de novo') : L('Send now', '今すぐ送信', 'Enviar agora')}
        </button>
      )}
    </div>
  )
}
