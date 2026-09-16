import toast from 'react-hot-toast'
import { SALARY_SETUP_SQL, SUPABASE_SQL_URL } from '../lib/salarySetupSql'

export default function SchemaMissingBanner({ title, hint, copyLabel = 'Copy SQL', openLabel = 'Open Supabase', copiedLabel = 'SQL copied' }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SALARY_SETUP_SQL)
      toast.success(copiedLabel)
    } catch {
      toast.error(copyLabel)
    }
  }

  return (
    <div style={{ background: 'rgba(239,159,39,0.1)', border: '1px solid rgba(239,159,39,0.3)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>⚠️ {title}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{hint}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={copy}>{copyLabel}</button>
        <a className="btn" href={SUPABASE_SQL_URL} target="_blank" rel="noreferrer">{openLabel}</a>
      </div>
    </div>
  )
}
