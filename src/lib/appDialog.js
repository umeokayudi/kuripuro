/** Shared confirm/dialog helpers — no React, safe for Node tests. */

const TONES = new Set(['danger', 'primary', 'gold', 'success'])

export function dateLocale(lang) {
  if (lang === 'ja') return 'ja-JP'
  if (lang === 'pt') return 'pt-BR'
  return 'en-GB'
}

export function isDialogRoleDark(role) {
  return role === 'employee' || role === 'client'
}

export function weekdayShortLabels(lang) {
  const loc = dateLocale(lang)
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => (
    new Date(Date.UTC(2024, 8, 1 + offset)).toLocaleDateString(loc, {
      weekday: 'short',
      timeZone: 'UTC',
    })
  ))
}

/**
 * Normalize confirm() input so pages can pass a string or an options object.
 * @param {string|object|null|undefined} input
 * @param {{ title?: string, confirm?: string, cancel?: string, tone?: string }} [defaults]
 */
export function normalizeConfirmOptions(input, defaults = {}) {
  const raw = (typeof input === 'string' || input == null)
    ? { message: input == null ? '' : String(input) }
    : { ...input }

  let tone = raw.tone
  if (tone === 'warn' || tone === 'warning') tone = 'gold'
  if (tone === 'destructive' || tone === 'delete') tone = 'danger'
  if (!TONES.has(tone)) tone = defaults.tone && TONES.has(defaults.tone) ? defaults.tone : 'danger'

  const title = String(raw.title ?? defaults.title ?? '')
  const message = String(raw.message ?? raw.text ?? '')

  return {
    title,
    message,
    confirmLabel: String(raw.confirmLabel ?? raw.ok ?? defaults.confirm ?? 'OK'),
    cancelLabel: String(raw.cancelLabel ?? raw.cancel ?? defaults.cancel ?? 'Cancel'),
    tone,
    dark: raw.dark,
    hideCancel: Boolean(raw.hideCancel),
    wide: Boolean(raw.wide),
  }
}
