const API_URL = '/api/trades'; 
const API_URL_COURSES = '/api/courses'; 
const API_URL_LESSON = '/api/lesson/';

let allTrades = []; 
let globalModules = []; 
let isSelectionMode = false;
const socket = io(); 
let datePicker;
let videoPlayer = null; 
let watermarkInterval = null; 
let progressInterval = null; 
let symbolCategories = { 'Forex/Crypto': [], 'Stock': [], 'Index': [], 'Mcx': [] }; 

const userData = {
    email: localStorage.getItem('userEmail'),
    phone: localStorage.getItem('userPhone'),
    role: localStorage.getItem('userRole')
};

window.onload = function() {
    if (typeof initDatePicker === 'function') initDatePicker();
    if (typeof fetchTrades === 'function') fetchTrades(); 
    if (typeof fetchCourses === 'function') fetchCourses(); 
    if (typeof fetchUserNotifications === 'function') fetchUserNotifications(false); 
    if (typeof applyRoleRestrictions === 'function') applyRoleRestrictions(); 
    
    switchSection('learning'); 
    
    if (typeof checkDisclaimer === 'function') checkDisclaimer();
    if (typeof checkAndPromptPushSubscription === 'function') checkAndPromptPushSubscription(); 
    
    const notifSheet = document.getElementById('notificationSheet');
    if (notifSheet) {
        notifSheet.addEventListener('show.bs.offcanvas', function () {
            const badge = document.getElementById('notifBadge');
            if (badge) badge.style.display = 'none';
        });
    }

    const scheduledPushModalEl = document.getElementById('scheduledPushModal');
    if (scheduledPushModalEl) {
        scheduledPushModalEl.addEventListener('show.bs.modal', function () {
            if (typeof fetchScheduledPushes === 'function') fetchScheduledPushes();
        });
    }
};

function switchSection(section) {
    document.getElementById('tradeSection').style.display = 'none';
    document.getElementById('learningSection').style.display = 'none';
    const pushSec = document.getElementById('pushSection');
    if(pushSec) pushSec.style.display = 'none';
    
    document.getElementById('navTradeBtn').classList.remove('b-active');
    document.getElementById('navLearnBtn').classList.remove('b-active');
    const navPushBtn = document.getElementById('navPushBtn');
    if(navPushBtn) navPushBtn.classList.remove('b-active');

    document.getElementById('btnRefresh').style.display = 'none';
    document.getElementById('btnFilter').style.display = 'none';
    document.getElementById('btnSelect').style.display = 'none';
    document.getElementById('btnDelete').style.display = 'none';

    if (section === 'trade') {
        document.getElementById('tradeSection').style.display = 'block';
        document.getElementById('navTradeBtn').classList.add('b-active');
        document.getElementById('btnRefresh').style.display = 'flex';
        document.getElementById('btnFilter').style.display = 'flex';
        if (typeof applyRoleRestrictions === 'function') applyRoleRestrictions(); 
    } else if (section === 'push') {
        if(pushSec) pushSec.style.display = 'flex';
        if(navPushBtn) navPushBtn.classList.add('b-active');
        if (typeof fetchChatNotifications === 'function') fetchChatNotifications(false); 
    } else {
        document.getElementById('learningSection').style.display = 'block';
        document.getElementById('navLearnBtn').classList.add('b-active');
        if (typeof fetchCourses === 'function') fetchCourses();
    }
}
// --- PWA INSTALLATION & SEQUENCING LOGIC ---
window.deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredPrompt = e; // Save the native event
    
    // Show the small header button just in case they dismiss the modal
    const installBtn = document.getElementById('installAppBtn');
    if (installBtn) installBtn.style.display = 'flex'; 

    // Only show the Install modal if the Push check is completely finished
    if (window.pushCheckCompleted && !sessionStorage.getItem('installPromptDismissed')) {
        showInstallModal();
    }
});

window.showInstallModal = function() {
    if (window.deferredPrompt && !sessionStorage.getItem('installPromptDismissed')) {
        const modalEl = document.getElementById('installAppModal');
        if(modalEl) new bootstrap.Modal(modalEl).show();
    }
}

// Function to handle the button click (both in modal and header)
window.installPWA = function() { window.handleInstallAppClick(); }; 

window.handleInstallAppClick = function() {
    if (!window.deferredPrompt) return;
    
    const btn = document.getElementById('btnEnableInstall');
    if(btn) { btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Installing...'; btn.disabled = true; }
    
    window.deferredPrompt.prompt(); // Trigger native OS prompt
    
    window.deferredPrompt.userChoice.then((choiceResult) => {
        window.deferredPrompt = null;
        const installBtn = document.getElementById('installAppBtn');
        if (installBtn) installBtn.style.display = 'none';
        
        const modalEl = document.getElementById('installAppModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    });
};

window.dismissInstallPrompt = function() {
    sessionStorage.setItem('installPromptDismissed', 'true');
};

window.addEventListener('appinstalled', (evt) => {
    const installBtn = document.getElementById('installAppBtn');
    if (installBtn) installBtn.style.display = 'none';
    window.deferredPrompt = null;
});

function enforceSafariOnIOS() {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    if (isIos && !isStandalone) {
        // A strict check to see if it is Safari. 
        // Safari has 'safari' in the user agent, but NOT 'crios' (Chrome), 'fxios' (Firefox), etc.
        const isSafari = userAgent.includes('safari') && 
                         !userAgent.includes('crios') && 
                         !userAgent.includes('fxios') && 
                         !userAgent.includes('opios') && 
                         !userAgent.includes('edgios');

        if (!isSafari) {
            // USER IS ON iPHONE BUT NOT IN SAFARI -> BLOCK THE ENTIRE SCREEN
            document.body.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background-color:#f0f2f5; padding:20px; text-align:center; font-family:'Roboto', sans-serif;">
                    <span class="material-icons-round" style="font-size:72px; color:#ff3b30; margin-bottom:15px;">gpp_bad</span>
                    <h2 style="margin-top:0; color:#000; font-weight:900;">Safari Required</h2>
                    <p style="color:#666; font-size:15px; line-height:1.5; margin-bottom:25px; padding: 0 10px;">
                        Apple strictly requires you to use the <b>Safari browser</b> to install this app and receive live trade alerts on an iPhone. 
                        <br><br>Please copy the link below and paste it into Safari.
                    </p>
                    <input type="text" id="currentUrl" value="${window.location.href}" readonly style="width:100%; max-width:320px; padding:12px; border:1px solid #ccc; border-radius:8px; text-align:center; margin-bottom:15px; font-size:14px; background:#fff; color:#333; font-weight:bold;">
                    <button onclick="copyUrlForSafari()" style="background-color:#007aff; color:white; border:none; padding:14px 24px; border-radius:8px; font-size:16px; font-weight:bold; cursor:pointer; width:100%; max-width:320px; box-shadow: 0 4px 10px rgba(0, 122, 255, 0.3);">
                        Copy Link
                    </button>
                    <div id="copySuccess" style="color:#00b346; font-weight:bold; margin-top:20px; display:none; font-size:14px;">
                        <span class="material-icons-round" style="font-size:18px; vertical-align:middle;">check_circle</span> Link Copied! Now open Safari.
                    </div>
                </div>
            `;
            
            // Define the copy function globally so the button can use it
            window.copyUrlForSafari = function() {
                const urlInput = document.getElementById('currentUrl');
                urlInput.select();
                urlInput.setSelectionRange(0, 99999); // For mobile devices
                navigator.clipboard.writeText(urlInput.value).then(() => {
                    document.getElementById('copySuccess').style.display = 'block';
                });
            };
            
            // Stop further execution because the app is blocked
            return true; 
        } else {
            // USER IS ON iPHONE AND IN SAFARI -> Show standard install instructions
            const installBtn = document.getElementById('installAppBtn');
            if (installBtn) {
                installBtn.style.display = 'inline-block';
                installBtn.onclick = () => alert("To install this App & get Trade Alerts: \n\n1. Tap the 'Share' icon (square with an up arrow) at the bottom of Safari.\n2. Scroll down and tap 'Add to Home Screen'. \n3. Open the app from your home screen.");
            }
        }
    }
    return false;
}

// Run this immediately when the page loads
window.addEventListener('load', () => {
    const isBlocked = enforceSafariOnIOS();
    if (!isBlocked) {
        // If not blocked, run your other normal startup functions here...
        // For example, your prompt for Androids:
        if (typeof showInstallModal === 'function') showInstallModal();
    }
});
