import { useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { buildJobMediaZip, jobZipEntries, jobZipName, saveZip } from '../lib/jobMediaZip'

/**
 * v1.0.230 · "Baixar tudo (fotos e vídeos)" — one tap = one ZIP with every photo and video of
 * this service (antes-1.jpg, depois-1.jpg, video-1.mp4). Only placed where the media is already
 * shown on screen, so whoever can't see the media can't download it either.
 */
export default function DownloadAllMedia({ job, date, place, employee, className = 'btn btn-sm', style }) {
  const { tr } = useLang()
  const [busy, setBusy] = useState(null) // null | { done, total }
  if (!job?.id) return null

  const run = async ev => {
    ev?.stopPropagation?.()
    if (busy) return
    setBusy({ done: 0, total: 0 })
    try {
      const entries = await jobZipEntries(job)
      if (!entries.length) {
        toast(tr('This service has no photos or videos yet.', 'この作業には写真・動画がまだありません。', 'Este serviço ainda não tem fotos nem vídeos.'))
        return
      }
      setBusy({ done: 0, total: entries.length })
      const { blob, count, total, failed } = await buildJobMediaZip(entries, { onProgress: setBusy })
      if (!blob) throw new Error(tr('Could not download the files — try again.', 'ファイルを取得できませんでした。もう一度お試しください。', 'Não deu para baixar os arquivos — tente de novo.'))
      const how = await saveZip(blob, jobZipName({ date, place, employee }))
      if (how === 'cancelled') return
      const mb = (blob.size / 1024 / 1024).toFixed(1)
      if (failed.length) {
        toast.error(tr(`ZIP with ${count} of ${total} files (${mb} MB). Not downloaded: ${failed.join(', ')}`,
          `ZIP ${total}件中${count}件 (${mb} MB)。取得失敗: ${failed.join(', ')}`,
          `ZIP com ${count} de ${total} arquivos (${mb} MB). Não baixou: ${failed.join(', ')}`), { duration: 8000 })
      } else {
        toast.success(tr(`ZIP ready: ${count} files (${mb} MB)`, `ZIP完成: ${count}件 (${mb} MB)`, `ZIP pronto: ${count} arquivos (${mb} MB)`))
      }
    } catch (err) {
      toast.error(err?.message || String(err))
    } finally {
      setBusy(null)
    }
  }

  const label = busy
    ? (busy.total
      ? tr(`Preparing ZIP… ${busy.done} of ${busy.total}`, `ZIP作成中… ${busy.done}/${busy.total}`, `Preparando ZIP… ${busy.done} de ${busy.total}`)
      : tr('Looking for files…', 'ファイルを確認中…', 'Procurando arquivos…'))
    : tr('Download all (photos and videos)', 'すべてダウンロード（写真・動画）', 'Baixar tudo (fotos e vídeos)')

  return (
    <button type="button" className={className} disabled={!!busy} onClick={run} style={{ whiteSpace: 'normal', textAlign: 'left', ...style }}
      aria-busy={busy ? 'true' : undefined}>
      ⬇ {label}
    </button>
  )
}
