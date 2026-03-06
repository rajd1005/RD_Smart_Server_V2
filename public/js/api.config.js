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
    if (typeof loadChannels === 'function') loadChannels(); // <-- ADD THIS LINE
    
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
    
    const chanSec = document.getElementById('channelsSection');
    if(chanSec) chanSec.style.display = 'none';
    
    document.getElementById('navTradeBtn').classList.remove('b-active');
    document.getElementById('navLearnBtn').classList.remove('b-active');
    
    const navPushBtn = document.getElementById('navPushBtn');
    if(navPushBtn) navPushBtn.classList.remove('b-active');
    
    const navChanBtn = document.getElementById('navChannelsBtn');
    if(navChanBtn) navChanBtn.classList.remove('b-active');

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
    } else if (section === 'channels') {
        if(chanSec) chanSec.style.display = 'block';
        if(navChanBtn) navChanBtn.classList.add('b-active');
        if (typeof loadChannels === 'function') loadChannels();
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
