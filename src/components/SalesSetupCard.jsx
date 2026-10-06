import { useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import {
  SALES_CRM_SQL,
  SALES_CRM_SQL_URL,
  SALES_SETUP_SQL,
  SALES_SETUP_STEPS,
  SALES_SQL_FILE_URL,
  SUPABASE_SQL_URL,
} from '../lib/salesSetupSql'

export default function SalesSetupCard({ onRecheck }) {
  const { t } = useLang()
  const s = t.sales
  const [step, setStep] = useState(0)

  const copy = async (text, ok) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(ok || s.copied)
    } catch {
      toast.error(s.copyFailed)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 14, borderColor: 'var(--amber)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.setupNeeded}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10, lineHeight: 1.55 }}>{s.setupHint}</div>
      <ol style={{ margin: '0 0 12px 18px', padding: 0, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
        <li>{s.setupStep1}</li>
        <li>{s.setupStep2}</li>
        <li>{s.setupStep3}</li>
        <li>{s.setupStep4}</li>
      </ol>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" className="btn btn-primary" onClick={() => copy(SALES_SETUP_SQL)}>{s.copySql}</button>
        <button type="button" className="btn" onClick={() => copy(SALES_SETUP_STEPS[step].sql, s.copiedStep)}>{s.copyStep} {step + 1}/3</button>
        <a className="btn" href={SUPABASE_SQL_URL} target="_blank" rel="noreferrer">{s.openSql}</a>
        <a className="btn" href={SALES_SQL_FILE_URL} target="_blank" rel="noreferrer">{s.openSqlFile}</a>
        {onRecheck && <button type="button" className="btn" onClick={onRecheck}>{s.recheck}</button>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {SALES_SETUP_STEPS.map((row, i) => (
          <button
            key={row.id}
            type="button"
            className={`tab-pill${step === i ? ' active' : ''}`}
            onClick={() => setStep(i)}
          >
            {i + 1}. {s[`setupChunk_${row.id}`] || row.id}
          </button>
        ))}
      </div>
      <textarea
        readOnly
        value={SALES_SETUP_STEPS[step].sql}
        onFocus={e => e.target.select()}
        style={{ width: '100%', minHeight: 180, fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.4, padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}
      />
      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>{s.setupVerify}</div>
    </div>
  )
}

export function SalesCrmSetupCard({ onRecheck }) {
  const { t } = useLang()
  const s = t.sales

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SALES_CRM_SQL)
      toast.success(s.copied)
    } catch {
      toast.error(s.copyFailed)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 14, borderColor: 'var(--amber)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.crmSetup}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10, lineHeight: 1.55 }}>{s.crmHint}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" className="btn btn-primary" onClick={copy}>{s.copyCrmSql}</button>
        <a className="btn" href={SUPABASE_SQL_URL} target="_blank" rel="noreferrer">{s.openSql}</a>
        <a className="btn" href={SALES_CRM_SQL_URL} target="_blank" rel="noreferrer">{s.openCrmSqlFile}</a>
        {onRecheck && <button type="button" className="btn" onClick={onRecheck}>{s.recheck}</button>}
      </div>
      <textarea
        readOnly
        value={SALES_CRM_SQL}
        onFocus={e => e.target.select()}
        style={{ width: '100%', minHeight: 160, fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.4, padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}
      />
    </div>
  )
}
