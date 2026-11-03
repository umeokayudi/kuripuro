// v1.0.146 · Admin chooses the 請求書 dates (発行日 / 対象期間 / 支払期限) before saving or sending.
// <InvoiceDatesDialog initial={{issue_date, period_start, period_end, due_date}} onSave={async d => …} onClose />
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../hooks/useLang'
import { checkInvoiceDates, dueChoices } from '../lib/invoiceDates'

export default function InvoiceDatesDialog({ initial, title, intro, saveLabel, paymentDay = 10, onSave, onClose, children }) {
  const { tr, lang } = useLang()
  const [d, setD] = useState(() => ({ ...initial }))
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setD(x => {
    const next = { ...x, [k]: v }
    if (k === 'period_start' && (!x.period_end || x.period_end === x.period_start || x.period_end < v)) next.period_end = v
    return next
  })
  const { errors, warnings } = checkInvoiceDates(d)
  const bad = new Set(errors.map(e => e.key))
  const msg = {
    missing: tr('Fill in every date.', 'すべての日付を入力してください。', 'Preencha todas as datas.'),
    end_before_start: tr('The period ends before it starts.', '対象期間の終了日が開始日より前です。', 'O fim do período está antes do início.'),
    due_before_issue: tr('Payment due is before the issue date.', '支払期限が発行日より前です。', 'O vencimento está antes da data de emissão.'),
    period_far_future: tr('The period is more than a month ahead — check the year.', '対象期間が1か月以上先です。年を確認してください。', 'O período está a mais de 1 mês daqui — confira o ano.'),
    period_after_issue: tr('The period starts after the issue date (billing before the work).', '対象期間が発行日より後です（作業前の請求）。', 'O período começa depois da emissão (cobrando antes do serviço).'),
    issue_odd: tr('The issue date is far from today.', '発行日が今日から大きく離れています。', 'A data de emissão está longe de hoje.'),
    due_far: tr('Payment due is more than 3 months after the issue date.', '支払期限が発行日から3か月以上先です。', 'O vencimento está a mais de 3 meses da emissão.'),
  }
  const save = async () => {
    if (errors.length || busy) return
    setBusy(true)
    try { await onSave(d) } finally { setBusy(false) }
  }
  const field = (k, label) => (
    <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--text2)', minWidth: 0 }}>
      {label}
      <input type="date" value={d[k] || ''} onChange={e => set(k, e.target.value)}
        style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', borderColor: bad.has(k) ? 'var(--red, #dc2626)' : undefined }} />
    </label>
  )
  const choices = dueChoices(d.issue_date, paymentDay)
  const lk = lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en'

  return createPortal(
    <div role="dialog" aria-modal="true" onClick={e => { e.stopPropagation(); if (!busy) onClose?.() }}
      style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" onClick={e => e.stopPropagation()} style={{ width: 'min(460px,100%)', maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div className="card-title">📅 {title || tr('Invoice dates', '請求書の日付', 'Datas da fatura')}</div>
        {intro && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>{intro}</div>}
        <div style={{ display: 'grid', gap: 12 }}>
          {field('issue_date', tr('Issue date (発行日)', '発行日', 'Data de emissão (発行日)'))}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>{tr('Billing period (対象期間)', '対象期間', 'Período cobrado (対象期間)')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {field('period_start', tr('From', '開始', 'De'))}
              {field('period_end', tr('To', '終了', 'Até'))}
            </div>
          </div>
          <div>
            {field('due_date', tr('Payment due (支払期限)', '支払期限', 'Vencimento (支払期限)'))}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {choices.map(c => (
                <button key={c.key} type="button" className={`btn btn-sm${d.due_date === c.value ? ' btn-primary' : ''}`} onClick={() => set('due_date', c.value)}>
                  {c.label[lk]} <span style={{ opacity: .7, fontSize: 11 }}>{c.value.slice(5).replace('-', '/')}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {[...errors.slice(0, 1), ...warnings].map((w, i) => (
          <div key={i} className={`badge ${i === 0 && errors.length ? 'badge-red' : 'badge-amber'}`} style={{ display: 'block', whiteSpace: 'normal', marginTop: 8, fontSize: 12 }}>
            {msg[w.code]}
          </div>
        ))}
        {children}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
          <button type="button" className="btn btn-primary" disabled={busy || errors.length > 0} onClick={save}>
            {busy ? '…' : (saveLabel || tr('Save dates', '日付を保存', 'Salvar datas'))}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
