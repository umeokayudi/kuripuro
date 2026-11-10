/* KuriPuro service worker: only shows push notifications.
 * No fetch handler and no cache, so it never serves an old version of the app. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  const title = data.title || 'KuriPuro'
  // v1.0.171 · KuriPuro "K" logo beside the text, white K in the status bar (Android badge).
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/push-icon-192.png',
    badge: '/push-badge-96.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    timestamp: Date.now(),
    vibrate: [80, 40, 80],
    actions: data.action ? [{ action: 'open', title: data.action }] : [],
    data: { url: data.url || '/' },
  }))
})

// v1.0.198 · Tapping a notification always opens KuriPuro on the right page.
// Focus/navigate can fail (window in another Space, uncontrolled tab, old Safari): then open a new window.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    let wins = []
    try { wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }) } catch { wins = [] }
    const mine = wins.filter(w => { try { return new URL(w.url).origin === self.location.origin } catch { return false } })
    const target = mine.find(w => w.focused) || mine.find(w => w.visibilityState === 'visible') || mine[0]
    if (target) {
      try {
        // Ask the page to move itself (works on every client, controlled or not)…
        target.postMessage({ type: 'kp-open', url })
        const focused = await target.focus()
        if (focused) {
          // …and navigate from here too when the browser allows it.
          if ('navigate' in target && target.url !== url) { try { await target.navigate(url) } catch { /* page handles kp-open */ } }
          return
        }
      } catch { /* fall through to a new window */ }
    }
    try { await self.clients.openWindow(url) } catch { /* nothing else to try */ }
  })())
})
