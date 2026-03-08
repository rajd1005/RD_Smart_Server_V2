self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data.json();
    } catch (err) {
        data = { title: "New Notification", body: event.data.text() };
    }

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
                        client.postMessage({ action: 'open_alerts' });
                    } else if (urlToOpen.includes('tab=channels')) {
                        // Extract the channel ID from the URL securely
                        const match = urlToOpen.match(/id=([^&]*)/);
                        const cId = match ? match[1] : null;
                        client.postMessage({ action: 'open_channels', channelId: cId });
                    } else {
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
