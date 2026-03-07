self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data.json();
    } catch (err) {
        data = { title: "New Notification", body: event.data.text() };
    }

    // --- NEW: If no custom URL is provided, default to the Alerts tab
    let targetUrl = data.url;
    if (!targetUrl || targetUrl === '/' || targetUrl === '') {
        targetUrl = '/?tab=alerts';
    }

    const options = {
        body: data.body,
        icon: '/logo.png',
        badge: '/logo.png',
        image: data.image ? data.image : undefined, 
        sound: '/chaching.mp3', 
        requireInteraction: true,
        vibrate: [200, 100, 200], 
        data: { url: targetUrl }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    const urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/?tab=alerts';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                
                // --- NEW: If app is already open, focus it and switch tabs without reloading
                if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
                    client.focus();
                    if (urlToOpen.includes('tab=alerts')) {
                        client.postMessage({ action: 'open_alerts' });
                    } else {
                        client.navigate(urlToOpen);
                    }
                    return;
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
