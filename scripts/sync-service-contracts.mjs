#!/usr/bin/env node
import { loadEnvLocal } from './_loadEnv.mjs'
loadEnvLocal()
import {
  SCHEDULE_CLIENTS,
  OTP_BASIC_LOCATIONS,
  ATOMIC_LOCATION,
  DUSKIN_SITES,
  MATSUNAGA_SPOT,
  MAINTENANCE_SERVICES,
  daysToDowNames,
  visitsPerMonth,
  monthlyRevenue,
} from '../src/lib/serviceCatalog.js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!KEY) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY ou VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function sb(method, path, body) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!resp.ok) throw new Error(`${method} ${path}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

async function upsertContract(clientId, locationName, payload) {
  const existing = await sb(
    'GET',
    `service_contracts?client_id=eq.${clientId}&location_name=eq.${encodeURIComponent(locationName)}&select=id&limit=1`
  )
  if (existing?.[0]?.id) {
    await sb('PATCH', `service_contracts?id=eq.${existing[0].id}`, payload)
    return 'updated'
  }
  await sb('POST', 'service_contracts', { client_id: clientId, location_name: locationName, ...payload, is_active: true })
  return 'created'
}

async function main() {
  const stats = { created: 0, updated: 0, errors: [] }

  for (const loc of OTP_BASIC_LOCATIONS) {
    const days = daysToDowNames(loc.days)
    const payload = {
      location_address: loc.address || '',
      service_type: 'Basic Cleaning',
      price_per_visit: loc.pricePerVisit,
      hours_per_visit: 2,
      days_of_week: days,
      visits_per_month: visitsPerMonth(loc.days),
      monthly_revenue: monthlyRevenue(loc.pricePerVisit, loc.days),
      notes: loc.notes,
      is_active: true,
    }
    try {
      const r = await upsertContract(SCHEDULE_CLIENTS.ontheplanet.id, loc.name, payload)
      stats[r]++
    } catch (e) {
      stats.errors.push(`${loc.name}: ${e.message}`)
    }
  }

  // Atomic
  try {
    const days = ['Mon']
    const r = await upsertContract(SCHEDULE_CLIENTS.atomicbar.id, ATOMIC_LOCATION.name, {
      location_address: ATOMIC_LOCATION.address,
      service_type: 'Basic Cleaning',
      price_per_visit: ATOMIC_LOCATION.pricePerVisit,
      hours_per_visit: 3,
      days_of_week: days,
      visits_per_month: 4,
      monthly_revenue: ATOMIC_LOCATION.pricePerVisit * 4,
      notes: ATOMIC_LOCATION.notes,
      is_active: true,
    })
    stats[r]++
  } catch (e) {
    stats.errors.push(`Atomic: ${e.message}`)
  }

  // Duskin — contratos de referência (faturamento)
  for (const site of Object.values(DUSKIN_SITES)) {
    try {
      const r = await upsertContract(SCHEDULE_CLIENTS.duskin.id, site.name, {
        service_type: 'Monthly Cleaning',
        price_per_visit: 15000,
        hours_per_visit: 3,
        days_of_week: ['Sun'],
        visits_per_month: 3,
        monthly_revenue: 45000,
        notes: site.notes,
        is_active: true,
      })
      stats[r]++
    } catch (e) {
      stats.errors.push(`Duskin ${site.name}: ${e.message}`)
    }
  }

  // Matsunaga spot
  try {
    const r = await upsertContract(SCHEDULE_CLIENTS.matsunaga.id, MATSUNAGA_SPOT.name, {
      service_type: MATSUNAGA_SPOT.serviceType,
      price_per_visit: 0,
      hours_per_visit: 2,
      days_of_week: [],
      visits_per_month: 0,
      monthly_revenue: 0,
      notes: MATSUNAGA_SPOT.notes,
      is_active: true,
    })
    stats[r]++
  } catch (e) {
    stats.errors.push(`Matsunaga: ${e.message}`)
  }

  // Manutenção OTP — contratos de referência (jobs manuais)
  for (const svc of MAINTENANCE_SERVICES) {
    try {
      const r = await upsertContract(SCHEDULE_CLIENTS.ontheplanet.id, `OTP — ${svc.serviceType}`, {
        service_type: svc.serviceType,
        price_per_visit: 5000,
        hours_per_visit: 2,
        days_of_week: [],
        visits_per_month: 0,
        monthly_revenue: 0,
        notes: `${svc.frequency}. ${svc.notes}`,
        is_active: true,
      })
      stats[r]++
    } catch (e) {
      stats.errors.push(`${svc.serviceType}: ${e.message}`)
    }
  }

  console.log(JSON.stringify(stats, null, 2))
  if (stats.errors.length) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
