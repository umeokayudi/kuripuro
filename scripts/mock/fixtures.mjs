// Invented data for the local test stack. No real person, client, price or message is here.
import { randomUUID } from 'node:crypto'
import { tables, storage } from './db.mjs'
import { hashSalesPassword } from '../../api/_salesSession.js'

const pad = n => String(n).padStart(2, '0')
const JST = d => new Date(d.getTime() + 9 * 3600e3)
const ymd = d => { const j = JST(d); return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}` }
const addDays = (n) => new Date(Date.now() + n * 864e5)
const iso = (dayOffset, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = ymd(addDays(dayOffset)); return new Date(`${d}T${pad(h)}:${pad(m)}:00+09:00`).toISOString() }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const PASSWORD = 'Teste@2026'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

export const IDS = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  emp: '00000000-0000-4000-8000-0000000000e1',
  emp2: '00000000-0000-4000-8000-0000000000e2',
  seller: '00000000-0000-4000-8000-0000000000b1',
  clientUser: '00000000-0000-4000-8000-0000000000c1',
  client: '00000000-0000-4000-8000-0000000000d1',
}

export function seed() {
  for (const k of Object.keys(tables)) tables[k].length = 0
  storage.clear()
  const push = (t, row) => { const cols = Object.keys(row); const full = { id: randomUUID(), created_at: new Date(Date.now() - 40 * 864e5).toISOString(), ...row }; tables[t].push(full); return full }
  const T = (t, row) => { const r = push(t, row); return r }

  T('admins', { id: IDS.admin, name: 'Teste Admin', email: 'teste.admin@kuripuro.com', password: PASSWORD })

  const emps = [
    { id: IDS.emp, full_name: 'Teste Funcionário', email: 'teste.funcionario@kuripuro.com', salary_type: 'per_job', fixed_salary: 0, job_bonus_rate: 0 },
    { id: IDS.emp2, full_name: 'Marina Sato', email: 'marina@example.com', salary_type: 'fixed', fixed_salary: 212000, job_bonus_rate: 0 },
    { full_name: 'Rafael Oliveira', email: 'rafael@example.com', salary_type: 'per_job', fixed_salary: 0, job_bonus_rate: 0 },
    { full_name: 'Kenji Mori', email: 'kenji@example.com', salary_type: 'hourly', fixed_salary: 0, job_bonus_rate: 0, hourly_rate: 1300 },
    { full_name: 'Bruna Tanaka', email: 'bruna@example.com', salary_type: 'per_job', fixed_salary: 0, job_bonus_rate: 0, is_active: false },
  ].map((e, i) => T('employees', { phone: `080-0000-00${pad(i)}`, contract_type: 'gyomu_itaku', hourly_rate: 0, score: 100 - i * 4, is_active: true, password: PASSWORD, pin: '1234', hire_date: '2026-06-01', job_role: 'cleaner', location_sharing: true, work_days: 'Mon,Tue,Wed,Thu,Fri', last_seen: new Date(Date.now() - i * 3600e3).toISOString(), is_online: i < 2, last_lat: 35.69 + i * 0.01, last_lng: 139.7 + i * 0.01, last_location_at: new Date().toISOString(), ...e }))

  const clients = [
    { id: IDS.client, company_name: 'Sakura Dining 株式会社', contact_name: 'Yamada Hana', stores: ['Sakura Shinjuku', 'Sakura Shibuya', 'Sakura Ginza', 'Sakura Ueno'] },
    { company_name: 'Bar Aurora', contact_name: 'Carlos Lima', stores: ['Bar Aurora Roppongi'] },
    { company_name: 'Mori Coffee 合同会社', contact_name: 'Mori Aya', stores: ['Mori Coffee Kanda', 'Mori Coffee Akihabara'] },
    { company_name: 'Escritório Horizonte', contact_name: 'Paula Reis', stores: ['Horizonte Marunouchi'] },
  ].map(c => { const { stores, ...row } = c; const r = T('clients', { contact_person: row.contact_name, phone: '03-0000-0000', email: 'contato@example.com', address: 'Tokyo', service_type: 'Basic Cleaning', monthly_revenue: 0, is_active: true, manager_name: 'Teste Admin', ...row }); r._stores = stores; return r })

  T('client_users', { id: IDS.clientUser, client_id: IDS.client, client_name: clients[0].company_name, location_name: null, contact_name: 'Teste Cliente', email: 'teste.cliente@kuripuro.com', password: PASSWORD, is_active: true })
  T('salespeople', { id: IDS.seller, full_name: 'Teste Vendedor', email: 'teste.vendedor@kuripuro.com', password_hash: hashSalesPassword(PASSWORD), phone: '080-1111-2222', is_active: true, team: 'sales' })
  T('salespeople', { full_name: 'Teste Marketing', email: 'teste.marketing@kuripuro.com', password_hash: hashSalesPassword(PASSWORD), is_active: true, team: 'marketing' })

  let storeN = 0
  const stores = []
  for (const c of clients) for (const name of c._stores) {
    storeN++
    const loc = T('locations', { name, address: `東京都新宿区${storeN}-1-1`, gps_lat: 35.66 + storeN * 0.012, gps_lng: 139.69 + storeN * 0.011, location_type: 'restaurant', client_id: c.id, is_active: true })
    const price = 3500 + storeN * 250
    const days = storeN % 2 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Mon', 'Wed', 'Fri']
    T('service_contracts', { client_id: c.id, location_name: name, location_address: loc.address, service_type: 'Basic Cleaning', price_per_visit: price, hours_per_visit: 0.7, days_of_week: days, visits_per_month: days.length * 4, monthly_revenue: price * days.length * 4, is_active: true, tax_rate: 10, price_includes_tax: false, billing_type: 'per_visit', billing_day: 31, area: 'Tokyo', contract_details: { start_date: '2026-08-01' } })
    T('service_contracts', { client_id: c.id, location_name: name, location_address: loc.address, service_type: 'Deep Clean', price_per_visit: 22000, hours_per_visit: 2, days_of_week: [], visits_per_month: 1, monthly_revenue: 22000, is_active: true, tax_rate: 10, price_includes_tax: false, billing_type: 'per_visit', billing_day: 31, area: 'Tokyo', notes: 'Grease Trap', contract_details: { start_date: '2026-08-01' } })
    stores.push({ ...loc, client: c, price, days })
  }

  // Services: 10 days back, 5 days ahead
  const workers = emps.filter(e => e.is_active)
  let seq = 0
  for (let d = -10; d <= 5; d++) {
    const dow = DOW[JST(addDays(d)).getUTCDay()]
    stores.forEach((s, i) => {
      if (!s.days.includes(dow)) return
      const w = workers[i % 3]
      const start = `${pad(1 + (i % 6))}:${i % 2 ? '30' : '00'}`
      const past = d < 0, today = d === 0
      let status = 'pending', started_at = null, completed_at = null
      if (past) { status = (i + d) % 11 === 0 ? 'cancelled' : 'completed' }
      if (today) { status = i < 3 ? 'completed' : i === 3 ? 'in_progress' : 'pending' }
      if (status === 'completed') { started_at = iso(d, start); completed_at = new Date(new Date(started_at).getTime() + (38 + i * 3) * 60e3).toISOString() }
      if (status === 'in_progress') started_at = new Date(Date.now() - 25 * 60e3).toISOString()
      T('jobs', { title: `${s.name} — Basic Cleaning`, client_id: s.client.id, client_name: s.client.company_name, employee_id: w.id, employee_name: w.full_name, scheduled_date: ymd(addDays(d)), scheduled_time: start, address: s.address, gps_lat: s.gps_lat, gps_lng: s.gps_lng, value: s.price, description: `Pagamento do funcionário (${w.full_name}): ¥1,000`, photo_required: true, status, started_at, completed_at, job_category: 'routine', counts_as_work_day: true, sequence_order: ++seq, checklist_total: 8, checklist_done: status === 'completed' ? 8 : 0, admin_reviewed: past, area: 'Tokyo', employee_pay: 1000, photo_start_url: status === 'completed' ? 'https://example.invalid/antes.jpg' : null, photo_end_url: status === 'completed' ? 'https://example.invalid/depois.jpg' : null, created_at: iso(d - 3, '10:00') })
    })
  }
  // A spot offer, an unassigned job and a deep clean
  T('jobs', { title: 'Bar Aurora Roppongi — Deep Clean (Grease Trap)', client_id: clients[1].id, client_name: clients[1].company_name, employee_id: IDS.emp, employee_name: 'Teste Funcionário', scheduled_date: ymd(addDays(1)), scheduled_time: '09:00', address: stores[4].address, value: 22000, status: 'pending', job_category: 'spot', spot_value: 3000, spot_status: 'offered', employee_pay: 3000, photo_required: true, checklist_total: 5, checklist_done: 0 })
  T('jobs', { title: 'Horizonte Marunouchi — Basic Cleaning', client_id: clients[3].id, client_name: clients[3].company_name, employee_id: null, employee_name: null, scheduled_date: ymd(addDays(0)), scheduled_time: '20:00', address: stores[7].address, value: 5200, status: 'pending', job_category: 'routine', photo_required: true })
  T('jobs', { title: 'Sakura Ginza — Deep Clean (Range Hood)', client_id: IDS.client, client_name: clients[0].company_name, employee_id: IDS.emp, employee_name: 'Teste Funcionário', scheduled_date: ymd(addDays(-2)), scheduled_time: '02:00', address: stores[2].address, value: 22000, status: 'cancelled', job_category: 'routine', employee_pay: 1471, photo_required: true })

  const month = ymd(new Date()).slice(0, 7)
  const prev = ymd(addDays(-31)).slice(0, 7)
  clients.forEach((c, i) => {
    const sub = 180000 + i * 65000
    const f = T('faturas', { client_id: c.id, client_name: c.company_name, period_start: `${prev}-01`, period_end: `${prev}-28`, issue_date: `${month}-01`, due_date: `${month}-${i === 1 ? '05' : '30'}`, subtotal: sub, tax_amount: sub / 10, total: sub * 1.1, tax_rate: 10, status: ['sent', 'overdue', 'paid', 'draft'][i], paid_at: i === 2 ? new Date().toISOString() : null })
    T('fatura_items', { fatura_id: f.id, description: `${prev} 清掃`, quantity: 1, unit_price: sub, total: sub })
  })
  const lead = T('sales_leads', { stage: 'quoted', company_name: 'Izakaya Lua 株式会社', contact_name: 'Sato Ken', phone: '03-1234-5678', email: 'ken@example.com', source: 'visit', expected_monthly: 120000, salesperson_id: IDS.seller, first_contact_date: ymd(addDays(-9)), next_followup_date: ymd(addDays(1)), region: 'Shinjuku', needs: 'Limpeza diária da cozinha' })
  T('sales_leads', { stage: 'new', company_name: 'Padaria Sol', contact_name: 'Ana', phone: '03-2222-3333', salesperson_id: IDS.seller, first_contact_date: ymd(addDays(-2)), next_followup_date: ymd(addDays(0)), region: 'Shibuya' })
  T('sales_leads', { stage: 'won', company_name: 'Hotel Brisa', contact_name: 'Ito', salesperson_id: IDS.seller, expected_monthly: 300000, closed_at: new Date().toISOString(), first_contact_date: ymd(addDays(-30)) })
  T('sales_leads', { stage: 'contacted', company_name: 'Clínica Vida', contact_name: 'Dr. Abe', salesperson_id: null, first_contact_date: ymd(addDays(-4)) })
  const q = T('mitsumori', { lead_id: lead.id, quote_number: 'KPQ-TESTE-001', company_name: clients[0].company_name, contact_name: 'Yamada Hana', issue_date: ymd(addDays(-3)), valid_until: ymd(addDays(27)), frequency: 'monthly', tax_rate: 10, subtotal: 350000, tax_amount: 35000, total: 385000, status: 'sent', sent_at: new Date().toISOString(), salesperson_id: IDS.seller, notes: 'カーペット清掃' })
  T('mitsumori_items', { mitsumori_id: q.id, description: 'カーペット洗浄', quantity: 1, unit_price: 350000, total: 350000 })
  T('client_requests', { client_id: IDS.client, client_user_id: IDS.clientUser, location_name: 'Sakura Shinjuku', description: 'Limpeza extra do ar-condicionado', preferred_date: ymd(addDays(6)), status: 'pending', ticket_number: 'REQ-0001', request_type: 'quote', category: 'ac' })
  for (let i = 0; i < 130; i++) T('client_messages', { client_id: IDS.client, client_user_id: IDS.clientUser, client_name: clients[0].company_name, location_name: null, sender: i % 3 ? 'client' : 'admin', content: i === 129 ? 'Mensagem mais recente (nº 130)' : `Mensagem de teste nº ${i + 1}`, read: i < 127, created_at: new Date(Date.now() - (130 - i) * 3600e3).toISOString() })
  for (let i = 0; i < 6; i++) T('messages', { employee_id: IDS.emp, employee_name: 'Teste Funcionário', sender: i % 2 ? 'admin' : 'employee', content: `Recado ${i + 1}`, read: i < 5, created_at: new Date(Date.now() - (6 - i) * 7200e3).toISOString() })
  workers.forEach((w, i) => {
    T('salary_payments', { employee_id: w.id, employee_name: w.full_name, period: prev, amount: 40000 + i * 9000, payment_date: `${month}-15`, status: i ? 'scheduled' : 'paid', description: 'Salário', payment_type: 'salary', is_deduction: false })
    T('evaluations', { employee_id: w.id, employee_name: w.full_name, type: 'praise', stars: 5 - (i % 2), points_change: 2, category: 'quality', description: 'Ótimo trabalho', eval_date: ymd(addDays(-3)) })
  })
  T('employee_availability', { employee_id: IDS.emp2, employee_name: 'Marina Sato', date: ymd(addDays(3)), kind: 'off', note: 'Consulta médica', status: 'pending' })
  T('transport_claims', { employee_id: IDS.emp, employee_name: 'Teste Funcionário', claim_date: ymd(addDays(-1)), amount: 480, route: 'Shinjuku → Ginza', status: 'pending' })
  T('equipment_requests', { employee_id: IDS.emp, employee_name: 'Teste Funcionário', category: 'supplies', item_name: 'Luvas M', quantity: 2, reason: 'Acabaram', status: 'pending' })
  T('client_ratings', { client_id: IDS.client, client_user_id: IDS.clientUser, employee_name: 'Teste Funcionário', location_name: 'Sakura Shinjuku', stars: 5, comment: 'Muito limpo!' })
  for (let i = 0; i < 8; i++) T('cashflow', { entry_type: i % 3 ? 'income' : 'expense', category: i % 3 ? 'invoice' : 'supplies', description: i % 3 ? 'Recebimento de fatura' : 'Material de limpeza', amount: i % 3 ? 198000 + i * 1000 : 12000 + i * 500, entry_date: ymd(addDays(-i * 4)) })
  T('business_partners', { name: 'Parceiro Exemplo', category: 'supplier', contact_name: 'Kato', phone: '03-9999-0000', is_active: true })
  T('marketing_channels', { name: 'Instagram', channel_type: 'social', platform: 'instagram', is_active: true })
  storage.set('service-photos/mock/pixel.png', { body: PNG, type: 'image/png', updated: new Date().toISOString() })
  for (const c of clients) delete c._stores
  return { clients, stores, emps }
}
