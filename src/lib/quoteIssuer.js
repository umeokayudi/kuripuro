/** Issuer shown on 見積書 (quotes). */
export const QUOTE_ISSUER = {
  company: 'クリプロ',
  name: '梅岡アレサンドレユウジ',
  email: 'umeokagroup@gmail.com',
  phone: '070-9073-2909',
}

export const QUOTE_LOGO_PATH = '/kuripuro-logo.jpg'

export function quoteLogoUrl(origin) {
  const base = String(origin || '').replace(/\/$/, '')
  return `${base}${QUOTE_LOGO_PATH}`
}
