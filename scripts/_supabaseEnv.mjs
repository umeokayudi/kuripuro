import { loadEnvLocal } from './_loadEnv.mjs'

const PROJECT_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const API_SETTINGS = 'https://supabase.com/dashboard/project/fxsakrshmldmkdmbevna/settings/api'

export function getSupabaseEnv() {
  loadEnvLocal()

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || PROJECT_URL
  // Scripts CLI usam anon (service_role no .env.local costuma estar errada/expirada)
  const key =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY

  return { url, key }
}

export async function assertSupabaseKey(url, key) {
  if (!key || key.includes('YOUR_') || key.startsWith('sb_secret_')) {
    console.error(`
❌ Chave Supabase inválida ou ausente.

Coloque no .env.local (na pasta kuripuro):

VITE_SUPABASE_URL=${PROJECT_URL}
VITE_SUPABASE_ANON_KEY=sua_chave_anon_aqui

Pegue a chave "anon public" aqui:
${API_SETTINGS}

Ou puxe da Vercel (se já linkou o projeto):
npx vercel env pull .env.local
`)
    process.exit(1)
  }

  const resp = await fetch(`${url}/rest/v1/clients?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })

  if (!resp.ok) {
    const body = await resp.text()
    console.error(`
❌ Supabase rejeitou a chave (${resp.status}).

Atualize o .env.local com a chave "anon public" correta:
${API_SETTINGS}

Resposta: ${body}
`)
    process.exit(1)
  }
}

export function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  }
}
