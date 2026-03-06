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
// --- PWA INSTALLATION LOGIC ---
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('installAppBtn');
    if (installBtn) installBtn.style.display = 'flex'; // Show button
});

window.installPWA = function() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
        deferredPrompt = null;
        const installBtn = document.getElementById('installAppBtn');
        if (installBtn) installBtn.style.display = 'none';
    });
};

window.addEventListener('appinstalled', (evt) => {
    const installBtn = document.getElementById('installAppBtn');
    if (installBtn) installBtn.style.display = 'none';
});
