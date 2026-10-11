import { supabase } from './supabase'

// Sellers (salespeople) and their commission rules for the contract forms.
// Rules need the admin server session; without it the list still loads, with no rules.
export async function fetchContractSellers() {
  try {
    const res = await fetch('/api/sales?action=contract-sellers', { credentials: 'same-origin' })
    if (res.ok) {
      const body = await res.json()
      return { salespeople: (body.salespeople || []).filter(p => p.is_active !== false), rules: body.rules || [] }
    }
  } catch {
    // fallback abaixo
  }
  const { data } = await supabase.from('salespeople').select('id,full_name').eq('is_active', true).order('full_name')
  return { salespeople: data || [], rules: [] }
}

export const ruleFor = (rules, sellerId) => (rules || []).find(r => r.salesperson_id === sellerId) || null
