// --- NEW SMART PUSH NOTIFICATION LOGIC ---
window.pushCheckCompleted = false; // Flag to coordinate with PWA script

function checkAndPromptPushSubscription() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        window.pushCheckCompleted = true;
        if(typeof window.showInstallModal === 'function') window.showInstallModal();
        return;
    }

    const hasBeenPrompted = sessionStorage.getItem('pushPromptDismissed');

    if (Notification.permission === 'granted') {
        registerServiceWorker();
        
        // Push is already granted! Proceed immediately to check App Install
        window.pushCheckCompleted = true;
        if(typeof window.showInstallModal === 'function') window.showInstallModal();
    } 
    else if (Notification.permission === 'denied') {
        if (!hasBeenPrompted) {
            document.getElementById('pushModalTitle').innerText = 'Notifications Blocked';
            document.getElementById('pushModalDesc').innerText = 'You are missing out on live trade alerts.';
            document.getElementById('pushBlockedInstructions').style.display = 'block';
            document.getElementById('btnEnablePush').style.display = 'none';
            new bootstrap.Modal(document.getElementById('pushReminderModal')).show();
        } else {
            // Already prompted in this session, skip to App Install
            window.pushCheckCompleted = true;
            if(typeof window.showInstallModal === 'function') window.showInstallModal();
        }
    } 
    else {
        if (!hasBeenPrompted) {
            document.getElementById('pushModalTitle').innerText = 'Never Miss a Trade!';
            document.getElementById('pushModalDesc').innerText = 'Get instant alerts for new signals, setups, and profit booking directly on your device.';
            document.getElementById('pushBlockedInstructions').style.display = 'none';
            document.getElementById('btnEnablePush').style.display = 'block';
            new bootstrap.Modal(document.getElementById('pushReminderModal')).show();
        } else {
             // Already prompted in this session, skip to App Install
            window.pushCheckCompleted = true;
            if(typeof window.showInstallModal === 'function') window.showInstallModal();
        }
    }
}

function handlePushEnableClick() {
    const btn = document.getElementById('btnEnablePush');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Allowing...';
    btn.disabled = true;

    Notification.requestPermission().then(permission => {
        const modalEl = document.getElementById('pushReminderModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        if (permission === 'granted') registerServiceWorker();
        else sessionStorage.setItem('pushPromptDismissed', 'true');

        // Reset button state just in case
        btn.innerHTML = 'Enable Notifications';
        btn.disabled = false;

        // Sequence: Now that Push is handled, trigger the App Install check with a 500ms delay so modals don't overlap awkwardly
        setTimeout(() => {
            window.pushCheckCompleted = true;
            if(typeof window.showInstallModal === 'function') window.showInstallModal();
        }, 500);
    });
}

function dismissPushPrompt() {
    sessionStorage.setItem('pushPromptDismissed', 'true');
    
    // Sequence: They said Maybe Later to Push, so now ask about the App Install
    setTimeout(() => {
        window.pushCheckCompleted = true;
        if(typeof window.showInstallModal === 'function') window.showInstallModal();
    }, 500);
}

async function registerServiceWorker() {
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

// Ensure socket is available (socket.io is loaded in index.html)
if (typeof socket !== 'undefined') {
    socket.on('force_logout', (data) => {
        const currentEmail = localStorage.getItem('userEmail');
        const currentSessionId = localStorage.getItem('sessionId');
        
        if (currentEmail === data.email && currentSessionId !== data.newSessionId) {
            alert("Logged in from another device. Your current session has expired.");
            logout(); 
        }
    });
}

// ==========================================
// --- NEW USER ACCOUNT / PROFILE LOGIC ---
// ==========================================

async function openProfileModal() {
    // Get or Create the Modal Instance
    let modalEl = document.getElementById('userProfileModal');
    if (!modalEl) {
        console.error("Profile modal HTML is missing.");
        return;
    }
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    // Reset Form State
    document.getElementById('otpSection').style.display = 'none';
    document.getElementById('btnSaveProfile').style.display = 'none';
    document.getElementById('btnRequestOtp').style.display = 'block';
    document.getElementById('profOtp').value = '';

    try {
        const res = await fetch('/api/user/profile');
        const data = await res.json();
        
        if (data.success) {
            document.getElementById('profName').value = data.profile.name || '';
            document.getElementById('profEmail').value = data.profile.email || '';
            document.getElementById('profPhone').value = data.profile.phone || '';
            
            // Format Access Levels String
            let levels = [];
            if(data.profile.accessLevels.level_2_status === 'Yes') levels.push('Level 2');
            if(data.profile.accessLevels.level_3_status === 'Yes') levels.push('Level 3');
            if(data.profile.accessLevels.level_4_status === 'Yes') levels.push('Level 4');
            
            document.getElementById('profileAccessLevels').innerText = levels.length > 0 ? levels.join(', ') : 'Basic Access';
            document.getElementById('profileExpiryDate').innerText = data.profile.expiryDate;
        }
    } catch (err) {
        console.error('Failed to load profile details.');
    }
}

async function requestProfileOtp() {
    const btn = document.getElementById('btnRequestOtp');
    btn.disabled = true;
    btn.innerText = "Sending...";

    try {
        const res = await fetch('/api/user/send-update-otp', { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
            document.getElementById('otpSection').style.display = 'block';
            document.getElementById('btnSaveProfile').style.display = 'block';
            btn.style.display = 'none';
            alert("OTP sent to your registered email address.");
        } else {
            alert(data.msg);
        }
    } catch (err) {
        alert("Network error fetching OTP.");
    }
    
    btn.disabled = false;
    btn.innerText = "Request OTP to Update";
}

document.addEventListener('DOMContentLoaded', () => {
    const profileForm = document.getElementById('formUpdateProfile');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnSaveProfile');
            btn.disabled = true;
            btn.innerText = "Saving...";

            const payload = {
                otp: document.getElementById('profOtp').value,
                newName: document.getElementById('profName').value,
                newEmail: document.getElementById('profEmail').value,
                newPhone: document.getElementById('profPhone').value,
                newPassword: document.getElementById('profPassword').value
            };

            try {
                const res = await fetch('/api/user/update-profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (data.success) {
                    alert(data.msg);
                    if (data.emailChanged || data.passChanged) {
                        logout(); // Force login again if critical credentials changed
                    } else {
                        bootstrap.Modal.getInstance(document.getElementById('userProfileModal')).hide();
                    }
                } else {
                    alert(data.msg);
                }
            } catch (err) {
                alert("Failed to update profile.");
            }

            btn.disabled = false;
            btn.innerText = "Confirm & Save Changes";
        });
    }
});
