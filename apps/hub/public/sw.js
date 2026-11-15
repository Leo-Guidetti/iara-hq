// IARA HQ · service worker: só notificações push (sem cache offline por enquanto).
// O airton-notify manda {title, body, url, tag}. Tocar na notificação abre (ou foca) o hub na url.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let m = {}
  try { m = e.data ? e.data.json() : {} } catch { m = { title: 'IARA HQ', body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(m.title || 'IARA HQ', {
    body: m.body || '',
    tag: m.tag || undefined,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: m.url || '/hoje' },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const alvo = new URL(e.notification.data?.url || '/hoje', self.location.origin)
  // Push antigo apontando para '/' abre a Hoje.
  if (alvo.origin === self.location.origin && alvo.pathname === '/') alvo.pathname = '/hoje'
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of abertas) {
      if (new URL(c.url).origin === alvo.origin && 'focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(alvo.href); return }
    }
    await self.clients.openWindow(alvo.href)
  })())
})
