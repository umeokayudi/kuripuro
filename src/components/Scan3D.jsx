// v1.0.235 · "Planta e modelo 3D" of a place: the admin sends one video or photos of the place and the
// system asks KIRI Engine for ONE 3DGS model (1 credit). The screen shows the balance, the cost, and the
// state of each task (Enviado · Processando · Pronto · Erro). The result is always a DRAFT: nothing is
// published from here. Without the key on the server the screen explains what is missing.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { askConfirm } from './ConfirmDialog'
import { storagePublicUrl } from '../lib/workReport'
import { scanStatus, scanCheck, scanRemove, startScan, readVideoMeta, videoProblem, MIN_PHOTOS, MAX_PHOTOS } from '../lib/scan3d'
import './scan3d.css'

const GlbViewer = lazy(() => import('./GlbViewer'))
const POLL_MS = 30000
const inFlight = s => ['sending', 'sent', 'processing'].includes(s.status)
const pollable = s => ['sent', 'processing'].includes(s.status)
// which of the four steps is the current one
const stepOf = s => (s.status === 'failed' ? 3 : s.status === 'ready' ? 2 : s.status === 'processing' ? 1 : 0)

export default function Scan3D({ modelId, storeName, onClose }) {
  const { tr, lang } = useLang()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState([])
  const [video, setVideo] = useState(null)
  const [videoNote, setVideoNote] = useState('')
  const [busy, setBusy] = useState('')
  const [checking, setChecking] = useState('')
  const [checkErr, setCheckErr] = useState({})
  const [view, setView] = useState(null)
  const photoRef = useRef(null)
  const videoRef = useRef(null)
  const pollRef = useRef(null)

  const title = tr('Plan and 3D model', '図面と3Dモデル', 'Planta e modelo 3D')
  const credits = n => tr(`${n} ${n === 1 ? 'credit' : 'credits'}`, `${n}クレジット`, `${n} ${n === 1 ? 'crédito' : 'créditos'}`)

  const load = useCallback(async () => { try { setInfo(await scanStatus(modelId)); setError('') } catch (e) { setError(e.message) } }, [modelId])
  useEffect(() => { load() }, [load])
  useEffect(() => { const k = e => { if (e.key === 'Escape' && !view) onClose?.() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose, view])

  const when = iso => { try { return new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { timeZone: 'Asia/Tokyo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

  const check = async (s, quiet = false) => {
    if (!quiet) setChecking(s.id)
    try {
      const r = await scanCheck(modelId, s.id)
      setInfo(prev => (prev ? { ...prev, scans: prev.scans.map(x => (x.id === r.scan.id ? r.scan : x)) } : prev))
      setCheckErr(prev => ({ ...prev, [s.id]: '' }))
      if (r.scan.status === 'ready' && s.status !== 'ready') {
        if (r.scan.no_mesh) toast(tr('Ready, but without a mesh. See the note on the model.', '完成しましたが、メッシュがありません。', 'Ficou pronto, mas sem malha. Veja o aviso no modelo.'))
        else toast.success(tr('The 3D model is ready (draft).', '3Dモデルが完成しました（下書き）。', 'O modelo 3D ficou pronto (rascunho).'))
      }
    } catch (e) { setCheckErr(prev => ({ ...prev, [s.id]: e.message })) }
    if (!quiet) setChecking('')
  }

  // while the sheet is open and something is on its way, ask again every 30 s
  const scans = info?.scans || []
  const waiting = scans.some(pollable)
  useEffect(() => { pollRef.current = () => { for (const s of scans) if (pollable(s)) check(s, true) } })
  useEffect(() => {
    if (!waiting) return undefined
    const t = setInterval(() => { if (!document.hidden) pollRef.current?.() }, POLL_MS)
    return () => clearInterval(t)
  }, [waiting])

  const go = async () => {
    const n = video ? 1 : photos.length
    const ok = await askConfirm({
      title: tr('Process (1 credit)?', '処理しますか？（1クレジット）', 'Processar (1 crédito)?'),
      message: tr(`This sends ${video ? 'the video' : `${n} photos`} to KIRI and spends 1 credit of your KIRI account. It takes from a few minutes to about an hour. The result stays as a draft of this place.`, `${video ? '動画' : `写真${n}枚`}をKIRIに送信し、KIRIアカウントの1クレジットを消費します。結果はこの場所の下書きとして保存されます。`, `Isto envia ${video ? 'o vídeo' : `${n} fotos`} para o KIRI e gasta 1 crédito da sua conta KIRI. Leva de alguns minutos a cerca de uma hora. O resultado fica como rascunho deste local.`),
      confirmLabel: tr('Process (1 credit)', '処理する（1クレジット）', 'Processar (1 crédito)'),
    }).catch(() => false)
    if (!ok) return
    setBusy(tr('Sending…', '送信中…', 'Enviando…'))
    try {
      const r = await startScan(modelId, { photos, video, onProgress: p => setBusy(p.stage === 'upload' ? `${tr('Sending', '送信中', 'Enviando')} ${p.done}/${p.total}` : tr('Starting…', '開始中…', 'Iniciando…')) })
      if (r?.scan?.status === 'failed') toast.error(`${tr('Error', 'エラー', 'Erro')}: ${r.scan.error || ''}`)
      else toast.success(tr('Sent. The model appears below when it is ready.', '送信しました。完成すると下に表示されます。', 'Enviado. O modelo aparece abaixo quando ficar pronto.'))
      setPhotos([]); setVideo(null); setVideoNote('')
    } catch (e) { toast.error(e.message) }
    await load()
    setBusy('')
  }
  const remove = async s => { try { await scanRemove(modelId, s.id); await load() } catch (e) { toast.error(e.message) } }

  const pickPhotos = files => {
    const all = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name))
    if (all.length > MAX_PHOTOS) toast(tr(`Only the first ${MAX_PHOTOS} photos were kept.`, `最初の${MAX_PHOTOS}枚のみ使用します。`, `Fiquei só com as primeiras ${MAX_PHOTOS} fotos.`))
    setVideo(null); setVideoNote(''); setPhotos(all.slice(0, MAX_PHOTOS))
  }
  const pickVideo = async file => {
    if (!file) return
    const meta = await readVideoMeta(file)
    const problem = videoProblem(file, meta)
    if (problem) {
      return toast.error({
        heavy: tr(`The video has ${(file.size / 1048576).toFixed(0)} MB; our storage takes up to 50 MB per file. Record a shorter one (or in 720p), or use photos.`, `動画は${(file.size / 1048576).toFixed(0)}MBです。保存できるのは1ファイル50MBまでです。短く撮るか、写真をご利用ください。`, `O vídeo tem ${(file.size / 1048576).toFixed(0)} MB; o nosso armazenamento aceita até 50 MB por arquivo. Grave um mais curto (ou em 720p), ou use fotos.`),
        long: tr('The video is longer than 3 minutes.', '動画が3分を超えています。', 'O vídeo tem mais de 3 minutos.'),
        big: tr(`The video is ${meta?.width}×${meta?.height}; the limit is 1080p (1920×1080).`, `動画は${meta?.width}×${meta?.height}です。上限は1080p（1920×1080）です。`, `O vídeo é ${meta?.width}×${meta?.height}; o limite é 1080p (1920×1080).`),
      }[problem])
    }
    setPhotos([]); setVideo(file)
    setVideoNote(meta?.duration
      ? `${Math.floor(meta.duration / 60)}:${String(Math.round(meta.duration % 60)).padStart(2, '0')}${meta.width ? ` · ${meta.width}×${meta.height}` : ''}`
      : tr('Could not read the length here: make sure it is up to 3 min and 1080p.', '長さを確認できませんでした。3分・1080p以内かご確認ください。', 'Não consegui ler a duração aqui: confira que tem até 3 min e 1080p.'))
  }

  const balance = typeof info?.balance === 'number' ? info.balance : null
  const running = scans.some(inFlight)
  const noCredit = balance != null && balance < 1
  const hasMedia = !!video || photos.length >= MIN_PHOTOS
  const canStart = !!info?.configured && !busy && !running && !noCredit && hasMedia
  const steps = [tr('Sent', '送信済み', 'Enviado'), tr('Processing', '処理中', 'Processando'), tr('Ready', '完成', 'Pronto'), tr('Error', 'エラー', 'Erro')]
  const noMeshText = tr('The 3DGS result came without a mesh to build the plan. Stopped here without spending another credit — talk to the person in charge before trying Photo Scan.', '3DGSの結果に図面用のメッシュがありませんでした。追加のクレジットは使わずに停止しました。Photo Scanを試す前に責任者にご相談ください。', 'O 3DGS não trouxe malha para gerar a planta. Parei aqui sem gastar outro crédito — fale com o responsável antes de tentar Photo Scan.')

  return createPortal(
    <div className="s3-back" onClick={onClose}>
      <div className="s3-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="s3-head"><div><h2>{title}</h2><p>{storeName}</p></div><button type="button" className="s3-x" onClick={onClose} aria-label={tr('Close', '閉じる', 'Fechar')}>×</button></div>
        {error && <p className="s3-warn">{tr('Could not load this screen now', 'この画面を読み込めませんでした', 'Não consegui carregar esta tela agora')}: {error} <button type="button" className="s3-link" onClick={load}>{tr('Try again', '再試行', 'Tentar de novo')}</button></p>}
        {info && !info.configured && <p className="s3-warn">{tr('The KIRI key is not on the server yet, so no model can be built. The office adds it once (KIRI_API_KEY) and this screen starts working.', 'KIRIのキーがまだサーバーに登録されていません。', 'A chave do KIRI ainda não está no servidor, então nenhum modelo pode ser montado. O escritório cadastra uma vez (KIRI_API_KEY) e esta tela passa a funcionar.')}</p>}

        <section className="s3-block">
          <h3>{tr('New model', '新しいモデル', 'Novo modelo')}</h3>
          <p className="s3-sub">{tr(`Walk around the place and take ${MIN_PHOTOS} to ${MAX_PHOTOS} photos, each one overlapping the last, or record one slow video: up to 3 minutes, up to 1080p and up to 50 MB (the limit of our storage — in 1080p that is roughly 30 to 40 seconds, so for a large place use photos).`, `店内を一周しながら写真を${MIN_PHOTOS}〜${MAX_PHOTOS}枚、または動画を1本（3分・1080p・50MBまで。1080pでは約30〜40秒が目安のため、広い場所は写真がおすすめ）撮影してください。`, `Dê a volta no local tirando de ${MIN_PHOTOS} a ${MAX_PHOTOS} fotos, cada uma pegando um pouco da anterior, ou grave um vídeo devagar: até 3 minutos, até 1080p e até 50 MB (limite do nosso armazenamento — em 1080p isso dá uns 30 a 40 segundos; para um local grande, use fotos).`)}</p>
          <div className="s3-pick">
            <button type="button" className="btn" disabled={!!busy} onClick={() => photoRef.current?.click()}>{tr('Choose photos', '写真を選ぶ', 'Escolher fotos')}</button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => videoRef.current?.click()}>{tr('Choose a video', '動画を選ぶ', 'Escolher um vídeo')}</button>
          </div>
          <input ref={photoRef} type="file" hidden multiple accept="image/*" onChange={e => { pickPhotos(e.target.files || []); e.target.value = '' }} />
          <input ref={videoRef} type="file" hidden accept="video/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; pickVideo(f) }} />
          {photos.length > 0 && <p className={`s3-chosen${photos.length < MIN_PHOTOS ? ' is-low' : ''}`}>{tr(`${photos.length} photos chosen`, `写真 ${photos.length}枚`, `${photos.length} fotos escolhidas`)}{photos.length < MIN_PHOTOS ? ` · ${tr(`${MIN_PHOTOS - photos.length} more needed`, `あと${MIN_PHOTOS - photos.length}枚必要`, `faltam ${MIN_PHOTOS - photos.length}`)}` : ''}</p>}
          {video && <p className="s3-chosen">{video.name} · {(video.size / 1048576).toFixed(0)} MB{videoNote ? ` · ${videoNote}` : ''}</p>}
          <p className="s3-cost">{tr('Cost', '費用', 'Custo')}: {credits(1)}{balance != null ? ` · ${tr('balance after', '処理後の残高', 'saldo depois')}: ${Math.max(0, balance - 1)}` : ''}</p>
          <div className="s3-go-row">
            <button type="button" className="btn btn-primary s3-go" disabled={!canStart} onClick={go}>{busy || tr('Process (1 credit)', '処理する（1クレジット）', 'Processar (1 crédito)')}</button>
            {info?.configured && (balance != null
              ? <span className={`s3-chip${noCredit ? ' is-off' : ''}`}>{tr('Balance', '残高', 'Saldo')}: {credits(balance)}</span>
              : <span className="s3-chip is-off">{tr('Balance unavailable', '残高を取得できません', 'Saldo indisponível')}{info.balance_error ? `: ${info.balance_error}` : ''}</span>)}
          </div>
          {noCredit && <p className="s3-sub s3-bad">{tr('No credits in the KIRI account: top it up to process.', 'KIRIのクレジットがありません。チャージしてください。', 'Sem créditos na conta KIRI: recarregue para processar.')}</p>}
          {running && <p className="s3-sub">{tr('A model of this place is already on its way. Wait for it to finish before spending another credit.', 'この場所のモデルを処理中です。完了までお待ちください。', 'Já existe um modelo deste local em andamento. Espere terminar antes de gastar outro crédito.')}</p>}
        </section>

        <section className="s3-block">
          <h3>{tr('Models of this place', 'この場所のモデル', 'Modelos deste local')}</h3>
          {info && !scans.length && <p className="s3-sub">{tr('None yet.', 'まだありません。', 'Nenhum ainda.')}</p>}
          {waiting && <p className="s3-sub">{tr('Updates by itself every 30 s while this window is open.', 'この画面を開いている間、30秒ごとに自動更新します。', 'Atualiza sozinho a cada 30 s enquanto esta janela estiver aberta.')}</p>}
          {scans.map(s => {
            const cur = stepOf(s)
            const mesh = s.result?.mesh_file || (s.glb_path ? '.glb' : '')
            const softErr = checkErr[s.id] || s.last_check_error
            return (
              <div key={s.id} className="s3-scan">
                <div className="s3-scan-main">
                  <strong>{s.source === 'video' ? tr('From a video', '動画から', 'De um vídeo') : tr(`From ${s.files} photos`, `写真${s.files}枚から`, `De ${s.files} fotos`)}</strong>
                  <span>{when(s.created_at)} · {s.by} · {s.algorithm === '3dgs' ? '3DGS' : 'Photo Scan'}</span>
                  <ol className="s3-steps" aria-label={tr('State', '状態', 'Estado')}>
                    {steps.map((name, i) => <li key={name} className={i === cur ? `is-now${i === 3 ? ' is-err' : i === 2 ? ' is-ok' : ''}` : i < cur && cur !== 3 ? 'is-done' : ''} aria-current={i === cur ? 'step' : undefined}>{name}</li>)}
                  </ol>
                  {s.status === 'sending' && <p className="s3-note">{tr('Sending the files to KIRI…', 'KIRIに送信中…', 'Enviando os arquivos para o KIRI…')}</p>}
                  {s.status === 'failed' && <p className="s3-note s3-bad">{tr('Reason', '理由', 'Motivo')}: {s.error || tr('not informed', '不明', 'não informado')}</p>}
                  {pollable(s) && softErr && <p className="s3-note s3-bad">{tr('Could not check right now', '今は確認できませんでした', 'Não consegui consultar agora')}: {softErr}. {tr('Trying again by itself.', '自動で再試行します。', 'Tento de novo sozinho.')}</p>}
                  {s.status === 'ready' && (s.no_mesh
                    ? <p className="s3-warn">{noMeshText}</p>
                    : mesh && <p className="s3-note">{tr('Mesh', 'メッシュ', 'Malha')}: {tr('yes', 'あり', 'sim')} ({mesh.split('/').pop()})</p>)}
                  {s.status === 'ready' && s.result?.splat_file && <p className="s3-note">Splat: {s.result.splat_file.split('/').pop()}</p>}
                  {(s.result?.notes || []).map(n => <p key={n} className="s3-note">{n}</p>)}
                  <p className="s3-badges"><em className="s3-draft">{tr('Draft · not published', '下書き・未公開', 'Rascunho · não publicado')}</em></p>
                </div>
                <div className="s3-scan-actions">
                  {s.glb_path && <button type="button" className="btn btn-sm btn-primary" onClick={() => setView(s)}>{tr('Open in 3D', '3Dで見る', 'Abrir em 3D')}</button>}
                  {pollable(s) && <button type="button" className="btn btn-sm" disabled={!!checking} onClick={() => check(s)}>{checking === s.id ? '…' : tr('Check now', '今すぐ確認', 'Ver agora')}</button>}
                  {s.glb_path && <a className="btn btn-sm" href={storagePublicUrl(s.glb_path)} download={`${storeName || 'local'}.glb`}>{tr('Download model', 'モデルを保存', 'Baixar modelo')}</a>}
                  {s.zip_path && <a className="btn btn-sm" href={storagePublicUrl(s.zip_path)} download={`${storeName || 'local'}.zip`}>{tr('Download zip', 'zipを保存', 'Baixar zip')}</a>}
                  <button type="button" className="btn btn-sm" disabled={inFlight(s)} onClick={() => remove(s)} title={tr('Takes it off this list', '一覧から外す', 'Tira desta lista')}>{tr('Remove', '外す', 'Tirar')}</button>
                </div>
              </div>
            )
          })}
        </section>
      </div>
      {view && (
        <div className="s3-viewer" onClick={e => e.stopPropagation()}>
          <div className="s3-viewer-bar"><strong>{storeName}</strong><button type="button" onClick={() => setView(null)}>{tr('Close', '閉じる', 'Fechar')}</button></div>
          <Suspense fallback={<p className="s3-loading">…</p>}><GlbViewer url={storagePublicUrl(view.glb_path)} /></Suspense>
        </div>
      )}
    </div>,
    document.body,
  )
}
