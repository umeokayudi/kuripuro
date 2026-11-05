import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { jobEmployeePay, jobPayPackage, saveJobEmployeePay, loadJobPayAudit, isMissingColumn } from '../lib/jobEmployeePay'

/**
 * v1.0.131 · Admin line on a job card: "Pagamento do funcionário: ¥1.000 ✏️" (or "a definir").
 * Separate from the contract Valor, which is never changed here. Changing it on a completed job
 * is recorded (who / when) by the database in job_pay_audit; negative values are refused.
 */
export default function EmployeePayEdit({ job, onSaved, style, showClient = false }) {
  const { tr, locale } = useLang()
  // v1.0.157 · a monthly package has no per-service value: "Funcionário recebe: Pacote mensal"
  const pkg = jobPayPackage(job)
  const pay = pkg ? null : jobEmployeePay(job)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState(null)

  const open = () => { setDraft(pay === null ? '' : String(pay)); setEditing(true) }
  const save = async () => {
    setBusy(true)
    try {
      const saved = await saveJobEmployeePay(supabase, job, draft)
      toast.success(tr('Employee pay saved', '作業者への支払いを保存しました', 'Pagamento do funcionário salvo'))
      setEditing(false)
      setLog(null)
      onSaved?.(saved)
    } catch (e) {
      toast.error(e.message === 'negative' ? tr('Cannot be negative', 'マイナスは不可', 'Não pode ser negativo')
        : e.message === 'invalid' ? tr('Whole yen only', '整数の円のみ', 'Só número inteiro de ¥')
        : isMissingColumn(e) ? tr('Run the SQL 2026-11-02_pagamento_funcionario_job.sql first', '先にSQLを実行してください', 'Rode antes o SQL 2026-11-02_pagamento_funcionario_job.sql')
        : e.message)
    }
    setBusy(false)
  }
  const showLog = async () => setLog(await loadJobPayAudit(supabase, job.id))
  const fmt = n => '¥' + Number(n).toLocaleString(locale)
  const when = d => d ? new Date(d).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div style={{ fontSize: 13, color: 'var(--text2)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, ...style }}>
      {showClient && <span style={{ marginRight: 6 }}>{tr('Client pays', '顧客支払', 'Cliente paga')}: <b style={{ color: 'var(--text)' }}>{fmt(job.retro_value ?? job.value ?? 0)}</b> ·</span>}
      <span>👷 {tr('Worker gets', '作業者受取', 'Funcionário recebe')}:</span>
      {editing ? (
        <>
          <input type="number" inputMode="numeric" min="0" step="1" value={draft} autoFocus
            onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            placeholder={tr('to be defined', '未定', 'a definir')} style={{ width: 110, padding: '4px 8px' }} />
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>{tr('Save', '保存', 'Salvar')}</button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing(false)}>✕</button>
        </>
      ) : (
        <>
          {pkg
            ? <b style={{ color: 'var(--text)' }} title={pkg}>{tr('Monthly package', '月額パッケージ', 'Pacote mensal')}</b>
            : <b style={{ color: pay === null ? 'var(--amber, #b45309)' : 'var(--text)', fontWeight: pay === null ? 600 : 700 }}>{pay === null ? tr('to be defined', '未定', 'a definir') : fmt(pay)}</b>}
          <button type="button" className="btn btn-sm" style={{ padding: '2px 8px', minHeight: 0, lineHeight: 1.4 }} onClick={open} aria-label={tr('Edit employee pay', '支払いを編集', 'Editar pagamento do funcionário')}>✏️</button>
          {job.status === 'completed' && job.employee_pay_updated_at && (
            <button type="button" className="nj-link" style={{ fontSize: 12 }} onClick={log ? () => setLog(null) : showLog}>
              {tr(`changed by ${job.employee_pay_updated_by || '—'} · ${when(job.employee_pay_updated_at)}`, `${job.employee_pay_updated_by || '—'} が変更 · ${when(job.employee_pay_updated_at)}`, `alterado por ${job.employee_pay_updated_by || '—'} · ${when(job.employee_pay_updated_at)}`)}
            </button>
          )}
        </>
      )}
      {log && (
        <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--text3)' }}>
          {log.length ? log.map(r => (
            <div key={r.id}>{when(r.changed_at)} · {r.changed_by}: {r.old_pay === null ? tr('to be defined', '未定', 'a definir') : fmt(r.old_pay)} → {r.new_pay === null ? tr('to be defined', '未定', 'a definir') : fmt(r.new_pay)}</div>
          )) : tr('No change after completion', '完了後の変更なし', 'Nenhuma alteração depois de concluído')}
        </div>
      )}
    </div>
  )
}
