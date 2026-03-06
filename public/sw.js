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
        badge: '/logo.png',
        image: data.image ? data.image : undefined, // <-- NEW IMAGE PAYLOAD ADDED HERE
        sound: '/chaching.mp3', // <-- ADDS THE CUSTOM MONEY SOUND
        requireInteraction: true,
        vibrate: [200, 100, 200], 
        data: { url: data.url || '/' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    const urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if ((client.url === urlToOpen || client.url === self.registration.scope + urlToOpen.substring(1)) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
