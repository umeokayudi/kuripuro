// v1.0.156 · "Já fiz": one popup to register a service that was done but never opened in the app.
// Same fields and order on phone (sheet from the bottom) and computer (centered box):
// start/finish → checklist → before/after photos → note → "Salvar como concluído".
// Shown to the employee (own jobs, until the end of the day) and to the admin (any day).
// Never shows client values (role rule): only times, checklist, photos and the note.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { locationNameFromTitle } from '../lib/cleaningType'
import { contractForAgendaJob, expectedMinutes, agendaChecklistItems } from '../lib/agenda'
import { checklistDisplayLabel } from '../lib/jobChecklist'
import { jaFizDefaults, jaFizTimes, jaFizError, jaFizPermission } from '../lib/jaFiz'
import { saveJaFiz } from '../lib/jaFizOps'
import { compressVideo, canUseWebCodecs } from '../lib/videoCompress'
import { uploadJobVideo, videoPoster, writeVideoStatus } from '../lib/jobVideo'
import { enqueueAndSend } from '../lib/videoQueue'
import './ja-fiz.css'

const fmtMin = m => {
  if (!(m > 0)) return '—'
  const h = Math.floor(m / 60), r = m % 60
  return h ? (r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`) : `${r} min`
}

/** The signed-in admin as the one who registers (name from the login). */
export function adminActor() {
  try { const u = JSON.parse(localStorage.getItem('kp_user') || '{}'); return { id: u.id || null, name: u.name || 'admin', role: 'admin' } } catch { return { id: null, name: 'admin', role: 'admin' } }
}

/** Button for a pending/late job. Renders nothing when this person cannot register it now. */
export function JaFizButton({ job, actor: actorProp, className = 'jf-open', contracts, dark, onDone, label, stopPropagation = true }) {
  const { tr } = useLang()
  const [open, setOpen] = useState(false)
  const actor = actorProp || adminActor()
  if (!jaFizPermission(job, { role: actor?.role, userId: actor?.id }).ok) return null
  return (
    <>
      <button type="button" className={className} onClick={e => { if (stopPropagation) e.stopPropagation(); setOpen(true) }}>
        {label || `✓ ${tr('Already done', 'もう済んだ', 'Já fiz')}`}
      </button>
      {open && <JaFizSheet job={job} actor={actor} contracts={contracts} dark={dark} onClose={() => setOpen(false)} onDone={r => { setOpen(false); onDone?.(r) }} />}
    </>
  )
}

function PhotoPick({ id, title, files, setFiles, tr }) {
  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews])
  const add = list => { const arr = Array.from(list || []); if (arr.length) setFiles(f => [...f, ...arr].slice(0, 10)) }
  return (
    <div className="jf-photos">
      <div className="jf-photos-head"><span>{title}</span><small>{files.length}</small></div>
      <div className="jf-thumbs">
        {previews.map((u, i) => (
          <span key={u} className="jf-thumb">
            <img src={u} alt={`${title} ${i + 1}`} />
            <button type="button" aria-label={tr('Remove', '削除', 'Remover')} onClick={() => setFiles(f => f.filter((_, k) => k !== i))}>×</button>
          </span>
        ))}
        <label className="jf-add" htmlFor={`${id}-gal`}>🖼<small>{tr('Gallery', 'ギャラリー', 'Galeria')}</small></label>
        <label className="jf-add" htmlFor={`${id}-cam`}>📷<small>{tr('Camera', 'カメラ', 'Câmera')}</small></label>
        <input id={`${id}-gal`} type="file" accept="image/*" multiple hidden onChange={e => { add(e.target.files); e.target.value = '' }} />
        <input id={`${id}-cam`} type="file" accept="image/*" capture="environment" hidden onChange={e => { add(e.target.files); e.target.value = '' }} />
      </div>
    </div>
  )
}

const fmtSize = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

/** Sends the compressed video after the job is saved (kept on the phone until Storage confirms). */
function sendVideoLater(jobId, task, tr) {
  if (!task?.promise) return
  writeVideoStatus(jobId, { status: 'uploading', path: null })
  task.promise.then(async res => {
    const id = toast.loading(tr('Sending video…', '動画を送信中…', 'Enviando vídeo…'))
    try {
      await enqueueAndSend(jobId, res, uploadJobVideo, { onProgress: p => toast.loading(`${tr('Sending video…', '動画を送信中…', 'Enviando vídeo…')} ${Math.round(p * 100)}% · ${fmtSize(res.size)}`, { id }) })
      toast.success(tr('Video sent', '動画を送信しました', 'Vídeo enviado'), { id })
    } catch (err) {
      if (err?.queued) toast(tr('Video saved on this phone; it will be sent later.', '動画は端末に保存され、あとで送信されます。', 'Vídeo guardado no celular; será enviado depois.'), { id, icon: '📶', duration: 7000 })
      else toast.error(`${tr('Video failed', '動画の送信に失敗', 'Falha no vídeo')}: ${err?.message || ''}`, { id, duration: 6000 })
    }
  }).catch(() => { /* compression error already shown */ })
}

function VideoPick({ id, video, onPick, onRemove, tr }) {
  if (video) {
    const pct = Math.round((video.progress || 0) * 100)
    return (
      <div className="jf-video">
        <span>🎬 {video.status === 'ready' ? `${tr('Video ready', '動画準備完了', 'Vídeo pronto')} · ${fmtSize(video.size || 0)}` : `${tr('Compressing…', '圧縮中…', 'Comprimindo…')} ${pct}%`}</span>
        <button type="button" className="jf-link jf-link-bad" onClick={onRemove}>{tr('Remove', '削除', 'Remover')}</button>
        {video.status !== 'ready' && <div className="jf-bar"><i style={{ width: `${pct}%` }} /></div>}
      </div>
    )
  }
  return (
    <div className="jf-thumbs">
      <label className="jf-add jf-add-wide" htmlFor={`${id}-vgal`}>🎬<small>{tr('From gallery', 'ギャラリーから', 'Da galeria')}</small></label>
      <label className="jf-add jf-add-wide" htmlFor={`${id}-vcam`}>⏺<small>{tr('Record now', '今撮影', 'Gravar agora')}</small></label>
      <input id={`${id}-vgal`} type="file" accept="video/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f) }} />
      <input id={`${id}-vcam`} type="file" accept="video/*" capture="environment" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f) }} />
    </div>
  )
}

export default function JaFizSheet({ job, actor, contracts: contractsProp, dark = false, onClose, onDone }) {
  const { tr, lang } = useLang()
  const [contracts, setContracts] = useState(contractsProp || null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [checklist, setChecklist] = useState(null)
  const [before, setBefore] = useState([])
  const [after, setAfter] = useState([])
  const [note, setNote] = useState('')
  const [video, setVideo] = useState(null) // { status: 'compressing' | 'ready', progress, size }
  const [videoTask, setVideoTask] = useState(null)
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const isAdmin = actor?.role === 'admin'

  useEffect(() => {
    if (contractsProp) return
    supabase.from('service_contracts').select('*').then(({ data }) => setContracts(data || []))
  }, [contractsProp])

  const contract = useMemo(() => contracts ? contractForAgendaJob(job, contracts) : null, [contracts, job])
  const planned = contracts ? expectedMinutes(job, contract) : null

  // planned times + checklist, once the contract is known
  useEffect(() => {
    if (!contracts || checklist) return
    const d = jaFizDefaults(job, planned)
    setStart(d.start); setEnd(d.end)
    setChecklist(agendaChecklistItems(job, { contract }).map(label => ({ label, done: false })))
  }, [contracts]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  const pickVideo = file => {
    videoTask?.abort.abort()
    const task = { abort: new AbortController(), file }
    setVideoTask(task)
    setVideo({ status: 'compressing', progress: 0, slow: !canUseWebCodecs() })
    task.promise = compressVideo(file, {
      signal: task.abort.signal,
      onProgress: progress => setVideo(v => v && v.status === 'compressing' ? { ...v, progress } : v),
    }).then(async res => ({ ...res, ...(await videoPoster(res.blob)) }))
    task.promise.then(
      res => setVideo(v => v ? { status: 'ready', progress: 1, size: res.size } : v),
      err => {
        setVideo(null); setVideoTask(null)
        if (err?.code === 'aborted') return
        toast.error(err?.code === 'too_large' ? tr('Video too long (max 60 s).', '動画が長すぎます（最大60秒）。', 'Vídeo longo demais (máx. 60 s).') : tr('This file is not a video.', '動画ファイルではありません。', 'Este arquivo não é um vídeo.'))
      },
    )
  }
  const removeVideo = () => { videoTask?.abort.abort(); setVideoTask(null); setVideo(null) }

  const times = jaFizTimes(job, start, end)
  const list = checklist || []
  const doneN = list.filter(c => c.done).length
  const allDone = list.length > 0 && doneN === list.length
  const day = (job.scheduled_date || '').slice(5).split('-').reverse().join('/')

  const errText = {
    times: tr('Enter the start and finish times.', '開始と終了の時刻を入力してください。', 'Informe a hora que começou e a que terminou.'),
    future: tr('The finish cannot be in the future.', '終了を未来の時刻にはできません。', 'O fim não pode ser no futuro.'),
    long: tr('More than 16 hours — check the times.', '16時間を超えています。時刻を確認してください。', 'Mais de 16 horas — confira os horários.'),
    checklist: tr('Confirm the checklist items you did.', '実施したチェック項目を確認してください。', 'Confirme os itens do checklist que você fez.'),
    photo: tr('Add at least one photo or the video.', '写真か動画を1つ以上追加してください。', 'Envie pelo menos uma foto (antes ou depois) ou o vídeo.'),
    closed: tr('This service changed meanwhile (it may have been started). Refresh.', 'この作業は変更されました（開始された可能性があります）。更新してください。', 'Este serviço mudou enquanto isso (pode ter sido iniciado). Atualize.'),
    day_closed: tr('The day of this service is over — only the office can register it now.', 'この作業の日は終わりました。登録は事務所のみ可能です。', 'O dia deste serviço já passou — agora só o escritório pode registrar.'),
    not_mine: tr('This service is not yours.', 'これはあなたの作業ではありません。', 'Este serviço não é seu.'),
    not_pending: tr('This service is no longer pending.', 'この作業は未開始ではありません。', 'Este serviço não está mais pendente.'),
    future_day: tr('This service is on a future day.', '未来の日の作業です。', 'Este serviço é de um dia futuro.'),
  }

  const save = async () => {
    const bad = jaFizError({ times, checklist: list, photos: { before: before.length, after: after.length + (video ? 1 : 0) }, role: actor?.role })
    setErr(bad)
    if (bad) return
    setSaving(true)
    try {
      const res = await saveJaFiz(job, { times, checklist: list, note, photos: { before, after }, actor })
      if (videoTask) sendVideoLater(job.id, videoTask, tr)
      toast.success(isAdmin && res.notified
        ? tr('Saved as done · employee notified', '完了として保存 · スタッフに通知', 'Salvo como concluído · funcionário avisado')
        : tr('Saved as done (retroactive)', '完了として保存（事後）', 'Salvo como concluído (retroativo)'))
      onDone?.(res)
    } catch (ex) {
      const k = ex.message === 'future' ? 'future_day' : ex.message
      if (errText[k]) setErr(k)
      else toast.error(ex.message)
    }
    setSaving(false)
  }

  return (
    <div className={`jf-overlay${dark ? ' jf-dark' : ''}`} role="dialog" aria-modal="true" aria-label={tr('Already done', 'もう済んだ', 'Já fiz')} onClick={() => !saving && onClose()}>
      <div className="jf-box" onClick={e => e.stopPropagation()}>
        <div className="jf-grab" aria-hidden="true" />
        <div className="jf-head">
          <div>
            <div className="jf-title">✓ {tr('Already done', 'もう済んだ', 'Já fiz')}</div>
            <div className="jf-sub">{locationNameFromTitle(job.title)} · {day}{isAdmin && job.employee_name ? ` · ${job.employee_name}` : ''}</div>
          </div>
          <button type="button" className="jf-x" aria-label={tr('Close', '閉じる', 'Fechar')} disabled={saving} onClick={onClose}>×</button>
        </div>
        <div className="jf-info">
          {isAdmin
            ? tr('Registers a service that was never opened in the app. It stays marked "Retroactive" and registered by the admin.', 'アプリで開かれなかった作業を登録します。「事後」と表示され、管理者の登録として残ります。', 'Registra um serviço que nunca foi aberto no app. Fica com o selo "Retroativo" e registrado como feito pelo admin.')
            : tr('Forgot to use the app? Fill in what you did. It is saved as done with the "Retroactive" badge.', 'アプリを使い忘れましたか？実施内容を入力してください。「事後」として完了保存されます。', 'Esqueceu de usar o app? Preencha o que você fez. Fica concluído com o selo "Retroativo".')}
        </div>

        {/* 1 · times */}
        <section className="jf-sec">
          <h4>1 · {tr('Time', '時間', 'Horário')}</h4>
          <div className="jf-times">
            <label>{tr('Started', '開始', 'Começou')}
              <input type="time" value={start} onChange={e => setStart(e.target.value)} className={err === 'times' ? 'is-bad' : ''} />
            </label>
            <label>{tr('Finished', '終了', 'Terminou')}
              <input type="time" value={end} onChange={e => setEnd(e.target.value)} className={err === 'times' || err === 'future' || err === 'long' ? 'is-bad' : ''} />
            </label>
            <div className="jf-dur"><small>{tr('Counts as', '計上', 'Vai contar')}</small><b>{fmtMin(times?.minutes)}</b></div>
          </div>
          <div className="jf-hint">{tr('Pre-filled with the planned time', '予定時間で入力済み', 'Já vem com o horário planejado')}{planned ? ` (${fmtMin(planned)})` : ''}. {tr('Just adjust.', '必要なら調整してください。', 'É só ajustar.')}</div>
        </section>

        {/* 2 · checklist */}
        <section className="jf-sec">
          <div className="jf-sec-head">
            <h4>2 · Checklist <span className={`jf-count${allDone ? ' ok' : ''}`}>{doneN}/{list.length}</span></h4>
            {list.length > 0 && <button type="button" className="jf-link" onClick={() => setChecklist(l => l.map(c => ({ ...c, done: !allDone })))}>{allDone ? tr('Clear all', 'すべて解除', 'Desmarcar todos') : tr('Mark all', 'すべてチェック', 'Marcar todos')}</button>}
          </div>
          {checklist === null ? <div className="jf-hint">…</div>
            : list.length === 0 ? <div className="jf-hint">{tr('No checklist for this service.', 'この作業にチェックリストはありません。', 'Sem checklist para este serviço.')}</div>
              : <ul className={`jf-check${err === 'checklist' ? ' is-bad' : ''}`}>
                {list.map((c, i) => (
                  <li key={i}>
                    <label>
                      <input type="checkbox" checked={c.done} onChange={() => setChecklist(l => l.map((x, k) => k === i ? { ...x, done: !x.done } : x))} />
                      <span>{checklistDisplayLabel(c.label, lang)}</span>
                    </label>
                  </li>
                ))}
              </ul>}
        </section>

        {/* 3 · photos */}
        <section className={`jf-sec${err === 'photo' ? ' is-bad' : ''}`}>
          <h4>3 · {tr('Photos', '写真', 'Fotos')}</h4>
          <PhotoPick id={`jf-b-${job.id}`} title={tr('Before', '作業前', 'Antes')} files={before} setFiles={setBefore} tr={tr} />
          <PhotoPick id={`jf-a-${job.id}`} title={tr('After', '作業後', 'Depois')} files={after} setFiles={setAfter} tr={tr} />
        </section>

        {/* 4 · video */}
        <section className="jf-sec">
          <h4>4 · {tr('Video of the service', '作業の動画', 'Vídeo do serviço')} <span className="jf-count">{tr('optional', '任意', 'opcional')}</span></h4>
          <VideoPick id={`jf-v-${job.id}`} video={video} onPick={pickVideo} onRemove={removeVideo} tr={tr} />
        </section>

        {/* 4 · note */}
        <section className="jf-sec">
          <h4>5 · {tr('Note (optional)', 'メモ（任意）', 'Observação (opcional)')}</h4>
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={tr('e.g. forgot to open the app', '例：アプリを開き忘れた', 'ex.: esqueci de abrir o app')} />
        </section>

        {err && <div className="jf-error">{errText[err] || err}</div>}

        <div className="jf-actions">
          <button type="button" className="jf-cancel" disabled={saving} onClick={onClose}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
          <button type="button" className="jf-save" disabled={saving || checklist === null} onClick={save}>{saving ? tr('Saving…', '保存中…', 'Salvando…') : `✓ ${tr('Save as done', '完了として保存', 'Salvar como concluído')}`}</button>
        </div>
      </div>
    </div>
  )
}
