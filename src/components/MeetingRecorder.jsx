// v1.0.234 · Record the meeting inside the system, from the phone or the computer.
// The microphone is cut into pieces of a few minutes; each piece is a complete audio file that is
// sent and transcribed while the meeting goes on. A dropped connection or a closed tab loses at most
// the piece being recorded — everything before it is already saved in the meeting.
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { uploadAndTranscribe } from '../lib/meetingsApi'
import { fmtClock } from '../lib/meetings'

export const PIECE_SECONDS = 240
const MIME_CHOICES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
export const pickMime = () => (typeof MediaRecorder === 'undefined' ? '' : MIME_CHOICES.find(t => MediaRecorder.isTypeSupported?.(t)) || '')
export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export default function MeetingRecorder({ meetingId, T, flush, onMeeting, disabled }) {
  const [state, setState] = useState('idle') // idle | recording | paused | finishing
  const [seconds, setSeconds] = useState(0)
  const [sent, setSent] = useState(0)
  const [waiting, setWaiting] = useState(0)
  const [failed, setFailed] = useState([])
  const ref = useRef({ stream: null, rec: null, timer: null, tick: null, piece: 0, startedAt: 0, queue: Promise.resolve(), lock: null, stopping: false })

  const releaseMic = () => {
    const r = ref.current
    clearTimeout(r.timer); clearInterval(r.tick)
    r.stream?.getTracks().forEach(t => t.stop())
    r.stream = null; r.rec = null
    r.lock?.release?.().catch(() => {}); r.lock = null
  }
  useEffect(() => releaseMic, [])
  // leaving the page while recording: ask first, the piece in progress would be lost
  useEffect(() => {
    if (state === 'idle') return undefined
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state])

  const send = (blob, n, duration) => {
    const r = ref.current
    setWaiting(w => w + 1)
    r.queue = r.queue.then(async () => {
      try {
        const next = await uploadAndTranscribe(meetingId, blob, { duration, source: 'recording', name: T(`Gravação · parte ${n}`, `Recording · part ${n}`, `録音 · パート${n}`) })
        if (next) onMeeting(next)
        setSent(s => s + 1)
      } catch (e) {
        setFailed(f => [...f, { n, blob, duration, error: e.message }])
      }
      setWaiting(w => w - 1)
    })
    return r.queue
  }

  const startPiece = () => {
    const r = ref.current
    const mime = pickMime()
    const rec = new MediaRecorder(r.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined)
    const parts = []
    const n = ++r.piece
    const began = Date.now()
    rec.ondataavailable = e => { if (e.data?.size) parts.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' })
      if (blob.size > 1200) send(blob, n, Math.max(1, Math.round((Date.now() - began) / 1000)))
      if (r.stopping) { releaseMic(); r.queue.then(() => { setState('idle'); r.stopping = false }) } else if (r.stream) startPiece()
    }
    r.rec = rec
    rec.start()
    clearTimeout(r.timer)
    r.timer = setTimeout(() => { if (rec.state !== 'inactive') rec.stop() }, PIECE_SECONDS * 1000)
  }

  const start = async () => {
    if (!canRecord()) return toast.error(T('Este navegador não grava áudio. Use o Chrome ou o Safari atualizado.', 'This browser cannot record audio.', 'このブラウザは録音できません。'))
    try {
      await flush?.()
      const r = ref.current
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
      r.stopping = false; r.piece = 0
      setSeconds(0); setSent(0); setFailed([])
      r.lock = await navigator.wakeLock?.request?.('screen').catch(() => null)
      r.tick = setInterval(() => { if (ref.current.rec?.state === 'recording') setSeconds(s => s + 1) }, 1000)
      startPiece()
      setState('recording')
    } catch (e) {
      releaseMic()
      toast.error(e.name === 'NotAllowedError'
        ? T('Libere o microfone para o KuriPuro nas configurações do navegador.', 'Allow the microphone for KuriPuro in the browser settings.', 'ブラウザの設定でマイクを許可してください。')
        : T('Não consegui abrir o microfone.', 'Could not open the microphone.', 'マイクを開けませんでした。'))
    }
  }
  const pause = () => { const rec = ref.current.rec; if (rec?.state === 'recording') { rec.pause(); setState('paused') } }
  const resume = () => { const rec = ref.current.rec; if (rec?.state === 'paused') { rec.resume(); setState('recording') } }
  const stop = () => {
    const r = ref.current
    r.stopping = true
    setState('finishing')
    clearTimeout(r.timer); clearInterval(r.tick)
    if (r.rec && r.rec.state !== 'inactive') r.rec.stop(); else { releaseMic(); setState('idle') }
  }
  const retry = f => { setFailed(list => list.filter(x => x !== f)); send(f.blob, f.n, f.duration) }

  if (state === 'idle' && !failed.length && !waiting) {
    return (
      <div className="mt-rec mt-rec-idle">
        <button type="button" className="btn btn-primary mt-rec-start" onClick={start} disabled={disabled}>
          <span className="mt-rec-dot" aria-hidden="true" />{T('Gravar a reunião aqui', 'Record the meeting here', 'ここで会議を録音')}
        </button>
        <span className="mt-muted">{T('Grava pelo microfone deste aparelho e já vai transcrevendo, em partes de 4 minutos.', 'Records with this device’s microphone and transcribes as it goes, in 4-minute parts.', 'この端末のマイクで録音し、4分ごとに文字起こしします。')}</span>
      </div>
    )
  }
  return (
    <div className={`mt-rec mt-rec-live${state === 'paused' ? ' is-paused' : ''}`} role="status">
      <div className="mt-rec-row">
        <span className={`mt-rec-dot${state === 'recording' ? ' on' : ''}`} aria-hidden="true" />
        <strong className="mt-rec-clock">{fmtClock(seconds)}</strong>
        <span className="mt-muted">
          {state === 'recording' && T('Gravando', 'Recording', '録音中')}
          {state === 'paused' && T('Em pausa', 'Paused', '一時停止中')}
          {state === 'finishing' && T('Salvando a última parte…', 'Saving the last part…', '最後のパートを保存中…')}
          {state === 'idle' && waiting > 0 && T('Terminando de transcrever…', 'Finishing the transcript…', '文字起こしを仕上げ中…')}
          {' · '}{T(`${sent} parte(s) salva(s)`, `${sent} part(s) saved`, `${sent}パート保存済み`)}
          {waiting > 0 && ` · ${T(`${waiting} enviando`, `${waiting} sending`, `${waiting}件送信中`)}`}
        </span>
        <span className="mt-rec-actions">
          {state === 'recording' && <button type="button" className="btn" onClick={pause}>{T('Pausar', 'Pause', '一時停止')}</button>}
          {state === 'paused' && <button type="button" className="btn" onClick={resume}>{T('Continuar', 'Resume', '再開')}</button>}
          {(state === 'recording' || state === 'paused') && <button type="button" className="btn btn-primary" onClick={stop}>{T('Terminar', 'Finish', '終了')}</button>}
        </span>
      </div>
      {failed.map(f => (
        <div key={f.n} className="mt-rec-fail">
          {T(`A parte ${f.n} não foi enviada (${f.error}). O áudio continua guardado nesta tela.`, `Part ${f.n} was not sent (${f.error}). The audio is still kept on this screen.`, `パート${f.n}を送信できませんでした。`)}
          <button type="button" className="mt-link" onClick={() => retry(f)}>{T('Enviar de novo', 'Send again', '再送信')}</button>
        </div>
      ))}
    </div>
  )
}
