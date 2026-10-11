import { useEffect } from 'react'
import { commissionFromRule } from '../lib/contractCommission'
import { ruleFor } from '../lib/contractSellers'

// Seller (salespeople) + commission on a contract. `contract` gives price/tax for the rule;
// `value` holds salesperson_id / commission_*; onChange gets the fields to merge.
export default function SellerCommissionFields({ sellers = [], rules = [], contract, value, onChange, monthly = false }) {
  const rule = ruleFor(rules, value.salesperson_id)
  const fromRule = id => {
    const seller = sellers.find(s => s.id === id)
    return { salesperson_id: id || null, salesperson_name: seller?.full_name || null, ...commissionFromRule(ruleFor(rules, id), contract) }
  }
  // A percent commission from the rule follows the price as it is typed; a typed amount stays.
  const ruleAmount = rule && value.commission_type === 'percent' ? commissionFromRule(rule, contract).commission_amount : null
  useEffect(() => {
    if (ruleAmount != null && ruleAmount !== Number(value.commission_amount)) onChange({ commission_amount: ruleAmount })
  }, [ruleAmount]) // eslint-disable-line react-hooks/exhaustive-deps
  const ruleText = rule ? (rule.commission_type === 'fixed' ? `rule: ¥${Number(rule.commission_value).toLocaleString()} fixed` : `rule: ${rule.commission_value}% of ${rule.percent_basis === 'contract_total' ? 'price with tax' : 'price without tax'}`) : value.salesperson_id ? 'no rule set in Sales Team — type the amount' : ''
  return (
    <>
      <div className="form-group"><label>💼 Seller (commission)</label>
        <select value={value.salesperson_id || ''} onChange={e => onChange(fromRule(e.target.value))}>
          <option value="">— No seller —</option>
          {sellers.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      </div>
      <div className="form-group"><label>Commission (¥{monthly ? '/month' : ''})</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="number" min="0" disabled={!value.salesperson_id} value={value.salesperson_id ? (value.commission_amount ?? 0) : ''}
            onChange={e => onChange({ commission_amount: e.target.value, commission_type: 'fixed', commission_value: e.target.value })} />
          {rule && <button type="button" className="btn btn-sm" title="Recalculate from the rule" onClick={() => onChange(fromRule(value.salesperson_id))}>↻</button>}
        </div>
        {ruleText && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{ruleText}</div>}
      </div>
    </>
  )
}
