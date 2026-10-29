// Guided chain for registries: Person → Client → Place → Contract → Agenda.
// Value and checklist of a job come from the contract, so each step links to the next one.
import { Link } from 'react-router-dom'
import { useLang } from '../hooks/useLang'

export default function SetupChain({ current, clientId }) {
  const { tr } = useLang()
  const q = clientId ? `client=${clientId}` : ''
  const steps = [
    ['person', tr('Person', '担当者', 'Pessoa'), '/users'],
    ['client', tr('Client', '顧客', 'Cliente'), '/clients'],
    ['place', tr('Place', '場所', 'Local'), `/jobs?tab=locations${q ? '&' + q : ''}`],
    ['contract', tr('Contract', '契約', 'Contrato'), `/contracts${q ? '?' + q : ''}`],
    ['agenda', tr('Agenda', '予定', 'Agenda'), '/jobs'],
  ]
  const at = steps.findIndex(s => s[0] === current)
  return (
    <nav aria-label={tr('Setup steps', '登録の流れ', 'Passos do cadastro')} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 12, marginBottom: 12 }}>
      {steps.map(([key, label, to], i) => (
        <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && <span style={{ color: 'var(--text3)' }}>→</span>}
          {i === at
            ? <b style={{ padding: '3px 10px', borderRadius: 999, background: 'var(--navy)', color: '#fff' }}>{i + 1}. {label}</b>
            : <Link to={to} style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid var(--border)', color: i === at + 1 ? 'var(--navy2, #315cf5)' : 'var(--text2)', fontWeight: i === at + 1 ? 700 : 500, textDecoration: 'none' }}>{i + 1}. {label}{i === at + 1 ? ' ›' : ''}</Link>}
        </span>
      ))}
    </nav>
  )
}
