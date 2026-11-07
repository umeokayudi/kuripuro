// v1.0.186 · "📤 Enviar PDF + vídeo" — one button that makes the PDF of the report and sends it
// together with the service videos (share sheet on the phone, downloads on the computer).
// iPhone only opens the share sheet right after a tap, so when preparing takes too long the
// button turns into "Compartilhar agora" and one more tap sends the files that are ready.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { canShareFiles, downloadFiles, prepareReportShare, reportVideos, shareFiles, shareText } from '../lib/reportShare'

export default function ShareReportButton({ report, html, className = 'btn btn-sm' }) {
  const { tr } = useLang()
  const [step, setStep] = useState(null)
  const [ready, setReady] = useState(null)
  if (!report) return null
  const nVideos = reportVideos(report).length

  const done = (res, pack) => {
    const { files, skipped } = pack
    if (res === 'shared') toast.success(nVideos ? tr('Sent: PDF + video', '送信しました：PDF＋動画', 'Enviado: PDF + vídeo') : tr('PDF sent', 'PDFを送信しました', 'PDF enviado'))
    if (res === 'shared-pdf-only') toast(tr('The phone sent only the PDF — the video link is inside it.', 'PDFのみ送信しました。動画のリンクはPDF内にあります。', 'O celular mandou só o PDF — o link do vídeo está dentro dele.'), { icon: 'ℹ️' })
    if (res === 'unsupported') {
      downloadFiles(files)
      toast.success(tr(`Saved ${files.length} file(s) — attach them to the message`, `${files.length}件のファイルを保存しました。メッセージに添付してください`, `${files.length} arquivo(s) baixado(s) — anexe na mensagem`))
    }
    if (skipped.length && res !== 'cancelled') toast(tr(`${skipped.length} video(s) too big to attach — the link in the PDF opens it.`, `大きすぎる動画${skipped.length}件は添付せず、PDF内のリンクから見られます。`, `${skipped.length} vídeo(s) grande(s) demais para anexar — o link no PDF abre.`), { icon: 'ℹ️', duration: 6000 })
  }

  const go = async () => {
    if (ready) {
      const res = await shareFiles(ready.files, ready.meta)
      if (res !== 'blocked') { done(res, ready); setReady(null) }
      return
    }
    setStep(tr('Making the PDF…', 'PDFを作成中…', 'Fazendo o PDF…'))
    try {
      const pack = await prepareReportShare(report, {
        html,
        onStep: (k, i, n) => setStep(k === 'pdf' ? tr('Making the PDF…', 'PDFを作成中…', 'Fazendo o PDF…') : tr(`Getting video ${i}/${n}…`, `動画を取得中 ${i}/${n}…`, `Pegando o vídeo ${i}/${n}…`)),
      })
      pack.meta = { title: report.title || 'KuriPuro', text: shareText(report, pack.videos, tr) }
      if (!canShareFiles(pack.files.slice(0, 1))) { done('unsupported', pack); return }
      const res = await shareFiles(pack.files, pack.meta)
      if (res === 'blocked') { setReady(pack); return }
      done(res, pack)
    } catch (e) {
      toast.error(tr('Could not make the PDF: ', 'PDFを作成できませんでした：', 'Não deu para fazer o PDF: ') + String(e?.message || e).slice(0, 120))
    } finally { setStep(null) }
  }

  const label = step
    || (ready ? `📤 ${tr('Share now', '今すぐ共有', 'Compartilhar agora')}`
      : `📤 ${nVideos ? tr('Send PDF + video', 'PDF＋動画を送る', 'Enviar PDF + vídeo') : tr('Send PDF', 'PDFを送る', 'Enviar PDF')}`)
  return (
    <button type="button" className={`${className}${ready ? ' btn-primary' : ''}`} disabled={!!step} onClick={go}
      title={tr('PDF file + video files together (LINE, WhatsApp, e-mail…)', 'PDFと動画ファイルをまとめて送信（LINE・メールなど）', 'Arquivo PDF + arquivos de vídeo juntos (LINE, WhatsApp, e-mail…)')}>
      {label}
    </button>
  )
}
