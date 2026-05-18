self.addEventListener('push', event => {
  let payload = {}

  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : undefined }
  }

  const title = payload.title || 'SideBar'
  const options = {
    body: payload.body || 'New message',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      url: payload.url || '/',
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()

  const url = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const normalizedUrl = new URL(url, self.location.origin).href
      const existingClient = clientList.find(client => client.url === normalizedUrl)

      if (existingClient) {
        return existingClient.focus()
      }

      return self.clients.openWindow(url)
    })
  )
})
