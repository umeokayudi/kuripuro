import { requireAdminSecretStrict } from './_auth.js'
import { EQUIPMENT_SETUP_SQL } from '../src/lib/equipmentSetupSql.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const authErr = requireAdminSecretStrict(req)
  if (authErr) return res.status(401).json({ error: authErr })

  const dbUrl = process.env.SUPABASE_DB_URL
  if (!dbUrl) return res.status(500).json({ error: 'SUPABASE_DB_URL not configured' })

  try {
    const postgres = (await import('postgres')).default
    const sql = postgres(dbUrl, { ssl: 'require', max: 1 })
    await sql.unsafe(EQUIPMENT_SETUP_SQL)
    await sql.end()
    return res.status(200).json({ ok: true, message: 'equipment_requests table ready' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
