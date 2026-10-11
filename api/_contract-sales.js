import { salesDb, requireSalesSession } from './_salesSession.js'

// Sellers and their commission rules for the admin contract forms (Contracts → spot / fixed).
// sales_commission_rules is not readable from the browser, so the admin asks here.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const user = requireSalesSession(req, res, ['admin'])
  if (!user) return
  try {
    const db = salesDb()
    const [people, rules] = await Promise.all([
      db.from('salespeople').select('id,full_name,is_active').order('full_name'),
      db.from('sales_commission_rules').select('salesperson_id,commission_type,commission_value,percent_basis'),
    ])
    if (people.error) throw people.error
    if (rules.error) throw rules.error
    return res.status(200).json({ salespeople: people.data || [], rules: rules.data || [] })
  } catch (error) {
    console.error('[contract-sellers]', error?.message || error)
    return res.status(500).json({ error: 'Não foi possível carregar os vendedores.' })
  }
}
