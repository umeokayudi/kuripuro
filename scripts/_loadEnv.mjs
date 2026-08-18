import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

/** Carrega .env.local na raiz do projeto (Vite / Mac) */
export function loadEnvLocal({ override = true } = {}) {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return false
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (override || !process.env[key]) process.env[key] = val
  }
  return true
}
