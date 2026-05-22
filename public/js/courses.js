// Global video player reference
let player = null;

// Helper Function for Automated Daily Sales Labels (IST)
window.getTodaySalesLabel = function(settingsObj) {
    if (!settingsObj || !settingsObj.daily_sales_labels) return '';
    try {
        const labels = JSON.parse(settingsObj.daily_sales_labels);
        const istDateString = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"});
        const istDate = new Date(istDateString);
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const currentISTDay = days[istDate.getDay()];
        return labels[currentISTDay] || '';
    } catch(e) {
        return '';
    }
};

async function fetchCourses() {
    const container = document.getElementById('courseModuleContainer');
    if (!container) return;

    try {
        const res = await fetch('/api/public/courses');
        if (!res.ok) throw new Error('Failed to fetch courses');
        const json = await res.json();
        
        if (json.success) {
            const settings = json.settings || {};
            window.appSettings = settings;

            // Admin Settings Population (Safe Set)
            const safeSetVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
            
            safeSetVal('adminAccordionState', settings.accordion_state || 'first');
            
            const adminHideTrade = document.getElementById('adminHideTradeTab');
            if (adminHideTrade) adminHideTrade.checked = settings.hide_trade_tab === 'true';

            const adminPushTradeAlerts = document.getElementById('adminPushTradeAlerts');
            if (adminPushTradeAlerts) adminPushTradeAlerts.checked = settings.push_trade_alerts !== 'false';

            const adminShowGallery = document.getElementById('adminShowGallery');
            if (adminShowGallery) adminShowGallery.checked = settings.show_gallery !== 'false';

            const adminShowCallWidget = document.getElementById('adminShowCallWidget');
            if (adminShowCallWidget) adminShowCallWidget.checked = settings.show_call_widget !== 'false';

            const adminShowChannelTab = document.getElementById('adminShowChannelTab');
            if (adminShowChannelTab) adminShowChannelTab.checked = settings.show_channel_tab !== 'false';

            const adminStickyFooter = document.getElementById('adminShowStickyFooter');
            if (adminStickyFooter) adminStickyFooter.checked = settings.show_sticky_footer === 'true';

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
            safeSetVal('adminManagerEmails', settings.manager_emails);

            // --- PRE-LOGIN MARKETING POPUP SETTINGS ---
            const loginPopupShow = settings.login_popup_show === 'true';
            const adminLoginPopupShowCheck = document.getElementById('adminLoginPopupShow');
            if (adminLoginPopupShowCheck) adminLoginPopupShowCheck.checked = loginPopupShow;

            safeSetVal('adminLoginPopupTitle', settings.login_popup_title);
            safeSetVal('adminLoginPopupDesc', settings.login_popup_desc);
            safeSetVal('adminLoginPopupBtnText', settings.login_popup_btn_text);
            safeSetVal('adminLoginPopupBtnLink', settings.login_popup_btn_link);
            // ---------------------------------------------------------------

            // --- LOAD DAILY SALES LABELS ---
            if (settings.daily_sales_labels) {
                try {
                    const labels = JSON.parse(settings.daily_sales_labels);
                    safeSetVal('adminLabelMon', labels.Mon);
                    safeSetVal('adminLabelTue', labels.Tue);
                    safeSetVal('adminLabelWed', labels.Wed);
                    safeSetVal('adminLabelThu', labels.Thu);
                    safeSetVal('adminLabelFri', labels.Fri);
                    safeSetVal('adminLabelSat', labels.Sat);
                    safeSetVal('adminLabelSun', labels.Sun);
                } catch(e) {}
            }
            // ---------------------------------------------------------------

            safeSetVal('adminCatForex', settings.cat_forex_crypto);
            safeSetVal('adminCatStock', settings.cat_stock);
            safeSetVal('adminCatIndex', settings.cat_index);
            safeSetVal('adminCatMcx', settings.cat_mcx);

            // Render Modules and Lessons
            renderCourses(json.data, settings);
        }
    } catch (e) {
        console.error("Error fetching courses", e);
        container.innerHTML = '<div class="p-4 text-center text-danger">Error loading courses. Please try again.</div>';
    }
}

function renderCourses(modules, settings) {
    const container = document.getElementById('courseModuleContainer');
    const role = localStorage.getItem('userRole') || 'user';
    const userAccess = JSON.parse(localStorage.getItem('userAccess') || '{}');
    
    // Admin module population for Dropdowns
    const lessonModuleId = document.getElementById('lessonModuleId');
    if (lessonModuleId) {
        lessonModuleId.innerHTML = '<option value="">Select...</option>';
        modules.forEach(m => {
            lessonModuleId.innerHTML += `<option value="${m.id}">${m.title}</option>`;
        });
    }

    if (!modules || modules.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-muted">No courses available.</div>';
        return;
    }

    let html = '';
    modules.forEach((mod) => {
        const isAccessible = checkAccess(mod.required_level, role, userAccess);
        if (mod.dashboard_visibility === 'hidden' && role !== 'admin' && role !== 'manager') return;
        if (mod.dashboard_visibility === 'accessible' && !isAccessible && role !== 'admin' && role !== 'manager') return;

        const collapseId = `collapseModule${mod.id}`;
        const headingId = `headingModule${mod.id}`;
        
        let adminControls = '';
        if (role === 'admin' || role === 'manager') {
            adminControls = `
                <button class="admin-edit-btn ms-2" onclick="openEditModule(event, ${mod.id}, '${mod.title.replace(/'/g, "\\'")}', '${mod.description ? mod.description.replace(/'/g, "\\'") : ''}', '${mod.required_level}', '${mod.lock_notice ? mod.lock_notice.replace(/'/g, "\\'") : ''}', ${mod.display_order}, ${mod.show_on_home}, '${mod.dashboard_visibility}')"><span class="material-icons-round" style="font-size:16px;">edit</span></button>
                <button class="admin-del-btn" onclick="deleteModule(event, ${mod.id})"><span class="material-icons-round" style="font-size:16px;">delete</span></button>
            `;
        }

        html += `
        <div class="accordion-item">
            <h2 class="accordion-header" id="${headingId}">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                    <div class="d-flex justify-content-between align-items-center w-100">
                        <div class="d-flex flex-column text-start">
                            <span>${mod.title}</span>
                            ${mod.description ? `<span style="font-size:10px; font-weight:normal; color:#666; margin-top:2px;">${mod.description}</span>` : ''}
                        </div>
                        <div class="d-flex align-items-center">
                            ${!isAccessible ? '<span class="material-icons-round text-warning me-2" style="font-size:16px;">lock</span>' : ''}
                            ${adminControls}
                        </div>
                    </div>
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse" data-bs-parent="#courseModuleContainer">
                <div class="accordion-body p-0">
                    ${!isAccessible ? `
                        <div class="lock-notice text-center p-3 cursor-pointer" onclick="showUpgradeMarketingModal('${mod.required_level}')">
                            <span class="material-icons-round text-warning d-block mx-auto mb-1" style="font-size:24px;">lock</span>
                            ${mod.lock_notice || 'This module is locked. Click here to upgrade your access.'}
                        </div>
                    ` : ''}
                    <div class="accordion" id="lessonsContainer${mod.id}">
                        ${renderLessons(mod.lessons, mod.id, isAccessible, role)}
                    </div>
                </div>
            </div>
        </div>`;
    });

    container.innerHTML = html;
    applyAccordionState(settings.accordion_state);
}

function renderLessons(lessons, moduleId, isModAccessible, role) {
    if (!lessons || lessons.length === 0) return '<div class="p-3 text-center text-muted" style="font-size:11px;">No lessons found.</div>';
    
    let html = '';
    lessons.forEach(lesson => {
        const collapseId = `collapseLesson${lesson.id}`;
        let adminControls = '';
        if (role === 'admin' || role === 'manager') {
            adminControls = `
                <button class="admin-edit-btn ms-2" onclick="openEditLesson(event, ${lesson.id}, '${lesson.title.replace(/'/g, "\\'")}', '${lesson.description ? lesson.description.replace(/'/g, "\\'") : ''}', ${lesson.display_order})"><span class="material-icons-round" style="font-size:14px;">edit</span></button>
                <button class="admin-del-btn" onclick="deleteLesson(event, ${lesson.id})"><span class="material-icons-round" style="font-size:14px;">delete</span></button>
            `;
        }

        const isProcessing = lesson.hls_manifest_url === 'PROCESSING';
        
        html += `
        <div class="accordion-item lesson-accordion-item">
            <h2 class="accordion-header">
                <button class="accordion-button collapsed lesson-accordion-btn" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                    <div class="d-flex justify-content-between align-items-center w-100">
                        <span class="text-truncate" style="max-width: 80%;">${lesson.title}</span>
                        <div class="d-flex align-items-center">
                            ${lesson.hls_manifest_url && lesson.hls_manifest_url !== 'PROCESSING' ? '<span class="material-icons-round text-primary me-2" style="font-size:14px;">play_circle</span>' : ''}
                            ${adminControls}
                        </div>
                    </div>
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse" data-bs-parent="#lessonsContainer${moduleId}">
                <div class="accordion-body lesson-item-content">
                    ${isProcessing ? '<div class="alert alert-info py-2 px-3 mb-2" style="font-size:11px;"><span class="material-icons-round align-middle me-1" style="font-size:14px;">sync</span>Video is currently processing...</div>' : ''}
                    
                    ${lesson.thumbnail_url && !isProcessing && lesson.hls_manifest_url ? `
                        <div class="thumb-wrapper-full" onclick="${isModAccessible ? `playVideo('${lesson.hls_manifest_url}', '${lesson.id}')` : `showUpgradeMarketingModal('${lesson.required_level || 'locked'}')`}">
                            <img src="${lesson.thumbnail_url}" alt="Thumbnail">
                            <div class="thumb-play-overlay-full"><span class="material-icons-round">play_circle_outline</span></div>
                        </div>
                    ` : ''}

                    ${lesson.description ? `<div style="font-size:12px; color:#444; line-height:1.5;">${lesson.description}</div>` : ''}
                    
                    ${(!lesson.thumbnail_url && !isProcessing && lesson.hls_manifest_url) ? `
                        <button class="btn btn-sm btn-primary w-100 mt-2 fw-bold" onclick="${isModAccessible ? `playVideo('${lesson.hls_manifest_url}', '${lesson.id}')` : `showUpgradeMarketingModal('${lesson.required_level || 'locked'}')`}">Play Video</button>
                    ` : ''}
                </div>
            </div>
        </div>`;
    });
    return html;
}

function checkAccess(reqLevel, role, userAccess) {
    if (role === 'admin' || role === 'manager') return true;
    if (reqLevel === 'demo') return true;
    if (reqLevel === 'level_1_status') return true;
    if (reqLevel === 'level_2_status' && userAccess.level_2_status === 'Yes') return true;
    if (reqLevel === 'level_3_status' && userAccess.level_3_status === 'Yes') return true;
    if (reqLevel === 'level_4_status' && userAccess.level_4_status === 'Yes') return true;
    return false;
}

function applyAccordionState(state) {
    const modules = document.querySelectorAll('#courseModuleContainer > .accordion-item');
    if (modules.length === 0) return;
    
    if (state === 'first') {
        const firstModBtn = modules[0].querySelector('.accordion-button');
        const firstModCol = modules[0].querySelector('.accordion-collapse');
        if (firstModBtn && firstModCol) {
            firstModBtn.classList.remove('collapsed');
            firstModCol.classList.add('show');
            
            const firstLessonBtn = firstModCol.querySelector('.lesson-accordion-btn');
            const firstLessonCol = firstModCol.querySelector('.accordion-collapse');
            if (firstLessonBtn && firstLessonCol) {
                firstLessonBtn.classList.remove('collapsed');
                firstLessonCol.classList.add('show');
            }
        }
    } else if (state === 'all') {
        toggleAccordions('all');
    }
}

window.toggleAccordions = function(state) {
    const buttons = document.querySelectorAll('#courseModuleContainer .accordion-button');
    const collapses = document.querySelectorAll('#courseModuleContainer .accordion-collapse');
    
    if (state === 'all') {
        buttons.forEach(btn => btn.classList.remove('collapsed'));
        collapses.forEach(col => col.classList.add('show'));
    } else if (state === 'none') {
        buttons.forEach(btn => btn.classList.add('collapsed'));
        collapses.forEach(col => col.classList.remove('show'));
    } else if (state === 'first') {
        toggleAccordions('none');
        applyAccordionState('first');
    }
}

window.playVideo = function(url, lessonId) {
    const container = document.getElementById('videoPlayerContainer');
    const videoEl = document.getElementById('my-video');
    if (!container || !videoEl) return;

    container.style.display = 'block';
    
    if (!player) {
        player = videojs(videoEl, {
            controls: true,
            autoplay: true,
            preload: 'auto',
            fluid: true,
            playbackRates: [0.5, 1, 1.25, 1.5, 2]
        });
    }
    
    player.src({ src: url, type: 'application/x-mpegURL' });
    player.play();

    // Dynamic Tracking Watermark
    const watermark = document.getElementById('dynamicWatermark');
    if (watermark) {
        const email = localStorage.getItem('userEmail') || 'User';
        const phone = localStorage.getItem('userPhone') || '';
        watermark.innerHTML = `${email}<br>${phone}`;
        watermark.style.display = 'block';
        
        const moveWatermark = () => {
            const maxTop = window.innerHeight - 50;
            const maxLeft = window.innerWidth - 150;
            watermark.style.top = Math.max(10, Math.random() * maxTop) + 'px';
            watermark.style.left = Math.max(10, Math.random() * maxLeft) + 'px';
        };
        moveWatermark();
        window.watermarkInterval = setInterval(moveWatermark, 4000);
    }

    if (lessonId && window.recordVideoProgress) {
        player.on('timeupdate', () => {
            window.recordVideoProgress(lessonId, player.currentTime());
        });
    }
}

window.closeVideoPlayer = function() {
    const container = document.getElementById('videoPlayerContainer');
    if (container) container.style.display = 'none';
    if (player) {
        player.pause();
        player.src(''); 
    }
    if (window.watermarkInterval) clearInterval(window.watermarkInterval);
    const watermark = document.getElementById('dynamicWatermark');
    if (watermark) watermark.style.display = 'none';
}

window.showUpgradeMarketingModal = function(level) {
    let mktData = { display_name: 'Premium', benefits: 'Unlock exclusive content.', button_text: 'Upgrade Now', button_link: '#' };
    
    if (window.appSettings && window.appSettings.level_marketing_config) {
        try {
            const config = JSON.parse(window.appSettings.level_marketing_config);
            if (config[level]) mktData = config[level];
        } catch(e) {}
    }

    let todaySaleText = '';
    if (window.getTodaySalesLabel) {
        todaySaleText = window.getTodaySalesLabel(window.appSettings);
    }

    let modalEl = document.getElementById('marketingUpgradeModal');
    if (!modalEl) {
        const modalHtml = `
        <div class="modal fade" id="marketingUpgradeModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered" style="max-width: 320px;">
                <div class="modal-content text-center">
                    <div class="modal-header border-0 pb-0 justify-content-center">
                        <span class="material-icons-round text-warning" style="font-size: 48px;">workspace_premium</span>
                        <button type="button" class="btn-close position-absolute top-0 end-0 m-3" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body px-4 pb-4 pt-2">
                        <h5 class="fw-bold mb-1" id="mktModalTitle">Upgrade Access</h5>
                        <div id="mktModalSaleBadgeContainer"></div>
                        <p class="text-muted small mb-3" id="mktModalDesc">Get access to this locked content.</p>
                        <a href="#" target="_blank" class="btn btn-warning w-100 fw-bold shadow-sm text-dark" id="mktModalBtn">Upgrade Now</a>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modalEl = document.getElementById('marketingUpgradeModal');
    }

    document.getElementById('mktModalTitle').innerText = mktData.display_name;
    
    // Split Benefits and render with green checkmarks
    const benefitsHtml = mktData.benefits.split('\n').filter(b => b.trim() !== '').map(b => `<div class="mb-1 text-start" style="font-size: 13px;"><span class="material-icons-round text-success align-middle me-2" style="font-size:16px;">check_circle</span>${b}</div>`).join('');
    document.getElementById('mktModalDesc').innerHTML = benefitsHtml;
    
    const btn = document.getElementById('mktModalBtn');
    btn.innerText = mktData.button_text;
    btn.href = mktData.button_link || '#';

    // Inject automated Daily Sales Badge strictly
    const badgeContainer = document.getElementById('mktModalSaleBadgeContainer');
    if (badgeContainer) {
        if (todaySaleText.trim() !== '') {
            badgeContainer.innerHTML = `<div class="badge bg-danger text-white mb-3 p-2 px-3 w-100 shadow-sm" style="font-size: 13px; border-radius: 6px; animation: pulse 2s infinite;">🔥 ${todaySaleText}</div>`;
        } else {
            badgeContainer.innerHTML = '';
        }
    }

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

// Fetch content initially on load
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('courseModuleContainer')) {
        fetchCourses();
    }
});
