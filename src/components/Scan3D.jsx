// v1.0.234 · "Modelo 3D real" of a store: the admin sends photos or one video of the place and the
// system builds a 3D model (KIRI Engine). Each model spends KIRI credits, so it only starts after a
// clear confirmation; without the key on the server the screen explains what is missing.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { askConfirm } from './ConfirmDialog'
import { storagePublicUrl } from '../lib/workReport'
import { scanStatus, scanCheck, scanRemove, startScan, MIN_PHOTOS, MAX_PHOTOS, MAX_VIDEO_BYTES } from '../lib/scan3d'
import './scan3d.css'

const GlbViewer = lazy(() => import('./GlbViewer'))

export default function Scan3D({ modelId, storeName, onClose }) {
  const { tr, lang } = useLang()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState([])
  const [video, setVideo] = useState(null)
  const [busy, setBusy] = useState('')
  const [view, setView] = useState(null)
  const photoRef = useRef(null)
  const videoRef = useRef(null)

  const load = useCallback(async () => { try { setInfo(await scanStatus(modelId)); setError('') } catch (e) { setError(e.message) } }, [modelId])
  useEffect(() => { load() }, [load])
  useEffect(() => { const k = e => { if (e.key === 'Escape' && !view) onClose?.() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose, view])

  const label = s => ({ processing: tr('Building…', '作成中…', 'Montando…'), queued: tr('In line', '順番待ち', 'Na fila'), uploading: tr('Receiving files', '受信中', 'Recebendo os arquivos'), ready: tr('Ready', '完成', 'Pronto'), failed: tr('Failed', '失敗', 'Falhou'), expired: tr('Expired', '期限切れ', 'Expirou') }[s] || s)
  const when = iso => { try { return new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { timeZone: 'Asia/Tokyo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

  const go = async () => {
    const n = video ? 1 : photos.length
    const ok = await askConfirm({
      title: tr('Build the 3D model?', '3Dモデルを作成しますか？', 'Montar o modelo 3D?'),
      message: tr(`This sends ${video ? 'the video' : `${n} photos`} to KIRI and spends credits of your KIRI account. It takes from a few minutes to about an hour.`, `${video ? '動画' : `写真${n}枚`}をKIRIに送信し、KIRIアカウントのクレジットを消費します。`, `Isto envia ${video ? 'o vídeo' : `${n} fotos`} para a KIRI e consome créditos da sua conta KIRI. Leva de alguns minutos a cerca de uma hora.`),
      confirmLabel: tr('Build', '作成する', 'Montar'),
    }).catch(() => false)
    if (!ok) return
    setBusy(tr('Sending…', '送信中…', 'Enviando…'))
    try {
      await startScan(modelId, { photos, video, onProgress: p => setBusy(p.stage === 'upload' ? `${tr('Sending', '送信中', 'Enviando')} ${p.done}/${p.total}` : tr('Starting…', '開始中…', 'Iniciando…')) })
      toast.success(tr('Sent. The model appears below when it is ready.', '送信しました。完成すると下に表示されます。', 'Enviado. O modelo aparece abaixo quando ficar pronto.'))
      setPhotos([]); setVideo(null); await load()
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }
  const check = async s => {
    setBusy(s.id)
    try { const r = await scanCheck(modelId, s.id); if (r.scan.status === 'ready') toast.success(tr('The 3D model is ready.', '3Dモデルが完成しました。', 'O modelo 3D ficou pronto.')); await load() } catch (e) { toast.error(e.message) }
    setBusy('')
  }
  const remove = async s => { try { await scanRemove(modelId, s.id); await load() } catch (e) { toast.error(e.message) } }

  const pickPhotos = files => {
    const list = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name)).slice(0, MAX_PHOTOS)
    setVideo(null); setPhotos(list)
  }
  const pickVideo = file => {
    if (!file) return
    if (file.size > MAX_VIDEO_BYTES) return toast.error(tr('The video is too large (limit 200 MB, up to 3 minutes).', '動画が大きすぎます（200MB・3分まで）。', 'O vídeo é grande demais (limite 200 MB, até 3 minutos).'))
    setPhotos([]); setVideo(file)
  }
  const canStart = info?.configured && !busy && (video || photos.length >= MIN_PHOTOS)

  return createPortal(
    <div className="s3-back" onClick={onClose}>
      <div className="s3-sheet" role="dialog" aria-modal="true" aria-label={tr('Real 3D model', '実写3Dモデル', 'Modelo 3D real')} onClick={e => e.stopPropagation()}>
        <div className="s3-head"><div><h2>{tr('Real 3D model', '実写3Dモデル', 'Modelo 3D real')}</h2><p>{storeName}</p></div><button type="button" className="s3-x" onClick={onClose} aria-label={tr('Close', '閉じる', 'Fechar')}>×</button></div>
        {error && <p className="s3-warn">{error}</p>}
        {info && !info.configured && <p className="s3-warn">{tr('The KIRI key is not on the server yet, so no model can be built. The office adds it once (KIRI_API_KEY) and this screen starts working.', 'KIRIのキーがまだサーバーに登録されていません。', 'A chave da KIRI ainda não está no servidor, então nenhum modelo pode ser montado. O escritório cadastra uma vez (KIRI_API_KEY) e esta tela passa a funcionar.')}</p>}

        <section className="s3-block">
          <h3>{tr('New model', '新しいモデル', 'Novo modelo')}</h3>
          <p className="s3-sub">{tr('Walk around the place and take 40 to 80 photos (at least 20), each one overlapping the last, or record one slow video of up to 3 minutes.', '店内を一周しながら写真を40〜80枚（最低20枚）、または3分以内の動画を1本撮影してください。', 'Dê a volta no local tirando 40 a 80 fotos (no mínimo 20), cada uma pegando um pouco da anterior, ou grave um vídeo devagar de até 3 minutos.')}</p>
          <div className="s3-pick">
            <button type="button" className="btn" disabled={!!busy} onClick={() => photoRef.current?.click()}>{tr('Choose photos', '写真を選ぶ', 'Escolher fotos')}</button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => videoRef.current?.click()}>{tr('Choose a video', '動画を選ぶ', 'Escolher um vídeo')}</button>
          </div>
          <input ref={photoRef} type="file" hidden multiple accept="image/*" onChange={e => { pickPhotos(e.target.files || []); e.target.value = '' }} />
          <input ref={videoRef} type="file" hidden accept="video/*" onChange={e => { pickVideo(e.target.files?.[0]); e.target.value = '' }} />
          {photos.length > 0 && <p className={`s3-chosen${photos.length < MIN_PHOTOS ? ' is-low' : ''}`}>{tr(`${photos.length} photos chosen`, `写真 ${photos.length}枚`, `${photos.length} fotos escolhidas`)}{photos.length < MIN_PHOTOS ? ` · ${tr(`${MIN_PHOTOS - photos.length} more needed`, `あと${MIN_PHOTOS - photos.length}枚必要`, `faltam ${MIN_PHOTOS - photos.length}`)}` : ''}</p>}
          {video && <p className="s3-chosen">{video.name} · {(video.size / 1048576).toFixed(0)} MB</p>}
          <button type="button" className="btn btn-primary s3-go" disabled={!canStart} onClick={go}>{busy && busy.length > 12 ? busy : busy && !info?.scans?.some(s => s.id === busy) ? busy : tr('Build the 3D model', '3Dモデルを作成', 'Montar o modelo 3D')}</button>
        </section>

        <section className="s3-block">
          <h3>{tr('Models of this store', 'この店舗のモデル', 'Modelos desta loja')}</h3>
          {info && !info.scans.length && <p className="s3-sub">{tr('None yet.', 'まだありません。', 'Nenhum ainda.')}</p>}
          {(info?.scans || []).map(s => (
            <div key={s.id} className="s3-scan">
              <div><strong>{s.source === 'video' ? tr('From a video', '動画から', 'De um vídeo') : tr(`From ${s.files} photos`, `写真${s.files}枚から`, `De ${s.files} fotos`)}</strong><span>{when(s.created_at)} · {s.by} · <b className={`s3-st st-${s.status}`}>{label(s.status)}</b></span></div>
              <div className="s3-scan-actions">
                {s.glb_path
                  ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setView(s)}>{tr('Open in 3D', '3Dで見る', 'Abrir em 3D')}</button>
                  : ['failed', 'expired'].includes(s.status) ? null : <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => check(s)}>{busy === s.id ? '…' : tr('Check now', '確認する', 'Ver se ficou pronto')}</button>}
                {s.glb_path && <a className="btn btn-sm" href={storagePublicUrl(s.glb_path)} download={`${storeName || 'loja'}.glb`}>{tr('Download', 'ダウンロード', 'Baixar')}</a>}
                <button type="button" className="btn btn-sm" onClick={() => remove(s)} title={tr('Takes it off this list', '一覧から外す', 'Tira desta lista')}>{tr('Remove', '外す', 'Tirar')}</button>
              </div>
            </div>
          ))}
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
