// Employee home: own finished jobs still waiting for the After photo. Camera or gallery, any time later.
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import { syncServiceReport } from '../lib/jobReport'
import { gradeJobPhoto } from '../lib/photoAi'
import { awaitingAfterPhoto } from '../lib/agenda'
import { locationNameFromTitle } from '../lib/cleaningType'

export default function AfterPhotoLater({ jobs, L, onChanged }) {
  const inputRef = useRef(null)
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(null)
  const waiting = (jobs || []).filter(awaitingAfterPhoto)
  if (!waiting.length) return null

  const pick = job => { setTarget(job); inputRef.current.value = ''; inputRef.current.click() }
  const send = async files => {
    const job = target
    if (!job || !files?.length) return
    setBusy(job.id)
    try {
      const paths = []
      for (let i = 0; i < Math.min(files.length, 10); i++) paths.push(await uploadJobPhoto(`jobs/${job.id}/end_${i}.jpg`, files[i]))
      const { data, error } = await supabase.from('jobs').update({ photo_end_url: paths[0] }).eq('id', job.id).select('*').maybeSingle()
      if (error) throw error
      if (data) await syncServiceReport(supabase, data).catch(() => {})
      toast.success(L('After photo sent ✓', 'After写真を送信しました ✓', 'Foto Depois enviada ✓'))
      onChanged?.()
      gradeJobPhoto(data || { ...job, photo_end_url: paths[0] }).then(() => onChanged?.()).catch(() => { /* the admin queue retries */ })
    } catch (err) {
      toast.error(err?.message || String(err))
    }
    setBusy(null)
  }

  return (
    <div style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 16, background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)' }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>📷 {L('Waiting for the After photo', 'After写真待ち', 'Aguardando foto Depois')} ({waiting.length})</div>
      {waiting.map(j => (
        <div key={j.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', fontSize: 13 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{locationNameFromTitle(j.title)} · {j.scheduled_date?.slice(5)}</span>
          <button type="button" disabled={busy === j.id} onClick={() => pick(j)}
            style={{ flexShrink: 0, padding: '8px 12px', borderRadius: 10, border: 'none', background: '#a855f7', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            {busy === j.id ? '…' : L('Send photo', '写真を送る', 'Enviar foto')}
          </button>
        </div>
      ))}
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => send(e.target.files)} />
    </div>
  )
}
