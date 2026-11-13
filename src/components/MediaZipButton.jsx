// v1.0.234 · "Baixar tudo (ZIP)": every photo and video of one service, or of the jobs given.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { downloadJobsZip } from '../lib/mediaZip'

export function useMediaZip() {
  const { tr } = useLang()
  const [busy, setBusy] = useState('')
  const run = async (jobs, name) => {
    if (!jobs?.length) return toast.error(tr('No service in this selection.', '対象の作業がありません。', 'Nenhum serviço nesta seleção.'))
    setBusy('…')
    try {
      const r = await downloadJobsZip(jobs, {
        name,
        onProgress: p => setBusy(p.stage === 'list' ? tr(`Looking ${p.done}/${p.total}`, `確認中 ${p.done}/${p.total}`, `Procurando ${p.done}/${p.total}`) : `${p.done}/${p.total}`),
      })
      if (!r.files) toast(tr('No photo or video found.', '写真・動画がありません。', 'Nenhuma foto ou vídeo encontrado.'))
      else toast.success(tr(`${r.files} files in ${r.parts} zip${r.parts > 1 ? 's' : ''}`, `${r.files}件 · ZIP ${r.parts}個`, `${r.files} arquivos em ${r.parts} ZIP${r.parts > 1 ? 's' : ''}`) + (r.missing ? ` · ${tr(`${r.missing} could not be read`, `${r.missing}件取得不可`, `${r.missing} não puderam ser lidos`)}` : ''))
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }
  return { busy, run }
}

export default function MediaZipButton({ jobs, name, className = 'btn btn-sm', label }) {
  const { tr } = useLang()
  const { busy, run } = useMediaZip()
  return <button type="button" className={className} disabled={!!busy} onClick={() => run(jobs, name)}>{busy || label || tr('Download all (ZIP)', 'すべてダウンロード（ZIP）', 'Baixar tudo (ZIP)')}</button>
}
