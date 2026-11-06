// v1.0.166 · "Eliminar serviço" button (Live Track + Jobs cards). Asks why, shows what leaves the pay,
// cancels the job (never deletes it) and offers "Desfazer" in the toast.
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { askConfirm } from './ConfirmDialog'
import { canEliminate, jobMinutes, adminEliminateJob, adminRestoreJob } from '../lib/jobEliminate'

const TZ = 'Asia/Tokyo'
const hm = iso => iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

export function EliminateJobButton({ job, className = 'btn btn-sm btn-danger', onDone, label }) {
  const { tr } = useLang()
  if (!canEliminate(job)) return null

  const run = async () => {
    const min = jobMinutes(job)
    const when = job.status === 'completed' || job.started_at ? `${hm(job.started_at)} → ${hm(job.completed_at)}${min != null ? ` (${min} min)` : ''}` : tr('not started', '未開始', 'não iniciado')
    const what = `${job.title || '—'} · ${job.employee_name || '—'} · ${job.scheduled_date || ''} · ${when}`
    const reason = await askConfirm({
      title: tr('Eliminate this service?', 'この作業を取り消しますか？', 'Eliminar este serviço?'),
      message: tr(
        `${what}\n\nIt leaves the employee's pay, the payroll close and billing. Its report is removed. Photos and times stay saved, and you can undo it.`,
        `${what}\n\n給与・締め・請求から外れます。報告書は削除されます。写真と時間は保存され、元に戻せます。`,
        `${what}\n\nSai do pagamento do funcionário, do fechamento da folha e da cobrança. O report é removido. Fotos e horários ficam guardados e dá para desfazer.`),
      reason: tr('Why? (e.g. duplicate, registered by mistake)', '理由（例：重複、誤登録）', 'Por quê? (ex.: duplicado, registrado errado)'),
      confirmLabel: tr('Eliminate', '取り消す', 'Eliminar'),
      danger: true,
    })
    if (!reason) return
    try {
      await adminEliminateJob(job, { reason })
      toast(t => (
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {tr('Service eliminated · out of the pay', '取り消しました・給与から除外', 'Serviço eliminado · fora do pagamento')}
          <button type="button" className="btn btn-sm" onClick={async () => {
            toast.dismiss(t.id)
            try { await adminRestoreJob(job.id); toast.success(tr('Restored', '元に戻しました', 'Restaurado')) } catch (e) { toast.error(e.message) }
            onDone?.()
          }}>↩ {tr('Undo', '元に戻す', 'Desfazer')}</button>
        </span>
      ), { duration: 10000 })
    } catch (e) {
      toast.error(e.message === 'changed' ? tr('This job changed meanwhile. Refresh and try again.', '作業が更新されました。再読み込みしてください。', 'Este serviço mudou. Atualize e tente de novo.')
        : e.message === 'audit' ? tr('Could not save the record. Nothing was changed.', '記録を保存できませんでした。変更していません。', 'Não deu para salvar o registro. Nada foi mudado.')
          : e.message)
    }
    onDone?.()
  }

  return (
    <button type="button" className={className} onClick={run} title={tr('Eliminate service (out of pay and billing)', '作業を取り消す（給与・請求から除外）', 'Eliminar serviço (sai do pagamento e da cobrança)')}>
      {label || `🚫 ${tr('Eliminate', '取り消す', 'Eliminar')}`}
    </button>
  )
}

export default EliminateJobButton
