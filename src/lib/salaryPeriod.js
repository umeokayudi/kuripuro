const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]

export function getPeriodDates(period) {
  const [y, m] = period.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const closeDate = `${period}-${String(lastDay).padStart(2, '0')}`
  const nextM = m === 12 ? 1 : m + 1
  const nextY = m === 12 ? y + 1 : y
  const confirmDeadline = `${nextY}-${String(nextM).padStart(2, '0')}-05`
  const payDate = `${nextY}-${String(nextM).padStart(2, '0')}-15`
  return { period, closeDate, confirmDeadline, payDate }
}

export function getCurrentPeriod() {
  return tokyoToday().slice(0, 7)
}

/** Period awaiting employee confirmation (previous month until day 5) */
export function getConfirmablePeriod() {
  const today = tokyoToday()
  const day = parseInt(today.slice(8, 10), 10)
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  if (day <= 5) {
    const pm = m === 1 ? 12 : m - 1
    const py = m === 1 ? y - 1 : y
    return `${py}-${String(pm).padStart(2, '0')}`
  }
  return today.slice(0, 7)
}

export function canConfirmPeriod(period) {
  const { confirmDeadline } = getPeriodDates(period)
  return tokyoToday() <= confirmDeadline
}

export function fmtPeriod(period) {
  const [y, m] = period.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m, 10) - 1]} ${y}`
}
