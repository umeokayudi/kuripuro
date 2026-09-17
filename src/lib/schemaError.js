export function isMissingTableError(error) {
  if (!error) return false
  return error.code === 'PGRST205' || /Could not find the table/i.test(error.message || '')
}

export function isMissingColumnError(error, column) {
  if (!error) return false
  const msg = String(error.message || '')
  const mentionsColumn = !column || msg.includes(column)
  if (error.code === 'PGRST204') return mentionsColumn
  if (/schema cache/i.test(msg) && /column/i.test(msg)) return mentionsColumn
  if (/column .* does not exist/i.test(msg)) return mentionsColumn
  return false
}
