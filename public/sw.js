/* KuriPuro service worker: only shows push notifications.
 * No fetch handler and no cache, so it never serves an old version of the app. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  const title = data.title || 'KuriPuro'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/favicon.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = wins.find(w => new URL(w.url).origin === self.location.origin)
    if (open) {
      await open.focus()
      // The app reads ?tab= on load; navigate so it opens the right screen.
      if ('navigate' in open) return open.navigate(url).catch(() => {})
      return undefined
    }
    return self.clients.openWindow(url)
  })())
})
