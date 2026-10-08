/** Issuer shown on 見積書 / 請求書. Wordmark only — no image. */
export const QUOTE_ISSUER = {
  company: 'クリプロ',
  title: '代表',
  name: '梅岡アレサンドレユウジ',
  address: '〒204-0012 東京都清瀬市中清戸4-907-17',
  /** Invoice Registration Number (適格請求書発行事業者) */
  regNumber: 'T1234567890123',
  email: 'umeokagroup@gmail.com',
  phone: '070-9073-2909',
}

export const QUOTE_ISSUER_EN = {
  company: 'KuriPuro',
  title: 'Rep.',
  name: 'Alexandre Yuji Umeoka',
  address: '4-907-17 Nakakiyoto, Kiyose-shi, Tokyo 204\u20110012',
  regNumber: QUOTE_ISSUER.regNumber,
  email: QUOTE_ISSUER.email,
  phone: QUOTE_ISSUER.phone,
}

export function quoteIssuerForLang(lang) {
  if (lang === 'en') return { ...QUOTE_ISSUER, ...QUOTE_ISSUER_EN }
  return { ...QUOTE_ISSUER }
}

/** Language pack always wins for name / address / company so English print is not stuck in Japanese. */
export function printIssuer(overrides = {}, lang = 'ja') {
  const loc = quoteIssuerForLang(lang)
  return {
    ...QUOTE_ISSUER,
    ...overrides,
    company: loc.company,
    title: loc.title,
    name: loc.name,
    address: loc.address,
    email: loc.email,
    phone: loc.phone,
    regNumber: overrides.regNumber || loc.regNumber,
    bank: overrides.bank || '',
  }
}

