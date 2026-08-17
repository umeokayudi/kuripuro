export function avgStars(ratings) {
  if (!ratings?.length) return null
  return ratings.reduce((s, r) => s + Number(r.stars || 0), 0) / ratings.length
}

export function starsDisplay(avg) {
  if (avg == null) return '—'
  const rounded = Math.round(avg * 10) / 10
  const full = Math.floor(avg)
  return `${'★'.repeat(full)}${avg - full >= 0.5 ? '½' : ''}${'☆'.repeat(Math.max(0, 5 - full - (avg - full >= 0.5 ? 1 : 0)))} ${rounded}`
}

export function satisfactionLevel(avg) {
  if (avg == null) return 'none'
  if (avg >= 4.5) return 'excellent'
  if (avg >= 3.5) return 'good'
  if (avg >= 2.5) return 'warning'
  return 'critical'
}

export function groupRatingsByClient(ratings, clients) {
  const byClient = {}
  for (const r of ratings || []) {
    if (!byClient[r.client_id]) byClient[r.client_id] = []
    byClient[r.client_id].push(r)
  }
  return (clients || []).map(c => {
    const list = byClient[c.id] || []
    const avg = avgStars(list)
    return { client: c, avg, count: list.length, ratings: list, level: satisfactionLevel(avg) }
  }).sort((a, b) => (a.avg ?? 6) - (b.avg ?? 6))
}

export function ratingsInPeriod(ratings, days = 30) {
  const since = Date.now() - days * 86400000
  return (ratings || []).filter(r => new Date(r.created_at).getTime() >= since)
}
