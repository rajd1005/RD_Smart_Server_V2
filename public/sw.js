self.addEventListener('push', e => {
    const data = e.data.json();
    self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/logo.png' // Add a logo to your public folder
    });
});
