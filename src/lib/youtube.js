/** Extract YouTube video ID and build embed URL for iframe player */
export function youtubeVideoId(url) {
  if (!url || typeof url !== 'string') return null
  const m = url.trim().match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : null
}

export function youtubeEmbedUrl(url) {
  const id = youtubeVideoId(url)
  return id ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1` : null
}
