self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data.json();
    } catch (err) {
        data = { title: "New Notification", body: event.data.text() };
    }

    // --- UPDATED: Explicitly use index.html to ensure PWA app compatibility
    let targetUrl = data.url;
    if (!targetUrl || targetUrl === '/' || targetUrl.trim() === '') {
        targetUrl = '/index.html?tab=alerts';
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

    const urlToOpen = (event.notification.data && event.notification.data.url) 
        ? event.notification.data.url 
        : '/index.html?tab=alerts';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                
                // If the app is already open in the background
                if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
                    client.focus();
                    
                    if (urlToOpen.includes('tab=alerts')) {
                        // Silently tell the open app to switch to the Alerts tab
                        client.postMessage({ action: 'open_alerts' });
                    } else {
                        // If it's a custom URL link, navigate to it
                        client.navigate(urlToOpen);
                    }
                    return;
                }
            }
            // If the app is completely closed, open a new window to the target
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
