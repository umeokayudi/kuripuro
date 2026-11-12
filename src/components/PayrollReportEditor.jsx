import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { saveJobEmployeePay, isMissingColumn } from '../lib/jobEmployeePay'
import { cancelPatch, cancelText } from '../lib/deductionReview'
import { getPeriodDates } from '../lib/salaryPeriod'
import { tokyoToday } from '../lib/dates'
import { reportRows, fillEmpty, previewMonth } from '../lib/payrollReport'
import './PayrollReportEditor.css'

// v1.0.209 · Folha → "Relatório do mês": every completed job with date, place, type, hours and the
// value paid to the employee, editable line by line before sending. Extras (+) and deductions (−)
// can be added or taken out. "Salvar e enviar" saves the values on each job and recalculates the
// payslip, so the employee confirms the new number and every screen shows the same one.
export default function PayrollReportEditor({ person, period, jobs, lines, basis, locked, onSend, onChanged }) {
  const { tr, locale } = useLang()
  const [edits, setEdits] = useState({})
  const [fill, setFill] = useState({ basic: '', deep: '' })
  const [add, setAdd] = useState({ kind: 'extra', description: '', amount: '' })
  const [busy, setBusy] = useState(false)
  const fmt = n => '¥' + Math.round(Number(n || 0)).toLocaleString(locale)
  const fmtDay = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', weekday: 'short' }) : ''

  const rows = useMemo(() => reportRows(jobs, edits), [jobs, edits])
  const calc = useMemo(() => previewMonth({ emp: person, jobs, lines, month: period, basis, edits }), [person, jobs, lines, period, basis, edits])
  const used = calc.basis || calc.autoBasis
  const dirty = rows.filter(r => r.dirty)
  const bad = rows.some(r => r.bad)
  const empty = rows.filter(r => r.pay === null && r.kind !== 'spot').length
  const live = (lines || []).filter(l => l.status !== 'cancelled')
  const extras = live.filter(l => l.payment_type === 'extra' && !l.is_deduction)
  const deds = calc.dedRows || []
  const sumJobs = rows.reduce((s, r) => s + (r.pay || 0), 0)

  const setVal = (id, v) => setEdits(e => ({ ...e, [id]: v }))
  const applyFill = () => {
    if (!String(fill.basic).trim() && !String(fill.deep).trim()) return toast.error(tr('Type a value', '金額を入力', 'Digite um valor'))
    setEdits(e => fillEmpty(rows, e, fill))
  }

  const saveValues = async () => {
    for (const r of dirty) await saveJobEmployeePay(supabase, r.job, r.value)
    setEdits({})
  }

  const save = async (send) => {
    if (bad) return toast.error(tr('Fix the values in red', '赤い金額を直してください', 'Corrija os valores em vermelho'))
    setBusy(true)
    try {
      await saveValues()
      if (send) await onSend()
      else { toast.success(tr('Values saved', '保存しました', 'Valores salvos')); onChanged() }
    } catch (e) {
      toast.error(isMissingColumn(e) ? tr('Run the SQL 2026-11-02_pagamento_funcionario_job.sql first', '先にSQLを実行してください', 'Rode antes o SQL 2026-11-02_pagamento_funcionario_job.sql') : e.message)
    }
    setBusy(false)
  }

  const addLine = async () => {
    const amount = Math.round(Number(String(add.amount).replace(/[^0-9]/g, '')))
    if (!amount || !add.description.trim()) return toast.error(tr('Fill description and value', '内容と金額を入力', 'Preencha descrição e valor'))
    const isDed = add.kind === 'deduction'
    setBusy(true)
    const { payDate } = getPeriodDates(period)
    const { error } = await supabase.from('salary_payments').insert({
      employee_id: person.id, employee_name: person.full_name, period, amount,
      payment_date: isDed ? tokyoToday() : payDate, description: add.description.trim(),
      status: 'scheduled', payment_type: isDed ? 'deduction' : 'extra', is_deduction: isDed,
    })
    setBusy(false)
    if (error) return toast.error(error.message)
    setAdd({ kind: add.kind, description: '', amount: '' })
    toast.success(isDed ? tr('Deduction added', '控除を追加しました', 'Desconto adicionado') : tr('Extra added', '追加しました', 'Extra adicionado'))
    onChanged()
  }

  const removeLine = async (row) => {
    let who = 'admin'
    try { who = JSON.parse(localStorage.getItem('kp_user') || '{}').name || 'admin' } catch { /* private mode */ }
    setBusy(true)
    const patch = row.is_deduction ? cancelPatch(row, who, tokyoToday()) : { status: 'cancelled' }
    const { error } = await supabase.from('salary_payments').update(patch).eq('id', row.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(tr('Line removed', '行を外しました', 'Linha retirada'))
    onChanged()
  }

  const dis = locked || busy

  return (
    <div className="prr">
      <div className="prr-head">
        <b>{tr('Month report', '月の作業レポート', 'Relatório do mês')}</b>
        <span>{rows.length} {tr('jobs', '件', 'serviços')}{empty ? ` · ${empty} ${tr('to define', '未定', 'a definir')}` : ''}</span>
      </div>
      {used === 'fixed' && <p className="pm-hint">{tr('This month counts the fixed salary: the job values below are shown but not added.', '今月は固定給で計算：下の作業金額は表示のみです。', 'Neste mês vale o salário fixo: os valores dos serviços abaixo aparecem, mas não somam.')}</p>}

      {!locked && empty > 0 && (
        <div className="prr-fill">
          <span>{tr('Fill the empty ones', '未定を一括入力', 'Preencher os vazios')}:</span>
          <label>Basic ¥<input inputMode="numeric" value={fill.basic} onChange={e => setFill(f => ({ ...f, basic: e.target.value }))} placeholder="1000" /></label>
          <label>Deep ¥<input inputMode="numeric" value={fill.deep} onChange={e => setFill(f => ({ ...f, deep: e.target.value }))} placeholder="1000" /></label>
          <button type="button" className="btn btn-sm" onClick={applyFill}>{tr('Apply', '適用', 'Aplicar')}</button>
        </div>
      )}

      <div className="prr-table" role="table">
        <div className="prr-row is-th" role="row">
          <span>{tr('Date', '日付', 'Data')}</span><span>{tr('Place · service', '現場・作業', 'Local · serviço')}</span><span className="r">{tr('Hours', '時間', 'Horas')}</span><span className="r">{tr('Value', '金額', 'Valor')}</span><span />
        </div>
        {rows.map(r => (
          <div key={r.id} role="row" className={`prr-row${r.dirty ? ' is-dirty' : ''}${r.pay === 0 ? ' is-zero' : ''}`}>
            <span className="prr-date">{fmtDay(r.date)}</span>
            <span className="prr-place"><b>{r.place}</b>{r.kindText && <small>{r.kindText}</small>}{r.spot > 0 && <small className="prr-spot">spot +{fmt(r.spot)}</small>}</span>
            <span className="r prr-h">{r.hours.toFixed(1)}h</span>
            <span className="r">
              <input className={`prr-in${r.bad ? ' is-bad' : ''}`} inputMode="numeric" disabled={dis} value={r.value}
                placeholder={tr('to define', '未定', 'a definir')} aria-label={`${r.place} ${fmtDay(r.date)}`}
                onChange={e => setVal(r.id, e.target.value)} />
            </span>
            <span>{!locked && <button type="button" className="prr-x" disabled={dis} title={tr('Do not pay (¥0)', '支払わない（¥0）', 'Não pagar (¥0)')} onClick={() => setVal(r.id, r.pay === 0 ? (r.saved === null ? '' : String(r.saved)) : '0')}>{r.pay === 0 ? '↺' : '✕'}</button>}</span>
          </div>
        ))}
        <div className="prr-row is-sum" role="row"><span /><span>{tr('Jobs total', '作業合計', 'Total dos serviços')}</span><span /><span className="r">{fmt(sumJobs)}</span><span /></div>
      </div>

      <div className="prr-lines">
        {extras.map(l => (
          <div key={l.id} className="prr-line"><span>＋ {l.description || 'Extra'}</span><b>+{fmt(l.amount)}</b>
            {!locked && <button type="button" className="prr-x" disabled={dis} onClick={() => removeLine(l)} title={tr('Remove', '外す', 'Tirar')}>✕</button>}</div>
        ))}
        {deds.map(l => (
          <div key={l.id} className="prr-line is-neg"><span>− {cancelText(l)}</span><b>−{fmt(l.amount)}</b>
            {!locked && <button type="button" className="prr-x" disabled={dis} onClick={() => removeLine(l)} title={tr('Remove', '外す', 'Tirar')}>✕</button>}</div>
        ))}
        {!locked && (
          <div className="prr-add">
            <select value={add.kind} onChange={e => setAdd(a => ({ ...a, kind: e.target.value }))} aria-label={tr('Type', '種類', 'Tipo')}>
              <option value="extra">＋ {tr('Extra', '追加', 'Extra')}</option>
              <option value="deduction">− {tr('Deduction', '控除', 'Desconto')}</option>
            </select>
            <input value={add.description} onChange={e => setAdd(a => ({ ...a, description: e.target.value }))} placeholder={tr('Description', '内容', 'Descrição')} />
            <input inputMode="numeric" value={add.amount} onChange={e => setAdd(a => ({ ...a, amount: e.target.value }))} placeholder="¥" />
            <button type="button" className="btn btn-sm" disabled={dis} onClick={addLine}>{tr('Add', '追加', 'Adicionar')}</button>
          </div>
        )}
      </div>

      <dl className="sp-rows prr-total">
        <div><dt>{used === 'fixed' ? tr('Fixed salary', '固定給', 'Salário fixo') : tr('Jobs', '作業', 'Serviços')}</dt><dd>{fmt(calc.base)}</dd></div>
        {calc.jobsPay > 0 && <div><dt>Spot</dt><dd>+{fmt(calc.jobsPay)}</dd></div>}
        {calc.extras > 0 && <div><dt>{tr('Extras', '追加', 'Extras')}</dt><dd>+{fmt(calc.extras)}</dd></div>}
        {calc.deductions > 0 && <div><dt>{tr('Deductions', '控除', 'Descontos')}</dt><dd style={{ color: 'var(--red, #dc2626)' }}>−{fmt(calc.deductions)}</dd></div>}
        <div><dt><b>{tr('Net to pay', '差引支給額', 'Líquido a pagar')}</b></dt><dd className="sp-big">{fmt(calc.net)}</dd></div>
      </dl>

      {!locked && (
        <div className="prr-actions">
          {dirty.length > 0 && <span className="prr-dirty">{dirty.length} {tr('value(s) changed, not saved', '件 未保存', 'valor(es) mudado(s), não salvo(s)')}</span>}
          <button type="button" className="btn" disabled={dis || !dirty.length} onClick={() => save(false)}>{tr('Save values', '保存', 'Salvar valores')}</button>
          <button type="button" className="btn btn-primary" disabled={dis} onClick={() => save(true)}>{tr('Save and send to the employee', '保存して本人に送る', 'Salvar e enviar ao funcionário')}</button>
        </div>
      )}
    </div>
  )
}
