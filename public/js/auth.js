async function registerServiceWorker() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const keyRes = await fetch('/api/push/public_key');
            const keyData = await keyRes.json();
            
            if (!keyData.success) {
                console.log("Push keys not ready yet.");
                return;
            }

            const registration = await navigator.serviceWorker.register('/sw.js');
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: keyData.publicKey
            });
            
            await fetch('/api/push/subscribe', {
                method: 'POST',
                body: JSON.stringify(subscription),
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin'
            });
        } catch (error) {
            console.log('Service Worker or Push Notification registration failed:', error);
        }
    }
}

async function checkDisclaimer() {
    if (sessionStorage.getItem('disclaimerAccepted') !== 'true') {
        try {
            const settingsRes = await fetch('/api/settings');
            const settings = await settingsRes.json();
            
            if (settings.show_disclaimer !== 'false') {
                const modalEl = document.getElementById('disclaimerModal');
                if (modalEl) {
                    const agreeBtn = document.getElementById('btnAgreeDisclaimer');
                    const scrollBody = document.getElementById('disclaimerScrollBody');
                    
                    if (window.innerWidth <= 768 && agreeBtn && scrollBody) {
                        agreeBtn.disabled = true;
                        agreeBtn.innerText = "Scroll to Agree ▼";
                        
                        scrollBody.addEventListener('scroll', function() {
                            if (scrollBody.scrollTop + scrollBody.clientHeight >= scrollBody.scrollHeight - 15) {
                                agreeBtn.disabled = false;
                                agreeBtn.innerText = "I AGREE";
                            }
                        });
                        
                        setTimeout(() => {
                            if (scrollBody.scrollHeight <= scrollBody.clientHeight) {
                                agreeBtn.disabled = false;
                                agreeBtn.innerText = "I AGREE";
                            }
                        }, 500);
                    }
                    bootstrap.Modal.getOrCreateInstance(modalEl).show();
                }
            }
        } catch (err) { console.error("Error loading disclaimer config"); }
    }
}

window.acceptDisclaimer = async function() {
    const btn = document.querySelector('#disclaimerModal .btn-success');
    if (!btn) return;
    const originalText = btn.innerText;
    btn.innerText = "⏳ Recording Agreement...";
    btn.disabled = true;

    try {
        await fetch('/api/accept_terms', { method: 'POST', credentials: 'same-origin' });
        sessionStorage.setItem('disclaimerAccepted', 'true');
        const modalEl = document.getElementById('disclaimerModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    } catch (err) {
        alert("Error recording agreement. Please try again or check your connection.");
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

window.declineDisclaimer = function() { logout(); }

async function logout() {
    try { 
        await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); 
        sessionStorage.clear(); 
        localStorage.clear(); 
        window.location.href = '/home.html'; 
    } catch (err) {}
}

socket.on('force_logout', (data) => {
    const currentEmail = localStorage.getItem('userEmail');
    const currentSessionId = localStorage.getItem('sessionId');
    
    if (currentEmail === data.email && currentSessionId !== data.newSessionId) {
        alert("Logged in from another device. Your current session has expired.");
        logout(); 
    }
});
