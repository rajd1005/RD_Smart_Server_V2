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
    initDatePicker();
    fetchTrades(); 
    fetchCourses(); 
    fetchUserNotifications(false); // Load initial page
    applyRoleRestrictions(); 
    
    switchSection('learning'); 
    
    checkDisclaimer();
    registerServiceWorker(); 
    
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
            fetchScheduledPushes();
        });
    }
};

// --- FALLBACK BACKGROUND POLLER TO GUARANTEE LIVE UPDATES ---
setInterval(() => {
    const tradeSec = document.getElementById('tradeSection');
    if (tradeSec && tradeSec.style.display === 'block' && !isSelectionMode) {
        fetchTrades();
    }
}, 5000); 
// ---------------------------------------------------------------

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

document.addEventListener('show.bs.collapse', function (e) {
    if (!e.target.classList.contains('lesson-collapse')) {
        const firstLessonCollapse = e.target.querySelector('.lesson-collapse');
        const firstLessonBtn = e.target.querySelector('.lesson-accordion-btn');
        if (firstLessonCollapse && firstLessonBtn && !firstLessonCollapse.classList.contains('show')) {
            firstLessonCollapse.classList.add('show');
            firstLessonBtn.classList.remove('collapsed');
            firstLessonBtn.setAttribute('aria-expanded', 'true');
        }
    }
});

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
        applyRoleRestrictions(); 
    } else if (section === 'push') {
        if(pushSec) pushSec.style.display = 'flex';
        if(navPushBtn) navPushBtn.classList.add('b-active');
        fetchChatNotifications(false); // Load initial page
    } else {
        document.getElementById('learningSection').style.display = 'block';
        document.getElementById('navLearnBtn').classList.add('b-active');
        fetchCourses();
    }
}

function toggleAccordions(action) {
    const allCollapses = document.querySelectorAll('.accordion-collapse');
    const allButtons = document.querySelectorAll('.accordion-button');
    if (action === 'all') {
        allCollapses.forEach(el => el.classList.add('show'));
        allButtons.forEach(el => { el.classList.remove('collapsed'); el.setAttribute('aria-expanded', 'true'); });
    } else if (action === 'none') {
        allCollapses.forEach(el => el.classList.remove('show'));
        allButtons.forEach(el => { el.classList.add('collapsed'); el.setAttribute('aria-expanded', 'false'); });
    } else if (action === 'first') {
        allCollapses.forEach(el => el.classList.remove('show'));
        allButtons.forEach(el => { el.classList.add('collapsed'); el.setAttribute('aria-expanded', 'false'); });
        const firstModCollapse = document.querySelector('.course-module > .accordion-collapse');
        const firstModBtn = document.querySelector('.course-module > .accordion-header > .accordion-button');
        if (firstModCollapse && firstModBtn) {
            firstModCollapse.classList.add('show');
            firstModBtn.classList.remove('collapsed');
            firstModBtn.setAttribute('aria-expanded', 'true');
            const firstLessonCollapse = firstModCollapse.querySelector('.lesson-collapse');
            const firstLessonBtn = firstModCollapse.querySelector('.lesson-accordion-btn');
            if (firstLessonCollapse && firstLessonBtn) {
                firstLessonCollapse.classList.add('show');
                firstLessonBtn.classList.remove('collapsed');
                firstLessonBtn.setAttribute('aria-expanded', 'true');
            }
        }
    }
}

async function fetchCourses() {
    const container = document.getElementById('courseModuleContainer');
    if (!container) return;
    container.innerHTML = '<div class="p-4 text-center text-muted">Loading courses...</div>';
    
    try {
        const response = await fetch(API_URL_COURSES, { credentials: 'same-origin' });
        if (response.status === 401 || response.status === 403) { window.location.href = '/home.html'; return; }
        
        globalModules = await response.json();
        let accessLevels = {};
        try { accessLevels = JSON.parse(localStorage.getItem('accessLevels')) || {}; } catch(e) {}

        let htmlContent = '';
        
        if (userData.role === 'admin') {
            const selectEl = document.getElementById('lessonModuleId');
            if (selectEl) {
                selectEl.innerHTML = '<option value="">Select a Module...</option>';
                globalModules.forEach(m => selectEl.innerHTML += `<option value="${m.id}">${m.title}</option>`);
            }
        }

        globalModules.forEach((mod) => {
            const isLocked = userData.role !== 'admin' && mod.required_level !== 'demo' && accessLevels[mod.required_level] !== 'Yes';
            
            if (userData.role !== 'admin') {
                if (mod.dashboard_visibility === 'hidden') return;
                if (mod.dashboard_visibility === 'accessible' && isLocked) return;
            }
            
            const safeTitle = (mod.title || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const safeDesc = (mod.description || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const safeNotice = (mod.lock_notice || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            
            const adminBtnsMod = userData.role === 'admin' ? `
                <div class="d-flex align-items-center ms-auto me-3">
                    <button class="admin-edit-btn" onclick="openEditModule(event, ${mod.id}, '${safeTitle}', '${safeDesc}', '${mod.required_level}', '${safeNotice}', ${mod.display_order || 0}, ${mod.show_on_home}, '${mod.dashboard_visibility || 'all'}')"><span class="material-icons-round" style="font-size: 18px;">edit</span></button>
                    <button class="admin-del-btn" onclick="deleteModule(event, ${mod.id})"><span class="material-icons-round" style="font-size: 18px;">delete</span></button>
                </div>` : '';

            let displayNoticeHtml = '';
            if (isLocked) {
                let displayNotice = mod.lock_notice ? mod.lock_notice : `⚠️ Your WP Level Status restricts access. Please contact Admin.`;
                displayNotice = displayNotice.replace(/<a /gi, '<a target="_blank" rel="noopener noreferrer" '); 
                displayNoticeHtml = `<div class="lock-notice">${displayNotice}</div>`;
            } 

            let lessonHtml = '';
            if (mod.lessons && mod.lessons.length > 0) {
                lessonHtml += `<div class="accordion w-100 lesson-container-sortable" id="accLsn${mod.id}">`;
                
                mod.lessons.forEach(l => {
                    const safeLT = (l.title || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const safeLD = (l.description || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
                    
                    const adminBtnsLess = userData.role === 'admin' ? `
                        <div class="d-flex flex-column align-items-center ms-2 border-start ps-2">
                            <button class="admin-edit-btn" onclick="openEditLesson(event, ${l.id}, '${safeLT}', '${safeLD}', ${l.display_order || 0})"><span class="material-icons-round" style="font-size: 16px;">edit</span></button>
                            <button class="admin-del-btn mt-1" onclick="deleteLesson(event, ${l.id})"><span class="material-icons-round" style="font-size: 16px;">delete</span></button>
                        </div>` : '';

                    const hasVideo = l.hls_manifest_url && l.hls_manifest_url.length > 5;
                    const overlayIcon = isLocked ? 'lock' : 'play_circle_filled';
                    const documentIcon = isLocked ? 'lock' : 'article';
                    const iconColor = isLocked ? '#999' : 'var(--blue)';
                    const textColor = isLocked ? '#666' : '#333';
                    const opacityLvl = isLocked ? '0.6' : '1';
                    
                    let mediaHtml = '';
                    let onClickAction = '';
                    let pointerEv = isLocked ? 'not-allowed' : 'auto';

                    if (hasVideo) {
                        onClickAction = isLocked ? '' : `onclick="openSecureVideo(${l.id})"`;
                        pointerEv = isLocked ? 'not-allowed' : 'pointer';
                        
                        const thumbIconColor = isLocked ? '#ccc' : '#fff';
                        const thumbnailImg = l.thumbnail_url 
                            ? `<div class="thumb-wrapper-full"><img src="${l.thumbnail_url}" loading="lazy"><div class="thumb-play-overlay-full"><span class="material-icons-round" style="color: ${thumbIconColor};">${overlayIcon}</span></div></div>` 
                            : `<div class="thumb-wrapper-full"><div class="w-100 h-100 bg-dark d-flex align-items-center justify-content-center" style="min-height: 250px;"><span class="material-icons-round" style="font-size:48px; color:#444;">${overlayIcon}</span></div><div class="thumb-play-overlay-full"><span class="material-icons-round" style="color: ${thumbIconColor};">${overlayIcon}</span></div></div>`;

                        mediaHtml = `<div class="w-100" style="cursor: ${pointerEv};" ${onClickAction}>${thumbnailImg}</div>`;
                    }

                    const finalHeaderIcon = hasVideo ? overlayIcon : documentIcon;

                    lessonHtml += `
                        <div class="accordion-item lesson-accordion-item" data-lesson-id="${l.id}">
                            <h2 class="accordion-header" id="hLsn${l.id}">
                                <button class="accordion-button collapsed lesson-accordion-btn" type="button" data-bs-toggle="collapse" data-bs-target="#cLsn${l.id}" aria-expanded="false" aria-controls="cLsn${l.id}">
                                    <span class="material-icons-round" style="font-size:16px; margin-right:8px; color:${hasVideo ? iconColor : 'var(--blue)'};">${finalHeaderIcon}</span>
                                    <span style="color: ${textColor};">${l.title}</span>
                                </button>
                            </h2>
                            <div id="cLsn${l.id}" class="accordion-collapse collapse lesson-collapse" aria-labelledby="hLsn${l.id}" data-bs-parent="#accLsn${mod.id}">
                                <div class="accordion-body p-0" style="background: #fafafa;">
                                    <div class="lesson-item-content w-100" style="opacity: ${opacityLvl};">
                                        ${mediaHtml}
                                        <div class="d-flex justify-content-between align-items-start mt-2">
                                            <div class="flex-grow-1" style="overflow-wrap: break-word;">
                                                ${l.description ? `<div class="text-dark" style="font-size: 13px; line-height: 1.6; padding: 0 5px; white-space: pre-wrap;">${l.description}</div>` : ''}
                                            </div>
                                            ${!isLocked ? adminBtnsLess : ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
                });
                
                lessonHtml += `</div>`;
            } else {
                lessonHtml += '<div class="text-muted p-3 text-center" style="font-size:12px;">No videos yet.</div>';
            }

            htmlContent += `
                <div class="accordion-item course-module" data-mod-id="${mod.id}">
                    <h2 class="accordion-header" id="heading${mod.id}">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${mod.id}" aria-expanded="false" aria-controls="collapse${mod.id}">
                            <div class="d-flex align-items-center flex-grow-1">
                                <h6 class="mb-0 fw-bold" style="font-size:14px;">${mod.title}</h6>
                            </div>
                            ${adminBtnsMod}
                        </button>
                    </h2>
                    ${displayNoticeHtml}
                    <div id="collapse${mod.id}" class="accordion-collapse collapse" aria-labelledby="heading${mod.id}">
                        <div class="accordion-body p-0">
                            ${lessonHtml}
                        </div>
                    </div>
                </div>`;
        });
        
        container.innerHTML = htmlContent || '<div class="p-4 text-center text-muted">No courses found.</div>';
        
        if (userData.role === 'admin' && typeof Sortable !== 'undefined') {
            const courseContainer = document.getElementById('courseModuleContainer');
            if (courseContainer) {
                new Sortable(courseContainer, {
                    animation: 150,
                    handle: '.accordion-header',
                    onEnd: async function (evt) {
                        const orderedIds = Array.from(courseContainer.querySelectorAll('.course-module')).map(el => el.getAttribute('data-mod-id'));
                        try { await fetch('/api/admin/modules/reorder', { method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify({ orderedIds }) }); } catch(e){}
                    }
                });
            }

            document.querySelectorAll('.lesson-container-sortable').forEach(container => {
                new Sortable(container, {
                    animation: 150,
                    handle: '.lesson-accordion-item', 
                    onEnd: async function (evt) {
                        const orderedIds = Array.from(container.querySelectorAll('.lesson-accordion-item')).map(el => el.getAttribute('data-lesson-id'));
                        try { await fetch('/api/admin/lessons/reorder', { method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify({ orderedIds }) }); } catch(e){}
                    }
                });
            });

            const layoutDraggable = document.getElementById('homepageLayoutDraggable');
            if (layoutDraggable) {
                new Sortable(layoutDraggable, {
                    animation: 150,
                    ghostClass: 'bg-light'
                });
            }
        }
        
        try {
            const settingsRes = await fetch('/api/settings');
            const settings = await settingsRes.json();
            
            const defaultState = settings.accordion_state || 'first';
            setTimeout(() => { toggleAccordions(defaultState); }, 100);
            const adminSettingDropdown = document.getElementById('adminAccordionState');
            if (adminSettingDropdown) adminSettingDropdown.value = defaultState;

            const hideTradeTab = settings.hide_trade_tab === 'true';
            const adminHideCheck = document.getElementById('adminHideTradeTab');
            if (adminHideCheck) adminHideCheck.checked = hideTradeTab;

            const pushTradeAlerts = settings.push_trade_alerts !== 'false';
            const adminPushTradeCheck = document.getElementById('adminPushTradeAlerts');
            if (adminPushTradeCheck) adminPushTradeCheck.checked = pushTradeAlerts;

            const showGallery = settings.show_gallery !== 'false';
            const adminGalleryCheck = document.getElementById('adminShowGallery');
            if (adminGalleryCheck) adminGalleryCheck.checked = showGallery;

            const showCallWidget = settings.show_call_widget !== 'false';
            const adminCallWidgetCheck = document.getElementById('adminShowCallWidget');
            if (adminCallWidgetCheck) adminCallWidgetCheck.checked = showCallWidget;

            const showStickyFooter = settings.show_sticky_footer !== 'false';
            const adminStickyCheck = document.getElementById('adminShowStickyFooter');
            if (adminStickyCheck) adminStickyCheck.checked = showStickyFooter;

            const safeSetVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
            safeSetVal('adminBtn1Text', settings.sticky_btn1_text);
            safeSetVal('adminBtn1Icon', settings.sticky_btn1_icon);
            safeSetVal('adminBtn1Link', settings.sticky_btn1_link);
            safeSetVal('adminBtn2Text', settings.sticky_btn2_text);
            safeSetVal('adminBtn2Icon', settings.sticky_btn2_icon);
            safeSetVal('adminBtn2Link', settings.sticky_btn2_link);
            
            const showDisclaimer = settings.show_disclaimer !== 'false';
            const adminDisclaimerCheck = document.getElementById('adminShowDisclaimer');
            if (adminDisclaimerCheck) adminDisclaimerCheck.checked = showDisclaimer;
            safeSetVal('adminRegisterLink', settings.register_link);

            const catForex = settings.cat_forex_crypto || '';
            const catStock = settings.cat_stock || '';
            const catIndex = settings.cat_index || '';
            const catMcx = settings.cat_mcx || '';
            
            symbolCategories['Forex/Crypto'] = catForex.split(',').map(s=>s.trim().toUpperCase()).filter(s=>s);
            symbolCategories['Stock'] = catStock.split(',').map(s=>s.trim().toUpperCase()).filter(s=>s);
            symbolCategories['Index'] = catIndex.split(',').map(s=>s.trim().toUpperCase()).filter(s=>s);
            symbolCategories['Mcx'] = catMcx.split(',').map(s=>s.trim().toUpperCase()).filter(s=>s);

            safeSetVal('adminCatForex', catForex);
            safeSetVal('adminCatStock', catStock);
            safeSetVal('adminCatIndex', catIndex);
            safeSetVal('adminCatMcx', catMcx);

            if (allTrades && allTrades.length > 0) applyFilters(); 

            if (settings.homepage_layout && userData.role === 'admin') {
                const layoutOrder = JSON.parse(settings.homepage_layout);
                const layoutUl = document.getElementById('homepageLayoutDraggable');
                if (layoutUl) {
                    layoutOrder.forEach(id => {
                        const li = layoutUl.querySelector(`[data-id="${id}"]`);
                        if(li) layoutUl.appendChild(li);
                    });
                }
            }

            const navTradeBtn = document.getElementById('navTradeBtn');
            if (navTradeBtn) {
                if (hideTradeTab && userData.role !== 'admin') navTradeBtn.style.display = 'none';
                else navTradeBtn.style.display = 'flex';
            }

        } catch (e) {
            setTimeout(() => { toggleAccordions('first'); }, 100);
        }

    } catch (err) { container.innerHTML = `<div class="p-3 text-danger text-center">❌ Error loading courses.</div>`; }
}


document.getElementById('videoPlayerContainer').addEventListener('contextmenu', function(e) { e.preventDefault(); });

async function openSecureVideo(lessonId) {
    if (!videoPlayer) {
        videoPlayer = videojs('my-video', { hls: { overrideNative: true }, html5: { vhs: { overrideNative: true } }, controlBar: { fullscreenToggle: false, pictureInPictureToggle: false } });
        videoPlayer.el().addEventListener('contextmenu', function(e) { e.preventDefault(); });
        videoPlayer.on('loadedmetadata', async function() {
            const vw = videoPlayer.videoWidth();
            const vh = videoPlayer.videoHeight();
            
            if (screen.orientation && screen.orientation.lock) {
                try { 
                    if (vw > vh) { 
                        await screen.orientation.lock("landscape"); 
                    } else { 
                        await screen.orientation.lock("portrait"); 
                    } 
                } catch (e) {
                    console.log("Orientation lock failed", e);
                }
            } else {
                if (vw > vh && window.innerHeight > window.innerWidth) {
                    alert("For the best experience, please rotate your device horizontally.");
                }
            }
        });
    }
    videoPlayer.reset(); stopWatermark();
    
    try {
        const response = await fetch(`${API_URL_LESSON}${lessonId}`, { credentials: 'same-origin' });
        if (response.status === 403) { alert("❌ ACCESS DENIED."); return; }
        const data = await response.json();
        
        videoPlayer.src({ src: data.hlsUrl, type: 'application/x-mpegURL' });
        const playerContainer = document.getElementById('videoPlayerContainer');
        playerContainer.style.display = 'block';
        
        if (playerContainer.requestFullscreen) { await playerContainer.requestFullscreen().catch(e => {}); } 
        else if (playerContainer.webkitRequestFullscreen) { await playerContainer.webkitRequestFullscreen().catch(e => {}); }

        startWatermark();
        videoPlayer.play();

        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(() => {
            if (!videoPlayer.paused()) {
                fetch('/api/video/progress', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ lessonId: lessonId, currentTime: videoPlayer.currentTime() })
                }).catch(e => {});
            }
        }, 10000);

    } catch(err) { alert("🚨 Error loading video stream."); }
}

function closeVideoPlayer() {
    if (progressInterval) clearInterval(progressInterval); 
    if (videoPlayer) { videoPlayer.pause(); videoPlayer.reset(); }
    if (screen.orientation && screen.orientation.unlock) { try { screen.orientation.unlock(); } catch (e) {} }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) { document.exitFullscreen().catch(e => {}); } 
        else if (document.webkitExitFullscreen) { document.webkitExitFullscreen().catch(e => {}); }
    }
    stopWatermark();
    document.getElementById('videoPlayerContainer').style.display = 'none';
}

function startWatermark() {
    const wmEl = document.getElementById('dynamicWatermark');
    wmEl.innerHTML = `${userData.email || 'Email'}<br>${userData.phone || 'Phone'}<br>Rdalgo.in`;
    wmEl.style.display = 'block';
    if (watermarkInterval) clearInterval(watermarkInterval);
    moveWatermark();
    watermarkInterval = setInterval(moveWatermark, 3000); 
}

function stopWatermark() {
    if (watermarkInterval) clearInterval(watermarkInterval);
    watermarkInterval = null;
    const wmEl = document.getElementById('dynamicWatermark');
    if (wmEl) wmEl.style.display = 'none';
}

function moveWatermark() {
    const wmEl = document.getElementById('dynamicWatermark');
    const container = document.getElementById('videoPlayerContainer');
    if (!videoPlayer) return;

    const vw = videoPlayer.videoWidth(); const vh = videoPlayer.videoHeight();
    if (!vw || !vh) { wmEl.style.left = '50%'; wmEl.style.top = '50%'; wmEl.style.transform = 'translate(-50%, -50%)'; return; } 
    else { wmEl.style.transform = 'none'; }

    const cw = container.clientWidth; const ch = container.clientHeight;
    const videoRatio = vw / vh; const containerRatio = cw / ch;

    let renderedWidth, renderedHeight, offsetX, offsetY;

    if (videoRatio > containerRatio) { renderedWidth = cw; renderedHeight = cw / videoRatio; offsetX = 0; offsetY = (ch - renderedHeight) / 2; } 
    else { renderedHeight = ch; renderedWidth = ch * videoRatio; offsetX = (cw - renderedWidth) / 2; offsetY = 0; }

    const minX = offsetX + 10; const maxX = Math.max(minX, offsetX + renderedWidth - wmEl.clientWidth - 10);
    const minY = offsetY + 50; const maxY = Math.max(minY, offsetY + renderedHeight - wmEl.clientHeight - 20);

    wmEl.style.left = Math.floor(Math.random() * (maxX - minX + 1)) + minX + 'px';
    wmEl.style.top = Math.floor(Math.random() * (maxY - minY + 1)) + minY + 'px';
}


const formAdminSettings = document.getElementById('formAdminSettings');
if (formAdminSettings) {
    formAdminSettings.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        
        const state = document.getElementById('adminAccordionState')?.value || 'first';
        const hideTrade = document.getElementById('adminHideTradeTab')?.checked ? 'true' : 'false';
        const push_trade_alerts = document.getElementById('adminPushTradeAlerts')?.checked ? 'true' : 'false';
        const showGallery = document.getElementById('adminShowGallery')?.checked ? 'true' : 'false';
        const showCallWidget = document.getElementById('adminShowCallWidget')?.checked ? 'true' : 'false';

        const showStickyFooter = document.getElementById('adminShowStickyFooter')?.checked ? 'true' : 'false';
        const sticky_btn1_text = document.getElementById('adminBtn1Text')?.value || '';
        const sticky_btn1_icon = document.getElementById('adminBtn1Icon')?.value || '';
        const sticky_btn1_link = document.getElementById('adminBtn1Link')?.value || '';
        const sticky_btn2_text = document.getElementById('adminBtn2Text')?.value || '';
        const sticky_btn2_icon = document.getElementById('adminBtn2Icon')?.value || '';
        const sticky_btn2_link = document.getElementById('adminBtn2Link')?.value || '';
        
        const showDisclaimer = document.getElementById('adminShowDisclaimer')?.checked ? 'true' : 'false';
        const register_link = document.getElementById('adminRegisterLink')?.value || '';
        
        let homepage_layout = undefined;
        const layoutList = document.querySelectorAll('#homepageLayoutDraggable li');
        if (layoutList.length > 0) {
            const layoutArray = Array.from(layoutList).map(li => li.getAttribute('data-id'));
            homepage_layout = JSON.stringify(layoutArray);
        }
        
        try {
            const bodyData = { 
                accordion_state: state, 
                hide_trade_tab: hideTrade, 
                push_trade_alerts: push_trade_alerts,
                show_gallery: showGallery, 
                show_call_widget: showCallWidget,
                show_sticky_footer: showStickyFooter,
                sticky_btn1_text: sticky_btn1_text,
                sticky_btn1_icon: sticky_btn1_icon,
                sticky_btn1_link: sticky_btn1_link,
                sticky_btn2_text: sticky_btn2_text,
                sticky_btn2_icon: sticky_btn2_icon,
                sticky_btn2_link: sticky_btn2_link,
                show_disclaimer: showDisclaimer,
                register_link: register_link
            };
            if (homepage_layout) bodyData.homepage_layout = homepage_layout;

            const res = await fetch('/api/admin/settings', { 
                method: 'PUT', 
                headers: {'Content-Type': 'application/json'}, 
                credentials: 'same-origin', 
                body: JSON.stringify(bodyData) 
            });
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('adminCourseModal'));
                if(m) m.hide();
                fetchCourses(); 
            } else { 
                const errData = await res.json().catch(()=>({}));
                alert("Error saving settings: " + (errData.msg || "Unknown"));
            }
        } catch(err) { alert("Network error saving settings."); }
        finally { btn.innerText = "Save Settings"; btn.disabled = false; }
    });
}

const formAdminSymbols = document.getElementById('formAdminSymbols');
if (formAdminSymbols) {
    formAdminSymbols.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        
        try {
            const bodyData = { 
                cat_forex_crypto: document.getElementById('adminCatForex')?.value || '',
                cat_stock: document.getElementById('adminCatStock')?.value || '',
                cat_index: document.getElementById('adminCatIndex')?.value || '',
                cat_mcx: document.getElementById('adminCatMcx')?.value || ''
            };

            const res = await fetch('/api/admin/settings/symbols', { 
                method: 'PUT', 
                headers: {'Content-Type': 'application/json'}, 
                credentials: 'same-origin', 
                body: JSON.stringify(bodyData) 
            });
            
            if(res.ok) { 
                alert("Symbol Categories saved successfully!");
                fetchCourses(); 
            } else { 
                const errData = await res.json().catch(()=>({}));
                alert("Error saving symbols: " + (errData.msg || "Unknown"));
            }
        } catch(err) { alert("Network error saving symbols."); }
        finally { btn.innerText = "Save Symbols"; btn.disabled = false; }
    });
}

const formAddModule = document.getElementById('formAddModule');
if (formAddModule) {
    formAddModule.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Creating..."; btn.disabled = true;
        
        const data = {
            title: document.getElementById('modTitle')?.value || '', 
            description: document.getElementById('modDesc')?.value || '', 
            required_level: document.getElementById('modLevel')?.value || 'demo', 
            display_order: document.getElementById('modDisplayOrder')?.value || 0,
            lock_notice: document.getElementById('modLockNotice')?.value || '',
            show_on_home: document.getElementById('modShowHome')?.value === 'true',
            dashboard_visibility: document.getElementById('modDashVis')?.value || 'all'
        };

        try {
            const res = await fetch('/api/admin/modules', { method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify(data) });
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('adminCourseModal'));
                if(m) m.hide();
                formAddModule.reset(); 
                fetchCourses(); 
            } else {
                const errData = await res.json().catch(()=>({}));
                alert("Error adding module: " + (errData.msg || "Database error. Check duplicate title."));
            }
        } catch(e) { alert("Network Error"); }
        finally { btn.innerText = "Create Module"; btn.disabled = false; }
    });
}

const formAddLesson = document.getElementById('formAddLesson');
if (formAddLesson) {
    formAddLesson.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.append('module_id', document.getElementById('lessonModuleId')?.value || '');
        formData.append('title', document.getElementById('lessonTitle')?.value || '');
        formData.append('description', document.getElementById('lessonDesc')?.value || '');
        formData.append('display_order', document.getElementById('lessonDisplayOrder')?.value || 0);
        
        const videoEl = document.getElementById('lessonVideoFile');
        if (videoEl && videoEl.files[0]) formData.append('video_file', videoEl.files[0]);
        
        const thumbEl = document.getElementById('lessonThumbnailFile');
        if (thumbEl && thumbEl.files[0]) formData.append('thumbnail_file', thumbEl.files[0]);

        const btn = e.target.querySelector('button'); 
        btn.innerText = (videoEl && videoEl.files[0]) ? "⏳ Uploading Video..." : "Saving Document..."; 
        btn.disabled = true;
        
        try {
            const res = await fetch('/api/admin/lessons', { method: 'POST', credentials: 'same-origin', body: formData });
            const data = await res.json().catch(()=>({}));
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('adminCourseModal'));
                if(m) m.hide();
                alert(data.msg); 
                formAddLesson.reset(); 
                fetchCourses();
            } else { alert("Error uploading lesson: " + (data.msg || "Unknown")); }
        } catch(err) { alert("Network error saving lesson."); } 
        finally { btn.innerText = "Upload Video"; btn.disabled = false; }
    });
}

function openEditModule(e, id, title, desc, level, notice, order, showHome, dashVis) {
    e.stopPropagation();
    const modalEl = document.getElementById('editModuleModal');
    if (!modalEl) { alert("Please use the dashboard to edit modules."); return; }

    const safeSet = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
    
    safeSet('editModId', id);
    safeSet('editModTitle', title);
    safeSet('editModDesc', (desc !== 'null' && desc !== 'undefined') ? desc : '');
    safeSet('editModLevel', level);
    safeSet('editModDisplayOrder', order);
    safeSet('editModLockNotice', (notice !== 'null' && notice !== 'undefined') ? notice : '');
    safeSet('editModShowHome', (showHome === false || showHome === 'false') ? 'false' : 'true');
    safeSet('editModDashVis', (dashVis === 'null' || !dashVis) ? 'all' : dashVis);
    
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

const formEditModule = document.getElementById('formEditModule');
if (formEditModule) {
    formEditModule.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        const id = document.getElementById('editModId')?.value || '';
        const data = {
            title: document.getElementById('editModTitle')?.value || '', 
            description: document.getElementById('editModDesc')?.value || '',
            required_level: document.getElementById('editModLevel')?.value || 'demo', 
            display_order: document.getElementById('editModDisplayOrder')?.value || 0,
            lock_notice: document.getElementById('editModLockNotice')?.value || '',
            show_on_home: document.getElementById('editModShowHome')?.value === 'true',
            dashboard_visibility: document.getElementById('editModDashVis')?.value || 'all'
        };
        try {
            const res = await fetch(`/api/admin/modules/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify(data) });
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('editModuleModal'));
                if(m) m.hide();
                fetchCourses(); 
            } else { 
                const errData = await res.json().catch(()=>({}));
                alert("Error updating module: " + (errData.msg || "Unknown")); 
            }
        } catch(err) { alert("Network Error"); }
        finally { btn.innerText = "Save Changes"; btn.disabled = false; }
    });
}

function openEditLesson(e, id, title, desc, order) {
    e.stopPropagation();
    const modalEl = document.getElementById('editLessonModal');
    if (!modalEl) { alert("Please use the dashboard to edit videos."); return; }

    const safeSet = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };

    safeSet('editLessonId', id);
    safeSet('editLessonTitle', title);
    safeSet('editLessonDesc', (desc !== 'null' && desc !== 'undefined') ? desc : '');
    safeSet('editLessonDisplayOrder', order);
    safeSet('editLessonThumbnailFile', '');
    
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

const formEditLesson = document.getElementById('formEditLesson');
if (formEditLesson) {
    formEditLesson.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        const id = document.getElementById('editLessonId')?.value || '';
        const formData = new FormData();
        formData.append('title', document.getElementById('editLessonTitle')?.value || '');
        formData.append('description', document.getElementById('editLessonDesc')?.value || '');
        formData.append('display_order', document.getElementById('editLessonDisplayOrder')?.value || 0);
        
        const thumbEl = document.getElementById('editLessonThumbnailFile');
        if (thumbEl && thumbEl.files[0]) formData.append('thumbnail_file', thumbEl.files[0]);

        try {
            const res = await fetch(`/api/admin/lessons/${id}`, { method: 'PUT', credentials: 'same-origin', body: formData });
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('editLessonModal'));
                if(m) m.hide();
                fetchCourses(); 
            } else { 
                const errData = await res.json().catch(()=>({}));
                alert("Error updating lesson: " + (errData.msg || "Unknown")); 
            }
        } catch(err) { alert("Network Error"); }
        finally { btn.innerText = "Save Changes"; btn.disabled = false; }
    });
}

async function deleteLesson(e, id) {
    e.stopPropagation(); 
    const password = prompt("🔒 Enter Admin Password to delete this lesson:");
    if (!password) return;
    try { 
        const res = await fetch(`/api/admin/lessons/${id}`, { 
            method: 'DELETE', 
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ password })
        }); 
        const data = await res.json();
        if(res.ok && data.success) fetchCourses(); 
        else alert(data.msg || "Error deleting lesson");
    } catch(e) {}
}

async function deleteModule(e, id) {
    e.stopPropagation();
    const password = prompt("🔒 Enter Admin Password to delete this module:");
    if (!password) return;
    try { 
        const res = await fetch(`/api/admin/modules/${id}`, { 
            method: 'DELETE', 
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ password })
        }); 
        const data = await res.json();
        if(res.ok && data.success) fetchCourses(); 
        else alert(data.msg || "Error deleting module");
    } catch(e) { console.error(e); }
}

function applyRoleRestrictions() {
    const role = localStorage.getItem('userRole');
    const statPoints = document.getElementById('statPoints');
    const statWinRate = document.getElementById('statWinRate');

    if (role === 'admin') {
        document.getElementById('btnSelect').style.display = 'flex';
        document.getElementById('btnDelete').style.display = 'flex';
        const btnAdminCourseManager = document.getElementById('btnAdminCourseManager');
        if (btnAdminCourseManager) btnAdminCourseManager.style.display = 'inline-block';
        const adminAccordionControls = document.getElementById('adminAccordionControls');
        if (adminAccordionControls) adminAccordionControls.style.display = 'block';

        if (statPoints) statPoints.style.display = 'flex';
        if (statWinRate) statWinRate.style.display = 'flex';

        const navPushBtn = document.getElementById('navPushBtn');
        if (navPushBtn) navPushBtn.style.display = 'flex';

    } else {
        if (statPoints) statPoints.style.display = 'none';
        if (statWinRate) statWinRate.style.display = 'none';
    }
}

function initDatePicker() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    datePicker = flatpickr("#filterDateRange", { mode: "range", dateFormat: "Y-m-d", defaultDate: today, onChange: function() { applyFilters(); } });
}

// --- SOUND ALERT ---
const tradeSound = new Audio('/chaching.mp3');

socket.on('trade_update', () => { 
    fetchTrades(); 
    tradeSound.play().catch(e => { console.log("Browser blocked auto-play sound."); });
});

// --- LISTEN FOR NOTIFICATIONS ---
socket.on('new_notification', () => {
    if (typeof fetchUserNotifications === 'function') fetchUserNotifications(false);
    if (typeof fetchChatNotifications === 'function') fetchChatNotifications(false);
    
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'block';
    
    tradeSound.play().catch(e => {});
});

socket.on('force_logout', (data) => {
    const currentEmail = localStorage.getItem('userEmail');
    const currentSessionId = localStorage.getItem('sessionId');
    
    if (currentEmail === data.email && currentSessionId !== data.newSessionId) {
        alert("Logged in from another device. Your current session has expired.");
        logout(); 
    }
});

async function fetchTrades() {
    const checkedIds = getCheckedIds();
    try {
        const response = await fetch(API_URL, { method: 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' });
        if (response.status === 401 || response.status === 403) { window.location.href = '/home.html'; return; }
        allTrades = await response.json();
        populateSymbolFilter(allTrades);
        applyFilters(checkedIds); 
    } catch (error) {}
}

function populateSymbolFilter(trades) {
    const symbolSelect = document.getElementById('filterSymbol');
    if(!symbolSelect) return;
    const currentVal = symbolSelect.value;
    const uniqueSymbols = [...new Set(trades.map(t => t.symbol))].sort();
    symbolSelect.innerHTML = '<option value="">All Symbols</option>';
    uniqueSymbols.forEach(sym => { const option = document.createElement('option'); option.value = sym; option.text = sym; symbolSelect.appendChild(option); });
    if(uniqueSymbols.includes(currentVal)) symbolSelect.value = currentVal;
}

function applyFilters(preserveIds = []) {
    const filterSymbol = document.getElementById('filterSymbol')?.value || '';
    const filterStatus = document.getElementById('filterStatus')?.value || 'ALL';
    const filterType = document.getElementById('filterType')?.value || 'ALL';
    const filterCategory = document.getElementById('filterCategory')?.value || 'ALL'; 
    let startDate = ""; let endDate = "";
    
    if (datePicker && datePicker.selectedDates.length > 0) {
        const formatOpts = { timeZone: 'Asia/Kolkata' };
        startDate = datePicker.selectedDates[0].toLocaleDateString('en-CA', formatOpts);
        endDate = datePicker.selectedDates.length === 2 ? datePicker.selectedDates[1].toLocaleDateString('en-CA', formatOpts) : startDate;
    }
    
    const dateDisplay = document.getElementById('activeDateDisplay');
    if (dateDisplay) {
        if (!startDate && !endDate) { 
            dateDisplay.innerText = "All Time"; 
        } else if (startDate === endDate) { 
            dateDisplay.innerText = datePicker.selectedDates[0].toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); 
        } else { 
            dateDisplay.innerText = `${startDate.substring(5)} to ${endDate.substring(5)}`; 
        }
    }

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    const filtered = allTrades.reduce((acc, trade) => {
        const tradeDateObj = new Date(trade.created_at);
        const tradeDateStr = tradeDateObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        
        let dateMatch = true;
        if (startDate && endDate) dateMatch = (tradeDateStr >= startDate && tradeDateStr <= endDate);
        else if (startDate) dateMatch = (tradeDateStr >= startDate);
        else if (endDate) dateMatch = (tradeDateStr <= endDate);
        if (!dateMatch) return acc;

        let displayStatus = trade.status;
        let isVisuallyActive = (trade.status === 'ACTIVE' || trade.status === 'SETUP');
        
        if (isVisuallyActive && tradeDateStr < todayStr) {
            isVisuallyActive = false; 
            const pts = parseFloat(trade.points_gained || 0);
            if (pts > 0) displayStatus = 'PROFIT (CLOSED)';
            else if (pts < 0) displayStatus = 'LOSS (CLOSED)';
            else displayStatus = 'CLOSED (BREAKEVEN)';
        }

        const typeMatch = (filterType === 'ALL' || trade.type === filterType);
        const symbolMatch = (filterSymbol === "" || trade.symbol === filterSymbol);
        let statusMatch = true;
        
        if (filterStatus === 'TP') statusMatch = (displayStatus.includes('TP') || displayStatus.includes('PROFIT'));
        else if (filterStatus === 'SL') statusMatch = (displayStatus.includes('SL') || displayStatus.includes('LOSS'));
        else if (filterStatus === 'OPEN') statusMatch = isVisuallyActive;

        let categoryMatch = true;
        if (filterCategory !== 'ALL') {
            const allowedSymbols = symbolCategories[filterCategory] || [];
            categoryMatch = allowedSymbols.includes(trade.symbol.toUpperCase());
        }

        if (typeMatch && symbolMatch && statusMatch && categoryMatch) { 
            acc.push({ ...trade, displayStatus, isVisuallyActive, tradeDateObj }); 
        }
        return acc;
    }, []);

    renderTrades(filtered, preserveIds);
    calculateStats(filtered);
}

function renderTrades(trades, preserveIds) {
    const container = document.getElementById('tradeListContainer');
    const noDataMsg = document.getElementById('noData');
    if (!container) return;
    
    if (trades.length === 0) { container.innerHTML = ''; if(noDataMsg) noDataMsg.style.display = 'block'; return; } 
    else { if(noDataMsg) noDataMsg.style.display = 'none'; }

    let htmlContent = '';
    trades.forEach((trade) => {
        const dateString = trade.tradeDateObj.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }); 
        const timeString = trade.tradeDateObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
        const entry = parseFloat(trade.entry_price).toFixed(2);
        const sl = parseFloat(trade.sl_price).toFixed(2);
        const tp1 = parseFloat(trade.tp1_price).toFixed(2);
        const tp2 = parseFloat(trade.tp2_price).toFixed(2);
        const tp3 = parseFloat(trade.tp3_price).toFixed(2);
        const pts = parseFloat(trade.points_gained);
        const displayPts = pts.toFixed(2);

        let profitColor = 'text-muted'; let statusColor = '#878a8d'; let statusText = trade.displayStatus.replace(' (Reversal)', '');
        if (trade.isVisuallyActive) { statusColor = '#007aff'; }
        else if (statusText.includes('TP') || statusText.includes('PROFIT')) { statusColor = '#00b346'; profitColor = 'c-green'; }
        else if (statusText.includes('SL') || statusText.includes('LOSS')) { statusColor = '#ff3b30'; profitColor = 'c-red'; }
        else if (pts > 0) { profitColor = 'c-green'; }
        else if (pts < 0) { profitColor = 'c-red'; }

        const badgeClass = trade.type === 'BUY' ? 'bg-buy' : 'bg-sell';
        const isChecked = preserveIds.includes(trade.trade_id) ? 'checked' : '';
        const checkDisplay = isSelectionMode ? 'block' : 'none';

        htmlContent += `
            <div class="trade-card">
                <div class="tc-top">
                    <div class="d-flex align-items-center">
                        <input type="checkbox" class="custom-check trade-checkbox" value="${trade.trade_id}" ${isChecked} style="display:${checkDisplay}">
                        <div class="tc-symbol">${trade.symbol}</div>
                    </div>
                    <div class="tc-profit ${profitColor}">${pts > 0 ? '+' : ''}${displayPts}</div>
                </div>
                <div class="tc-mid">
                    <span class="type-badge ${badgeClass}">${trade.type}</span>
                    <span class="tc-time">${dateString} • ${timeString}</span>
                    <span class="status-txt ms-auto" style="color:${statusColor}">${statusText}</span>
                </div>
                <div class="tc-bot">
                    <div class="dt-item"><span class="dt-lbl">ENTRY</span><span class="dt-val">${entry}</span></div>
                    <div class="dt-item"><span class="dt-lbl">SL</span><span class="dt-val c-red">${sl}</span></div>
                    <div class="dt-item"><span class="dt-lbl">TP1</span><span class="dt-val">${tp1}</span></div>
                    <div class="dt-item"><span class="dt-lbl">TP2</span><span class="dt-val">${tp2}</span></div>
                    <div class="dt-item"><span class="dt-lbl">TP3</span><span class="dt-val">${tp3}</span></div>
                </div>
            </div>`;
    });
    container.innerHTML = htmlContent;
}

function calculateStats(trades) {
    let totalPoints = 0; let wins = 0; let losses = 0; let active = 0;
    trades.forEach(t => {
        if (t.isVisuallyActive) { active++; } 
        else { const pts = parseFloat(t.points_gained); totalPoints += pts; if (pts > 0) wins++; else if (pts < 0) losses++; }
    });
    const totalClosed = wins + losses;
    const winRate = totalClosed === 0 ? 0 : Math.round((wins / totalClosed) * 100);

    if(document.getElementById('totalTrades')) document.getElementById('totalTrades').innerText = trades.length;
    if(document.getElementById('winRate')) document.getElementById('winRate').innerText = winRate + "%";
    
    const pipsEl = document.getElementById('totalPips');
    if (pipsEl) {
        pipsEl.innerText = totalPoints.toFixed(2);
        pipsEl.className = totalPoints >= 0 ? 'stat-val val-green' : 'stat-val val-red';
    }
    
    if(document.getElementById('activeTrades')) document.getElementById('activeTrades').innerText = active;
}

function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    const checkboxes = document.querySelectorAll('.trade-checkbox');
    const navDefault = document.getElementById('navDefault');
    const navSelection = document.getElementById('navSelection');
    if(isSelectionMode) { navDefault.style.display = 'none'; navSelection.style.display = 'flex'; } 
    else { navDefault.style.display = 'flex'; navSelection.style.display = 'none'; checkboxes.forEach(cb => cb.checked = false); }
    checkboxes.forEach(cb => cb.style.display = isSelectionMode ? 'block' : 'none');
}

function selectAllTrades() {
    const checkboxes = document.querySelectorAll('.trade-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
}

function getCheckedIds() { return Array.from(document.querySelectorAll('.trade-checkbox:checked')).map(cb => cb.value); }

async function deleteSelected() {
    if (!isSelectionMode) { toggleSelectionMode(); return; }
    const ids = getCheckedIds();
    if (ids.length === 0) return;
    const password = prompt("🔒 Enter Admin Password to delete:");
    if (!password) return; 
    try {
        const res = await fetch('/api/delete_trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ trade_ids: ids, password: password }) });
        const result = await res.json();
        if (result.success) { toggleSelectionMode(); alert("✅ Deleted Successfully"); } else { alert(result.msg || "❌ Error Deleting"); }
    } catch (err) {}
}

async function logout() {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); sessionStorage.clear(); localStorage.clear(); window.location.href = '/home.html'; } catch (err) {}
}

const filterSymbolEl = document.getElementById('filterSymbol');
if (filterSymbolEl) filterSymbolEl.addEventListener('change', () => applyFilters());

const filterStatusEl = document.getElementById('filterStatus');
if (filterStatusEl) filterStatusEl.addEventListener('change', () => applyFilters());

const filterTypeEl = document.getElementById('filterType');
if (filterTypeEl) filterTypeEl.addEventListener('change', () => applyFilters());

const filterCategoryEl = document.getElementById('filterCategory');
if (filterCategoryEl) filterCategoryEl.addEventListener('change', () => applyFilters());


// ========================================================
// PAGINATED PUSH NOTIFICATION CHAT UI LOGIC
// ========================================================
let chatNotifications = [];
let adminNotifOffset = 0;
const NOTIF_LIMIT = 15; // Limit chunks roughly equivalent to a day of notifications

async function fetchChatNotifications(loadMore = false) {
    const history = document.getElementById('chatHistory');
    if(!history) return;
    
    if (loadMore) {
        adminNotifOffset += NOTIF_LIMIT;
        const btn = document.getElementById('btnLoadMoreAdmin');
        if(btn) btn.innerText = 'Loading...';
    } else {
        adminNotifOffset = 0;
        chatNotifications = [];
    }

    try {
        const res = await fetch(`/api/admin/notifications?limit=${NOTIF_LIMIT}&offset=${adminNotifOffset}`, { credentials: 'same-origin' });
        const json = await res.json();
        
        if(json.success) {
            const fetched = json.data;
            
            if (!loadMore) chatNotifications = fetched;
            else chatNotifications = [...chatNotifications, ...fetched];
            
            if (chatNotifications.length === 0) {
                history.innerHTML = '<div class="text-center text-muted mt-3" style="font-size:12px;">No broadcasts sent yet.</div>';
                return;
            }

            // chatNotifications has newest first (DESC). We want newest at bottom, so we reverse it.
            const sortedForDisplay = [...chatNotifications].reverse();
            
            let html = '';
            // "Show More" button goes at the TOP because oldest messages are at the top
            if (fetched.length === NOTIF_LIMIT) {
                html += `<div class="text-center my-2"><button id="btnLoadMoreAdmin" class="btn btn-sm btn-outline-secondary shadow-sm" style="font-size: 11px; border-radius: 12px; padding: 4px 12px; background: #fff;" onclick="fetchChatNotifications(true)">Show More Old Broadcasts</button></div>`;
            }

            html += sortedForDisplay.map(n => {
                const dateObj = n.scheduled_for ? new Date(n.scheduled_for) : new Date(n.created_at);
                const dateStr = dateObj.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ' ' + dateObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
                
                const isScheduled = n.status === 'pending';
                const bubbleClass = isScheduled ? 'scheduled' : 'sent';
                const icon = isScheduled ? 'schedule' : 'done_all';
                const iconColor = isScheduled ? '#856404' : '#53bdeb';
                
                let targetText = '';
                if (n.target_audience === 'logged_in') targetText = '🔒 Login Users';
                else if (n.target_audience === 'non_logged_in') targetText = '🌐 Public Users';
                else targetText = '🌍 All Users';

                let recurrenceText = '';
                if (n.recurrence === 'daily') recurrenceText = ' | 🔁 Daily';
                else if (n.recurrence === 'weekly') recurrenceText = ' | 🔁 Weekly';

                return `
                <div class="chat-bubble ${bubbleClass}">
                    <div class="chat-title">${n.title}</div>
                    <div class="chat-body">${n.body}</div>
                    ${n.url && n.url !== '/' ? `<a href="${n.url}" target="_blank" class="chat-link">${n.url}</a>` : ''}
                    <div class="chat-meta">
                        <span class="badge bg-secondary me-auto" style="font-size:8px;">${targetText}${recurrenceText}</span>
                        <span>${isScheduled ? 'Sched: ' : ''}${dateStr}</span>
                        <span class="material-icons-round" style="font-size:14px; color:${iconColor};">${icon}</span>
                        <span class="material-icons-round chat-del-btn ms-2" onclick="deleteChatPush(${n.id})">delete</span>
                    </div>
                </div>`;
            }).join('');
            
            const oldScrollHeight = history.scrollHeight;
            history.innerHTML = html;

            // Maintain scroll position when loading history
            if (!loadMore) history.scrollTop = history.scrollHeight;
            else history.scrollTop = history.scrollHeight - oldScrollHeight;
        }
    } catch (e) {
        if(!loadMore) history.innerHTML = '<div class="text-center text-danger mt-3" style="font-size:12px;">Error loading messages.</div>';
    }
}

const formChatPush = document.getElementById('formChatPush');
if (formChatPush) {
    formChatPush.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnChatPushSubmit');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        const formData = new FormData();
        formData.append('target_audience', document.getElementById('chatPushTarget').value);
        formData.append('title', document.getElementById('chatPushTitle').value);
        formData.append('body', document.getElementById('chatPushBody').value);
        formData.append('url', document.getElementById('chatPushUrl').value);
        
        const scheduleTime = document.getElementById('chatPushSchedule').value;
        if (scheduleTime) formData.append('schedule_time', scheduleTime);
        
        formData.append('recurrence', document.getElementById('chatPushRecurrence').value || 'none');
        
        const imageEl = document.getElementById('chatPushImage');
        if (imageEl && imageEl.files[0]) {
            formData.append('push_image', imageEl.files[0]);
        }

        try {
            const res = await fetch('/api/admin/notifications', {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });

            if (res.ok) {
                document.getElementById('chatPushTitle').value = '';
                document.getElementById('chatPushBody').value = '';
                document.getElementById('chatPushUrl').value = '';
                document.getElementById('chatPushSchedule').value = '';
                document.getElementById('chatPushRecurrence').value = 'none';
                if (imageEl) imageEl.value = '';
                fetchChatNotifications(false); // Reset and load newest
            } else {
                alert("Error sending notification.");
            }
        } catch (e) { alert("Network Error"); }
        finally { 
            btn.disabled = false; 
            btn.innerHTML = '<span class="material-icons-round" style="margin-left:4px; font-size:18px;">send</span>';
        }
    });
}

window.deleteChatPush = async function(id) {
    if(!confirm("Are you sure you want to delete this notification?")) return;
    try {
        const res = await fetch(`/api/admin/notifications/${id}`, { method: 'DELETE', credentials: 'same-origin' });
        if(res.ok) fetchChatNotifications(false);
    } catch(e) { alert("Error deleting."); }
};

// --- SCHEDULED PUSHES MANAGEMENT ---
async function fetchScheduledPushes() {
    const list = document.getElementById('scheduledPushList');
    if(!list) return;
    list.innerHTML = '<div class="text-center text-muted p-3" style="font-size: 12px;">Loading...</div>';
    try {
        const res = await fetch('/api/admin/notifications/scheduled', { credentials: 'same-origin' });
        const json = await res.json();
        if(json.success) {
            if(json.data.length === 0) {
                list.innerHTML = '<div class="text-center text-muted p-3" style="font-size: 12px;">No scheduled or recurring pushes found.</div>';
                return;
            }
            list.innerHTML = json.data.map(n => {
                const dateObj = n.scheduled_for ? new Date(n.scheduled_for) : null;
                const dateStr = dateObj ? dateObj.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ' ' + dateObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'Immediate/Sent';
                
                let targetText = n.target_audience === 'logged_in' ? '🔒 Login Users' : (n.target_audience === 'non_logged_in' ? '🌐 Public Users' : '🌍 All Users');
                let recurrenceText = n.recurrence === 'daily' ? ' | 🔁 Daily' : (n.recurrence === 'weekly' ? ' | 🔁 Weekly' : ' | Once');

                return `
                <div class="p-2 mb-2 bg-white rounded border shadow-sm position-relative">
                    <div class="fw-bold text-dark" style="font-size: 13px;">${n.title}</div>
                    <div class="text-muted" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.body}</div>
                    <div class="mt-1 d-flex justify-content-between align-items-center">
                        <span class="badge bg-light text-dark border" style="font-size: 9px;">${targetText}${recurrenceText}</span>
                        <span class="text-primary fw-bold" style="font-size: 10px;">${dateStr}</span>
                    </div>
                    <div class="mt-2 d-flex gap-2">
                        <button class="btn btn-sm btn-outline-primary w-50 py-1" style="font-size:10px; font-weight:bold;" onclick='openEditPushModal(${JSON.stringify(n).replace(/'/g, "\\'")})'>Edit</button>
                        <button class="btn btn-sm btn-outline-danger w-50 py-1" style="font-size:10px; font-weight:bold;" onclick="deleteScheduledPush(${n.id})">Delete</button>
                    </div>
                </div>`;
            }).join('');
        }
    } catch(e) { list.innerHTML = '<div class="text-center text-danger p-3" style="font-size: 12px;">Error loading.</div>'; }
}

window.openEditPushModal = function(n) {
    document.getElementById('editPushId').value = n.id;
    document.getElementById('editPushTarget').value = n.target_audience || 'both';
    document.getElementById('editPushTitle').value = n.title || '';
    document.getElementById('editPushBody').value = n.body || '';
    document.getElementById('editPushUrl').value = n.url !== '/' ? n.url : '';
    document.getElementById('editPushRecurrence').value = n.recurrence || 'none';
    
    const imgInput = document.getElementById('editPushImage');
    if(imgInput) imgInput.value = ''; // Reset file input
    
    const currentImgLabel = document.getElementById('editPushCurrentImgLabel');
    if(currentImgLabel) {
        currentImgLabel.style.display = n.image_path ? 'block' : 'none';
    }

    if (n.scheduled_for) {
        // Convert ISO to datetime-local format (YYYY-MM-DDThh:mm) respecting timezone offset
        const d = new Date(n.scheduled_for);
        const tzOffset = d.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(d - tzOffset)).toISOString().slice(0, 16);
        document.getElementById('editPushSchedule').value = localISOTime;
    } else {
        document.getElementById('editPushSchedule').value = '';
    }

    bootstrap.Modal.getOrCreateInstance(document.getElementById('editPushModal')).show();
};

window.deleteScheduledPush = async function(id) {
    if(!confirm("Delete this scheduled notification?")) return;
    try {
        const res = await fetch(`/api/admin/notifications/${id}`, { method: 'DELETE', credentials: 'same-origin' });
        if(res.ok) {
            fetchScheduledPushes();
            fetchChatNotifications(false);
        }
    } catch(e) { alert("Error deleting."); }
};

const formEditPush = document.getElementById('formEditPush');
if (formEditPush) {
    formEditPush.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnEditPushSubmit');
        btn.disabled = true; btn.innerText = 'Saving...';

        const id = document.getElementById('editPushId').value;
        const formData = new FormData();
        formData.append('target_audience', document.getElementById('editPushTarget').value);
        formData.append('title', document.getElementById('editPushTitle').value);
        formData.append('body', document.getElementById('editPushBody').value);
        formData.append('url', document.getElementById('editPushUrl').value);
        
        const scheduleTime = document.getElementById('editPushSchedule').value;
        if(scheduleTime) formData.append('schedule_time', scheduleTime);
        
        formData.append('recurrence', document.getElementById('editPushRecurrence').value || 'none');
        
        const imageEl = document.getElementById('editPushImage');
        if (imageEl && imageEl.files[0]) {
            formData.append('push_image', imageEl.files[0]);
        }

        try {
            const res = await fetch(`/api/admin/notifications/${id}`, {
                method: 'PUT',
                body: formData,
                credentials: 'same-origin'
            });
            if (res.ok) {
                bootstrap.Modal.getInstance(document.getElementById('editPushModal')).hide();
                fetchScheduledPushes();
                fetchChatNotifications(false);
            } else {
                alert("Error updating notification.");
            }
        } catch (e) { alert("Network Error"); }
        finally { btn.disabled = false; btn.innerText = 'Save Changes'; }
    });
}

// --- PAGINATED USER NOTIFICATIONS LOGIC ---
let userNotifications = [];
let userNotifOffset = 0;

async function fetchUserNotifications(loadMore = false) {
    const list = document.getElementById('userNotificationList');
    if(!list) return;
    
    if (loadMore) {
        userNotifOffset += NOTIF_LIMIT;
        const btn = document.getElementById('btnLoadMoreUser');
        if(btn) btn.innerText = 'Loading...';
    } else {
        userNotifOffset = 0;
        userNotifications = [];
    }
    
    try {
        const res = await fetch(`/api/user/notifications?limit=${NOTIF_LIMIT}&offset=${userNotifOffset}`, { credentials: 'same-origin' });
        if (!res.ok) return;
        const json = await res.json();
        
        if(json.success) {
            const fetched = json.data;
            
            if (!loadMore) userNotifications = fetched;
            else userNotifications = [...userNotifications, ...fetched];
            
            if(userNotifications.length === 0) {
                list.innerHTML = '<div class="text-center text-muted mt-3" style="font-size:12px;">No notifications yet.</div>';
                return;
            }
            
            // User List puts newest at the top
            let html = userNotifications.map(n => {
                const dateObj = n.scheduled_for ? new Date(n.scheduled_for) : new Date(n.created_at);
                const dateStr = dateObj.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ' ' + dateObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
                
                return `
                <div class="chat-bubble sent" style="max-width: 100%; margin-left:0; border-radius: 8px;">
                    <div class="chat-title">${n.title}</div>
                    <div class="chat-body">${n.body}</div>
                    ${n.url && n.url !== '/' ? `<a href="${n.url}" target="_blank" class="chat-link">${n.url}</a>` : ''}
                    <div class="chat-meta mt-1 pt-1">
                        <span>${dateStr}</span>
                    </div>
                </div>`;
            }).join('');
            
            // "Show More" goes at the BOTTOM of the user notification panel
            if (fetched.length === NOTIF_LIMIT) {
                html += `<div class="text-center my-3"><button id="btnLoadMoreUser" class="btn btn-sm btn-outline-secondary w-100 fw-bold" style="font-size: 12px; border-radius: 8px; background: #fff;" onclick="fetchUserNotifications(true)">Show More History</button></div>`;
            }

            list.innerHTML = html;
        }
    } catch (e) {
        if(!loadMore) list.innerHTML = '<div class="text-center text-danger mt-3" style="font-size:12px;">Error loading alerts.</div>';
    }
}
