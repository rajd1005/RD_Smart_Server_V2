self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data.json();
    } catch (err) {
        data = { title: "New Notification", body: event.data.text() };
    }

    const options = {
        body: data.body,
        icon: '/logo.png',
        data: { url: data.url || '/' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    // Get the URL from the notification data, default to root ('/') if not provided
    const urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Check if there is already a window/tab open with the target URL
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                // If it's already open, just focus on that tab
                if ((client.url === urlToOpen || client.url === self.registration.scope + urlToOpen.substring(1)) && 'focus' in client) {
                    return client.focus();
                }
            }
            // If not open, open a new window/tab
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
