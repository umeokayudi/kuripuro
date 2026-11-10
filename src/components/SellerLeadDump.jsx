// v1.0.206 · "Jogue tudo aqui": the seller pastes text, takes photos (card, storefront, screenshots)
// or speaks, and the AI fills every lead field + the booked visit. One box, one button.
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { pickLang } from '../hooks/useLang'
import { prepareImageForUpload } from '../lib/imageUpload'
import { applyLeadDump, findDuplicateLead } from '../lib/sellerVisits'

const baseMime = type => String(type || '').toLowerCase().split(';')[0].trim()

async function callApi(url, body) {
  const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Request failed')
  return result
}

export function dumpCopy(lang) {
  const p = (en, ja, pt) => pickLang(lang, en, ja, pt)
  return {
    title: p('Drop everything here', 'ここに全部入れてください', 'Jogue tudo aqui'),
    hint: p('Paste a LINE message, e-mail, notes or a Maps link, take photos (business card, sign, screenshot) or just talk. The AI fills the lead for you.',
      'LINE・メール・メモ・地図リンクを貼り付け、写真（名刺・看板・スクショ）を撮るか、話すだけ。AIがリードを入力します。',
      'Cole mensagem do LINE, e-mail, anotação ou link do Maps, tire fotos (cartão, fachada, print) ou só fale. A IA preenche o lead para você.'),
    placeholder: p('e.g. "Tanaka from Sushi Ryu Shibuya, 03-1234-5678, wants range hood cleaning, visit Friday 3pm"',
      '例：「寿司竜 渋谷店 田中さん 03-1234-5678 フード清掃希望、金曜15時訪問」',
      'Ex.: "Tanaka do Sushi Ryu Shibuya, 03-1234-5678, quer limpeza de coifa, visita sexta 15h"'),
    paste: p('Paste', '貼り付け', 'Colar'),
    photo: p('Photo', '写真', 'Foto'),
    talk: p('Talk', '話す', 'Falar'),
    stop: p('Stop', '停止', 'Parar'),
    fill: p('Fill everything with AI', 'AIで全部入力', 'Preencher tudo com IA'),
    reading: p('The AI is reading…', 'AIが読み取り中…', 'A IA está lendo…'),
    uploading: p('Sending…', '送信中…', 'Enviando…'),
    needSomething: p('Paste a text, take a photo or record your voice first.', 'テキスト・写真・音声のどれかを入れてください。', 'Cole um texto, tire uma foto ou grave sua voz primeiro.'),
    filled: n => p(`Filled ${n} field${n === 1 ? '' : 's'}. Check and save.`, `${n}項目を入力しました。確認して保存してください。`, `Preenchi ${n} campo${n === 1 ? '' : 's'}. Confira e salve.`),
    nothing: p('The AI did not find new data. Add more details.', '新しい情報が見つかりませんでした。詳細を追加してください。', 'A IA não achou dados novos. Coloque mais detalhes.'),
    visitFound: p('Visit found — it is in "Scheduled visit" below.', '訪問予定を見つけました（下の「訪問予定」）。', 'Achei uma visita — está em "Visita agendada" abaixo.'),
    unsure: p('Check these, the AI was not sure:', 'AIが自信のない項目：', 'Confira, a IA ficou em dúvida:'),
    duplicate: p('Looks like this client is already in your list:', 'この顧客は既に登録されているようです：', 'Parece que este cliente já está na sua lista:'),
    openIt: p('Open it', '開く', 'Abrir'),
    noMic: p('Allow the microphone to record.', 'マイクを許可してください。', 'Permita o microfone para gravar.'),
    audioReady: p('Voice note', '音声メモ', 'Áudio gravado'),
    remove: p('Remove', '削除', 'Tirar'),
    fields: {
      company_name: p('Company', '会社', 'Empresa'), site_name: p('Location', '店舗', 'Local'), contact_name: p('Contact', '担当者', 'Contato'),
      contact_title: p('Title', '役職', 'Cargo'), contact_phone: p('Phone', '電話', 'Telefone'), contact_email: p('E-mail', 'メール', 'E-mail'),
      address: p('Address', '住所', 'Endereço'), maps_url: 'Maps', next_followup_date: p('Follow-up', 'フォロー日', 'Retorno'), notes: p('Notes', 'メモ', 'Anotação'),
      phone: p('Phone', '電話', 'Telefone'), email: 'E-mail', visit: p('Visit', '訪問', 'Visita'),
      needs: p('Needs', 'ニーズ', 'Necessidade'), website: 'Site', contact_line_id: 'LINE', expected_monthly: p('Monthly value', '月額', 'Valor mensal'),
    },
  }
}

/**
 * props: lang, today, leads, lead, onLead(nextLead), onVisit(visit), onProof(path), uploadFile(file, purpose),
 *        editingId (existing lead → fill only empty fields), onOpenDuplicate(row), busy/onBusy
 */
export default function SellerLeadDump({ lang, today, leads, lead, onLead, onVisit, onProof, uploadFile, editingId = '', onOpenDuplicate, onBusy }) {
  const t = dumpCopy(lang)
  const [text, setText] = useState('')
  const [files, setFiles] = useState([]) // { path, mime_type, preview, kind }
  const [state, setState] = useState('') // '' | 'uploading' | 'reading' | 'recording'
  const [result, setResult] = useState(null)
  const photoRef = useRef(null)
  const recRef = useRef(null)
  const chunks = useRef([])
  const latest = useRef({ text, files, lead })
  latest.current = { text, files, lead }

  useEffect(() => { onBusy?.(state === 'uploading' || state === 'reading') }, [state, onBusy])
  useEffect(() => () => { files.forEach(f => f.preview && URL.revokeObjectURL(f.preview)); recRef.current?.stream?.getTracks().forEach(tr => tr.stop()) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (override = {}) => {
    const body = { text: override.text ?? latest.current.text, files: override.files ?? latest.current.files }
    if (!body.text.trim() && !body.files.length) return toast.error(t.needSomething)
    setState('reading')
    try {
      const res = await callApi('/api/sales-ai', { task: 'lead-dump', text: body.text, files: body.files.map(f => ({ path: f.path, mime_type: f.mime_type })), language: lang })
      const opts = { today, onlyEmpty: Boolean(editingId) }
      const applied = applyLeadDump(latest.current.lead, res.answer, opts)
      // Applied on top of the newest form (GPS or typing may have arrived while the AI was reading).
      onLead(prev => applyLeadDump(prev, res.answer, opts).lead)
      if (res.proof_path && !editingId) onProof?.(res.proof_path)
      if (applied.visit) onVisit?.(applied.visit)
      const dup = editingId ? null : findDuplicateLead(leads, applied.lead)
      const unsure = (Array.isArray(res.answer?.uncertain_fields) ? res.answer.uncertain_fields : []).map(String).slice(0, 6)
      setResult({ filled: applied.filled, visit: Boolean(applied.visit), dup, unsure, summary: String(res.answer?.summary || '') })
      if (applied.filled.length || applied.visit) toast.success(t.filled(applied.filled.length))
      else toast(t.nothing)
    } catch (error) { toast.error(error.message) }
    finally { setState('') }
  }

  const addPhotos = async list => {
    const picked = [...(list || [])].slice(0, 6 - files.length)
    if (!picked.length) return
    setState('uploading')
    const added = []
    try {
      for (const file of picked) {
        const photo = await prepareImageForUpload(file)
        const up = await uploadFile(photo, 'business-card')
        added.push({ ...up, preview: URL.createObjectURL(photo), kind: 'photo' })
      }
    } catch (error) { toast.error(error.message) }
    const next = [...latest.current.files, ...added]
    setFiles(next)
    setState('')
    if (photoRef.current) photoRef.current.value = ''
    // A photo alone is enough: read it right away.
    if (added.length) run({ files: next })
  }

  const pasteText = async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim()
      if (!clip) return
      const next = [latest.current.text.trim(), clip].filter(Boolean).join('\n')
      setText(next)
      run({ text: next })
    } catch { document.getElementById('sp-dump-text')?.focus() /* clipboard blocked: long-press to paste */ }
  }

  const startTalk = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast.error(t.noMic)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recRef.current = { stream, recorder }
      chunks.current = []
      recorder.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(tr => tr.stop())
        const type = baseMime(recorder.mimeType) || 'audio/webm'
        const blob = new Blob(chunks.current, { type })
        if (!blob.size) return setState('')
        setState('uploading')
        try {
          const file = new File([blob], `lead.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type })
          const up = await uploadFile(file, 'meeting-audio')
          const next = [...latest.current.files.filter(f => f.kind !== 'audio'), { ...up, kind: 'audio' }]
          setFiles(next)
          setState('')
          run({ files: next })
        } catch (error) { toast.error(error.message); setState('') }
      }
      recorder.start()
      setState('recording')
    } catch { toast.error(t.noMic) }
  }
  const stopTalk = () => { recRef.current?.recorder?.state === 'recording' && recRef.current.recorder.stop() }

  const removeFile = i => setFiles(list => { const row = list[i]; if (row?.preview) URL.revokeObjectURL(row.preview); return list.filter((_, n) => n !== i) })
  const busy = state === 'uploading' || state === 'reading'

  return <div className="sp-dump">
    <div className="sp-dump-head"><span aria-hidden="true">✦</span><div><strong>{t.title}</strong><small>{t.hint}</small></div></div>
    <textarea id="sp-dump-text" rows="4" value={text} placeholder={t.placeholder} onChange={e => setText(e.target.value)} disabled={state === 'reading'} />
    {files.length > 0 && <div className="sp-dump-files">
      {files.map((f, i) => <span key={f.path} className={`sp-dump-file is-${f.kind}`}>
        {f.kind === 'photo' ? <img src={f.preview} alt="" /> : <b aria-hidden="true">🎙</b>}
        {f.kind === 'audio' && <small>{t.audioReady}</small>}
        <button type="button" aria-label={t.remove} title={t.remove} disabled={busy} onClick={() => removeFile(i)}>✕</button>
      </span>)}
    </div>}
    <input ref={photoRef} hidden type="file" accept="image/*" multiple onChange={e => addPhotos(e.target.files)} />
    <div className="sp-dump-tools">
      <button type="button" className="fa-btn" disabled={busy || state === 'recording'} onClick={pasteText}>📋 {t.paste}</button>
      <button type="button" className="fa-btn" disabled={busy || state === 'recording' || files.length >= 6} onClick={() => photoRef.current?.click()}>📷 {t.photo}</button>
      {state === 'recording'
        ? <button type="button" className="fa-btn fa-btn-danger" onClick={stopTalk}>■ {t.stop}</button>
        : <button type="button" className="fa-btn" disabled={busy} onClick={startTalk}>🎙 {t.talk}</button>}
    </div>
    <button type="button" className="fa-btn fa-btn-primary fa-btn-block fa-btn-lg sp-dump-go" disabled={busy || state === 'recording'} onClick={() => run()}>
      {state === 'reading' ? t.reading : state === 'uploading' ? t.uploading : `✦ ${t.fill}`}
    </button>
    {result && <div className="sp-dump-result" role="status">
      {result.summary && <p>{result.summary}</p>}
      {result.filled.length > 0 && <div className="sp-chip-row">{result.filled.map(k => <span key={k} className="sp-dump-chip">✓ {t.fields[k] || k}</span>)}</div>}
      {result.visit && <p className="sp-dump-visit">📅 {t.visitFound}</p>}
      {result.unsure.length > 0 && <p className="sp-dump-unsure">⚠ {t.unsure} {result.unsure.map(k => t.fields[k] || k).join(', ')}</p>}
      {result.dup && <div className="sp-dump-dup">⚠ {t.duplicate} <strong>{result.dup.site_name || result.dup.company_name}</strong>
        {onOpenDuplicate && <button type="button" className="fa-btn fa-btn-sm" onClick={() => onOpenDuplicate(result.dup)}>{t.openIt}</button>}</div>}
    </div>}
  </div>
}
