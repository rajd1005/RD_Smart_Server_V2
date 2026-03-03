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

const userData = {
    email: localStorage.getItem('userEmail'),
    phone: localStorage.getItem('userPhone'),
    role: localStorage.getItem('userRole')
};

window.onload = function() {
    initDatePicker();
    fetchTrades(); 
    fetchCourses(); 
    applyRoleRestrictions(); 
    
    switchSection('learning'); 
    
    if (sessionStorage.getItem('disclaimerAccepted') !== 'true') {
        const modalEl = document.getElementById('disclaimerModal');
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
};

window.acceptDisclaimer = async function() {
    const btn = document.querySelector('#disclaimerModal .btn-success');
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
    if (section === 'trade') {
        document.getElementById('tradeSection').style.display = 'block';
        document.getElementById('learningSection').style.display = 'none';
        document.getElementById('navTradeBtn').classList.add('b-active');
        document.getElementById('navLearnBtn').classList.remove('b-active');
        document.getElementById('btnRefresh').style.display = 'flex';
        document.getElementById('btnFilter').style.display = 'flex';
        applyRoleRestrictions(); 
    } else {
        document.getElementById('tradeSection').style.display = 'none';
        document.getElementById('learningSection').style.display = 'block';
        document.getElementById('navLearnBtn').classList.add('b-active');
        document.getElementById('navTradeBtn').classList.remove('b-active');
        document.getElementById('btnRefresh').style.display = 'none';
        document.getElementById('btnFilter').style.display = 'none';
        document.getElementById('btnSelect').style.display = 'none';
        document.getElementById('btnDelete').style.display = 'none';
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
        
        // Initialize Sortable logic for admin users
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

            const showGallery = settings.show_gallery !== 'false';
            const adminGalleryCheck = document.getElementById('adminShowGallery');
            if (adminGalleryCheck) adminGalleryCheck.checked = showGallery;

            // --- UPDATED: PULL CALL WIDGET SETTING FOR ADMIN VIEW ---
            const showCallWidget = settings.show_call_widget !== 'false';
            const adminCallWidgetCheck = document.getElementById('adminShowCallWidget');
            if (adminCallWidgetCheck) adminCallWidgetCheck.checked = showCallWidget;

            // Render existing layout arrangement for the draggable UI in Admin Panel
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
            
            // Check if the API is supported (iOS Safari Fix)
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
                // Fallback for iOS devices
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
    } catch(err) { alert("🚨 Error loading video stream."); }
}

function closeVideoPlayer() {
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


// --- FORM SUBMIT HANDLERS ---
const formAdminSettings = document.getElementById('formAdminSettings');
if (formAdminSettings) {
    formAdminSettings.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        
        const state = document.getElementById('adminAccordionState')?.value || 'first';
        const hideTrade = document.getElementById('adminHideTradeTab')?.checked ? 'true' : 'false';
        const showGallery = document.getElementById('adminShowGallery')?.checked ? 'true' : 'false';
        const showCallWidget = document.getElementById('adminShowCallWidget')?.checked ? 'true' : 'false';
        
        // Retrieve the new layout arrangement from the Draggable UI
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
                show_gallery: showGallery, 
                show_call_widget: showCallWidget 
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
    if(!confirm("⚠️ Delete this video?")) return;
    try { const res = await fetch(`/api/admin/lessons/${id}`, { method: 'DELETE', credentials: 'same-origin' }); if(res.ok) fetchCourses(); } catch(e) {}
}

function applyRoleRestrictions() {
    const role = localStorage.getItem('userRole');
    if (role === 'admin') {
        document.getElementById('btnSelect').style.display = 'flex';
        document.getElementById('btnDelete').style.display = 'flex';
        const btnAdminCourseManager = document.getElementById('btnAdminCourseManager');
        if (btnAdminCourseManager) btnAdminCourseManager.style.display = 'inline-block';
        const adminAccordionControls = document.getElementById('adminAccordionControls');
        if (adminAccordionControls) adminAccordionControls.style.display = 'block';
    }
}

function initDatePicker() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    datePicker = flatpickr("#filterDateRange", { mode: "range", dateFormat: "Y-m-d", defaultDate: today, onChange: function() { applyFilters(); } });
}

socket.on('trade_update', () => { fetchTrades(); });

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

        if (typeMatch && symbolMatch && statusMatch) { 
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
