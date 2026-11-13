// v1.0.252 · Fonte única "empresa → lojas" para as telas de relatório.
// Regra do dono: empresa com 1 loja NUNCA mostra "Todas as lojas" (nem opção, nem título, nem seleção
// padrão): mostra direto o local único. Empresa com 2+ lojas continua com "Todas as lojas" + cada loja.
// Só apresentação: nada aqui muda dados nem quais relatórios são gerados.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { locationNameFromTitle } from './cleaningType'

const norm = s => String(s || '').trim().toLowerCase()

/** Chave estável da empresa de um serviço/relatório/cliente. */
export const companyKeyOf = x => String(x?.client_id || x?.id || x?.client_name || x?.company_name || '').trim()
/** Nome da empresa de um serviço/relatório. */
export const companyNameOf = x => String(x?.client_name || x?.company_name || '').trim()
/** Nome da loja de um serviço (título "Loja — tipo"). */
export const storeNameOfJob = j => locationNameFromTitle(j?.location_name || j?.title) || String(j?.title || '').trim()

/** Lista de nomes sem repetição (ignora maiúsculas/espaços), mantendo a primeira grafia. */
export function uniqueStores(names) {
  const seen = new Map()
  for (const n of names || []) {
    const t = String(n || '').trim()
    if (t && !seen.has(norm(t))) seen.set(norm(t), t)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'ja'))
}

/** true só quando a empresa tem 2+ lojas — única condição em que "Todas as lojas" existe. */
export const hasManyStores = stores => (stores || []).length >= 2

let cache = null // Map(client_id → [nomes das lojas ativas])
let inflight = null
/** Lojas ativas por empresa (tabela locations). Falha → mapa vazio (as telas caem para as lojas dos serviços). */
export function loadCompanyStores(force = false) {
  if (cache && !force) return Promise.resolve(cache)
  if (inflight && !force) return inflight
  inflight = Promise.resolve(supabase.from('locations').select('client_id,name,is_active').limit(3000))
    .then(({ data }) => {
      const m = new Map()
      for (const l of data || []) {
        if (!l?.client_id || !l?.name || l.is_active === false) continue
        m.set(l.client_id, [...(m.get(l.client_id) || []), l.name])
      }
      for (const [k, v] of m) m.set(k, uniqueStores(v))
      cache = m
      return m
    })
    .catch(() => new Map())
    .finally(() => { inflight = null })
  return inflight
}

/** Hook: Map(client_id → lojas). Começa vazio e preenche ao carregar. */
export function useCompanyStores() {
  const [map, setMap] = useState(() => cache || new Map())
  useEffect(() => {
    let off = false
    loadCompanyStores().then(m => { if (!off) setMap(m) })
    return () => { off = true }
  }, [])
  return map
}

/**
 * Lojas de uma empresa: as cadastradas (locations) + as que aparecem nos serviços vistos.
 * `seen` = lojas que já sabemos (ex.: dos serviços da tela).
 */
export function storesOfCompany(map, clientId, seen = []) {
  return uniqueStores([...(map?.get(clientId) || []), ...seen])
}

/** Empresas dos serviços (na ordem de aparição), cada uma com seus serviços e as lojas dos serviços. */
export function companiesOfJobs(jobs) {
  const m = new Map()
  for (const j of jobs || []) {
    const key = companyKeyOf({ client_id: j.client_id, client_name: j.client_name }) || storeNameOfJob(j)
    if (!m.has(key)) m.set(key, { key, client_id: j.client_id || null, name: j.client_name || storeNameOfJob(j), jobs: [] })
    m.get(key).jobs.push(j)
  }
  return [...m.values()]
}
