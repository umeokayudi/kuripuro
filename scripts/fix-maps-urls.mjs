#!/usr/bin/env node
/**
 * Replace broken goo.gl / share.google URLs with full Google Maps links.
 * Usage: node scripts/fix-maps-urls.mjs
 */
import { getSupabaseEnv, assertSupabaseKey, supabaseHeaders } from './_supabaseEnv.mjs'
import { OTP_BASIC_LOCATIONS, ATOMIC_LOCATION } from '../src/lib/serviceCatalog.js'

function locationNameFromTitle(title) {
  return (title || '').replace(/ — .*/, '').trim()
}

const { url: SUPABASE_URL, key: KEY } = getSupabaseEnv()
await assertSupabaseKey(SUPABASE_URL, KEY)
const headers = supabaseHeaders(KEY)

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

const ADDRESS_BY_NAME = Object.fromEntries(
  [...OTP_BASIC_LOCATIONS, ATOMIC_LOCATION]
    .filter(l => l.address)
    .map(l => [l.name, l.address]),
)
// DB location name alias
ADDRESS_BY_NAME['Sakana Yakio'] = ADDRESS_BY_NAME['Sakana Yakio Honten']

const stats = { locations: 0, contracts: 0, jobs: 0, skipped: 0, errors: [] }

for (const [name, address] of Object.entries(ADDRESS_BY_NAME)) {
  try {
    const locs = await sb('GET', `locations?name=eq.${encodeURIComponent(name)}&select=id,address`)
    for (const loc of locs || []) {
      if (loc.address !== address) {
        await sb('PATCH', `locations?id=eq.${loc.id}`, { address })
        stats.locations++
      }
    }

    const contracts = await sb('GET', `service_contracts?location_name=eq.${encodeURIComponent(name)}&select=id,location_address`)
    for (const c of contracts || []) {
      if (c.location_address !== address) {
        await sb('PATCH', `service_contracts?id=eq.${c.id}`, { location_address: address })
        stats.contracts++
      }
    }
  } catch (e) {
    stats.errors.push(`${name}: ${e.message}`)
  }
}

try {
  const jobs = await sb('GET', 'jobs?select=id,title,address&limit=5000')
  for (const job of jobs || []) {
    const locName = locationNameFromTitle(job.title)
    const newAddress = ADDRESS_BY_NAME[locName]
    if (!newAddress) { stats.skipped++; continue }
    const isOldShort = /maps\.app\.goo\.gl|share\.google/i.test(job.address || '')
    if (isOldShort || !job.address || job.address !== newAddress) {
      await sb('PATCH', `jobs?id=eq.${job.id}`, { address: newAddress })
      stats.jobs++
    }
  }
} catch (e) {
  stats.errors.push(`jobs: ${e.message}`)
}

console.log(JSON.stringify(stats, null, 2))
if (stats.errors.length) process.exit(1)
