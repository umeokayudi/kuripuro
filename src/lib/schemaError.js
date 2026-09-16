export function isMissingTableError(error) {
  if (!error) return false
  return error.code === 'PGRST205' || /Could not find the table/i.test(error.message || '')
}
