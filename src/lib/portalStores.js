import { DEFAULT_LOCATIONS, SCHEDULE_CLIENTS } from './scheduleGenerator'

export const DEFAULT_PORTAL_PASSWORD = 'Kuripuro2026'

export function storeSlug(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function portalEmailForStore(locationName) {
  return `${storeSlug(locationName)}@portal.kuripuro.com`
}

export function normalizeLoginKey(value) {
  return (value || '').trim().toLowerCase()
}

/** Lojas extras (deep clean opcional, etc.) — também ganham conta portal */
const EXTRA_PORTAL_LOCATIONS = [
  { name: 'Kodama Yurakucho', address: '', notes: 'Key box: TBD', days: [2], serviceType: 'Deep Cleaning' },
]

/** All On The Planet + Atomic store locations with client linkage */
export function getPortalStores() {
  return [...DEFAULT_LOCATIONS, ...EXTRA_PORTAL_LOCATIONS].map(loc => {
    const isAtomic = loc.client === 'Atomic Bar' || loc.name === 'Atomic Bar'
    const client = isAtomic ? SCHEDULE_CLIENTS.atomicbar : SCHEDULE_CLIENTS.ontheplanet
    return {
      location_name: loc.name,
      client_id: client.id,
      client_name: client.name,
      contact_name: loc.name,
      email: portalEmailForStore(loc.name),
      location_address: loc.address || '',
      notes: loc.notes || '',
      service_type: loc.serviceType || 'Basic Cleaning',
      days_of_week: (loc.days || []).map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]),
    }
  })
}

function resolveClientId(store, clients) {
  const byId = clients?.find(c => c.id === store.client_id)
  if (byId) return byId
  return clients?.find(c =>
    c.company_name === store.client_name ||
    c.company_name?.toLowerCase().includes(store.client_name.toLowerCase())
  )
}

/** Create/update portal accounts + service_contracts for every store */
export async function provisionAllStoreAccounts(supabase, clients = []) {
  const stores = getPortalStores()
  const results = { created: 0, updated: 0, contracts: 0, skipped: 0, errors: [] }

  for (const store of stores) {
    const client = resolveClientId(store, clients)
    if (!client?.id) {
      results.errors.push(`${store.location_name}: client "${store.client_name}" not found`)
      continue
    }

    const clientId = client.id
    const clientName = client.company_name || store.client_name

    const { data: existingUsers } = await supabase
      .from('client_users')
      .select('id, email')
      .eq('client_id', clientId)
      .eq('location_name', store.location_name)

    const existing = existingUsers?.[0]

    const userPayload = {
      client_id: clientId,
      client_name: clientName,
      location_name: store.location_name,
      contact_name: store.contact_name,
      email: store.email,
      password: DEFAULT_PORTAL_PASSWORD,
      is_active: true,
    }

    if (existing) {
      const { error } = await supabase.from('client_users').update(userPayload).eq('id', existing.id)
      if (error) results.errors.push(`${store.location_name}: ${error.message}`)
      else results.updated++
    } else {
      const { error } = await supabase.from('client_users').insert(userPayload)
      if (error) results.errors.push(`${store.location_name}: ${error.message}`)
      else results.created++
    }

    const { data: existingContract } = await supabase
      .from('service_contracts')
      .select('id')
      .eq('client_id', clientId)
      .eq('location_name', store.location_name)
      .eq('is_active', true)
      .maybeSingle()

    if (!existingContract) {
      const visits = Math.round((store.days_of_week?.length || 0) * 4.33)
      const { error } = await supabase.from('service_contracts').insert({
        client_id: clientId,
        location_name: store.location_name,
        location_address: store.location_address,
        service_type: store.service_type,
        billing_type: 'per_visit',
        price_per_visit: 0,
        fixed_monthly: 0,
        hours_per_visit: 2,
        days_of_week: store.days_of_week,
        visits_per_month: visits,
        monthly_revenue: 0,
        notes: store.notes,
        is_active: true,
      })
      if (error) results.errors.push(`contract ${store.location_name}: ${error.message}`)
      else results.contracts++
    } else {
      results.skipped++
    }
  }

  return results
}
