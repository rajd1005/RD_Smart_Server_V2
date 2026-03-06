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
            safeSetVal('adminManagerEmails', settings.manager_emails); // NEW LINE

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
                // Modified to allow manager access
                if (hideTradeTab && userData.role !== 'admin' && userData.role !== 'manager') navTradeBtn.style.display = 'none';
                else navTradeBtn.style.display = 'flex';
            }

        } catch (e) {
            setTimeout(() => { toggleAccordions('first'); }, 100);
        }

    } catch (err) { container.innerHTML = `<div class="p-3 text-danger text-center">❌ Error loading courses.</div>`; }
}

const videoPlayerContainer = document.getElementById('videoPlayerContainer');
if (videoPlayerContainer) {
    videoPlayerContainer.addEventListener('contextmenu', function(e) { e.preventDefault(); });
}

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
