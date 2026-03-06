// public/js/home.js

let videoPlayer = null; 
let watermarkInterval = null; 
let progressInterval = null;
let tempSetupToken = null;
let tempResetEmail = null;
let deferredPrompt;

// --- Initialize Components & Event Listeners ---
document.getElementById('videoPlayerContainer')?.addEventListener('contextmenu', e => e.preventDefault());

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

// --- CALL WIDGET LOGIC ---
async function initCallWidget() {
    try {
        const settingsRes = await fetch('/api/settings');
        const settings = await settingsRes.json();
        
        if (settings.show_call_widget !== 'false') {
            const reportWrapper = document.getElementById('callReportWrapper');
            if(reportWrapper) reportWrapper.style.display = 'block';
            
            flatpickr("#call-date-range", {
                mode: "range",
                dateFormat: "d-m-Y",
                defaultDate: (function () {
                    const now = new Date();
                    const istOffset = 5.5 * 60 * 60 * 1000;
                    const todayIST = new Date(now.getTime() + istOffset);
                    const past10 = new Date(todayIST);
                    past10.setDate(todayIST.getDate() - 10);
                    return [past10, todayIST];
                })(),
                onReady: function (selectedDates) {
                    if (selectedDates.length > 0) {
                        const istOffset = 5.5 * 60 * 60 * 1000;
                        const start = new Date(selectedDates[0].getTime() + istOffset).toISOString().split('T')[0];
                        const end = new Date((selectedDates[1] || selectedDates[0]).getTime() + istOffset).toISOString().split('T')[0];
                        loadCallData(start, end);
                    }
                },
                onClose: function (selectedDates) {
                    if (selectedDates.length > 0) {
                        const istOffset = 5.5 * 60 * 60 * 1000;
                        const start = new Date(selectedDates[0].getTime() + istOffset).toISOString().split('T')[0];
                        const end = new Date((selectedDates[1] || selectedDates[0]).getTime() + istOffset).toISOString().split('T')[0];
                        loadCallData(start, end);
                    }
                }
            });
        }
    } catch(e) {}
}

function formatINR(value) { return '₹ ' + Number(value).toLocaleString('en-IN'); }
function groupByDate(data) {
    const grouped = {};
    data.forEach(item => {
        const date = item.form_date;
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(item);
    });
    return grouped;
}

function loadCallData(start, end) {
    document.getElementById('call-loader').style.display = 'block';
    document.getElementById('call-summary').innerHTML = '';
    document.getElementById('call-report-output').innerHTML = '';

    fetch(`/api/public/call-report?start=${start}&end=${end}`)
        .then(res => res.json())
        .then(json => {
            document.getElementById('call-loader').style.display = 'none';
            if (!json.success || !json.show_widget) return;

            const data = json.data;
            const grouped = groupByDate(data);
            let totalCalls = 0, totalProfit = 0, profitableTrades = 0;

            Object.values(grouped).forEach(dayItems => {
                dayItems.forEach(item => {
                    const raw = parseFloat(item.profit_loss);
                    if (!isNaN(raw)) {
                        const scaled = raw * 6;
                        if (scaled > 0) profitableTrades++;
                        if (scaled !== 0) totalCalls++;
                        if (scaled > 0) totalProfit += scaled;
                    }
                });
            });

            const accuracy = totalCalls > 0 ? Math.round((profitableTrades / totalCalls) * 100) : 0;
            document.getElementById('call-summary').innerHTML = `
                <div class="call-summary-cards">
                    <div class="call-summary-card"><h3>Accuracy</h3><div>${accuracy}%</div></div>
                    <div class="call-summary-card"><h3>Signals</h3><div>${totalCalls}</div></div>
                    <div class="call-summary-card"><h3>Profit</h3><div style="color:var(--green);">${formatINR(totalProfit)}</div></div>
                </div>
            `;

            let html = '';
            Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a)).forEach(date => {
                const items = grouped[date];
                let calls = 0, profit = 0, good = 0;
                const hasZTH = items.some(i => i.final_status && i.final_status.toLowerCase().trim() === 'zero to hero');
                const badge = hasZTH ? '<span class="zth-badge">🔥ZeroToHero</span>' : '';
                
                items.forEach(i => {
                    const raw = parseFloat(i.profit_loss);
                    const val = isNaN(raw) ? 0 : raw * 6;
                    if (val > 0) profit += val;
                    if (val !== 0) calls++;
                    if (val > 0) good++;
                });
                const acc = calls ? Math.round((good / calls) * 100) : 0;
                const prettyDate = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                
                let profitColor = profit > 0 ? 'var(--green)' : 'var(--red)';
                if (profit === 0) profitColor = 'var(--text-secondary)';

                html += `
                    <div class="daily-toggle">
                        <div>${prettyDate} | Accuracy: ${acc}% ${badge}</div>
                        <div style="color:${profitColor}">${formatINR(profit)}</div>
                    </div>
                    <div class="daily-details">
                        <div class="day-header-cards">
                            <div class="card">Accuracy<span>${acc}%</span></div>
                            <div class="card">Signals<span>${calls}</span></div>
                            <div class="card">Profit<span style="color:${profitColor}">${formatINR(profit)}</span></div>
                        </div>
                        <table class="call-table">
                            <tr><th>Stock/Index Option</th><th>Profit(₹)/Status</th></tr>
                            ${items.map(i => {
                                const p = parseFloat(i.profit_loss) * 6;
                                let status = 'Not-Active';
                                let statusColor = '#878a8d';
                                if (p > 0) { status = formatINR(p); statusColor = 'var(--green)'; }
                                else if (p < 0) { status = 'SL'; statusColor = 'var(--red)'; }
                                
                                const isZTH = i.final_status && i.final_status.toLowerCase().trim() === 'zero to hero';
                                const zthBadge = isZTH ? '<span class="zth-badge">🔥ZTH</span>' : '';
                                const title = `${i.select_stock_option} ${i.strike_price} ${i.trade_type}${zthBadge}`;
                                
                                return `<tr><td>${title}</td><td style="color:${statusColor}">${status}</td></tr>`;
                            }).join('')}
                        </table>
                    </div>
                `;
            });
            document.getElementById('call-report-output').innerHTML = html;
            
            document.querySelectorAll('.daily-toggle').forEach(toggle => {
                toggle.addEventListener('click', () => {
                    const next = toggle.nextElementSibling;
                    const isOpen = next.style.display === 'block';
                    document.querySelectorAll('.daily-details').forEach(d => d.style.display = 'none');
                    if (!isOpen) next.style.display = 'block';
                });
            });
        }).catch(err => { document.getElementById('call-loader').style.display = 'none'; });
}

// --- GALLERY LOGIC ---
async function loadGallery() {
    try {
        const res = await fetch('/api/public/gallery');
        const data = await res.json();
        if (data.success && data.show_gallery && data.images && data.images.length > 0) {
            const container = document.getElementById('galleryContainer');
            if(!container) return;
            let html = '';
            data.images.forEach((img, index) => {
                const activeClass = index === 0 ? 'active' : '';
                let formattedDate = img.trade_date || '';
                if (formattedDate) {
                    try {
                        const d = new Date(img.trade_date);
                        if(!isNaN(d)) formattedDate = d.toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'});
                    } catch(e) {}
                }
                html += `<div class="carousel-item ${activeClass}">
                            <div class="position-relative w-100 h-100">
                                <img src="${img.image_url}" class="d-block w-100" alt="Performance Gallery" draggable="false">
                                <div class="gallery-overlay">
                                    <div class="gallery-date">${formattedDate}</div>
                                    <div class="gallery-brand">RDALGO.IN</div>
                                </div>
                            </div>
                         </div>`;
            });
            container.innerHTML = html;
            document.getElementById('galleryWrapper').style.display = 'block';
        }
    } catch (err) { console.error("Gallery failed to load."); }
}

// --- AUTH MODAL LOGIC ---
function switchAuthView(viewId) {
    ['viewLogin', 'viewSetup', 'viewForgot', 'viewReset'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('d-none');
    });
    const target = document.getElementById(viewId);
    if(target) target.classList.remove('d-none');
}

window.switchAuthView = switchAuthView; // Expose globally for HTML onclicks

window.togglePassword = function(inputId, iconEl) {
    const input = document.getElementById(inputId);
    if (input.type === "password") { input.type = "text"; iconEl.innerText = "visibility"; } 
    else { input.type = "password"; iconEl.innerText = "visibility_off"; }
};

window.openLoginModal = function() {
    switchAuthView('viewLogin');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show();
};

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('loginRemember').checked;
    const errorMsg = document.getElementById('loginErrorMsg');
    const btn = document.getElementById('loginBtn');

    btn.disabled = true; errorMsg.style.display = 'none';

    try {
        const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, rememberMe }) });
        const data = await res.json();
        
        if (data.requires_setup) {
            tempSetupToken = data.setupToken;
            document.getElementById('loginPassword').value = '';
            switchAuthView('viewSetup');
        } else if (data.success) {
            localStorage.setItem('userRole', data.role);
            localStorage.setItem('userEmail', data.email);
            localStorage.setItem('userPhone', data.phone);
            localStorage.setItem('accessLevels', JSON.stringify(data.accessLevels));
            localStorage.setItem('sessionId', data.sessionId);
            window.location.href = '/'; 
        } else {
            errorMsg.innerText = data.msg;
            errorMsg.style.display = 'block';
        }
    } catch (err) { errorMsg.innerText = "Server connection error."; errorMsg.style.display = 'block'; }
    btn.disabled = false;
});

// Setup, Forgot, and Reset Handlers (identical to V1)
document.getElementById('setupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPass = document.getElementById('setupNewPass').value;
    const confPass = document.getElementById('setupConfPass').value;
    const errorMsg = document.getElementById('setupErrorMsg');
    const btn = document.getElementById('setupBtn');

    if (newPass !== confPass) { errorMsg.innerText = "Passwords do not match."; errorMsg.style.display = 'block'; return; }
    btn.disabled = true; btn.innerText = "Saving..."; errorMsg.style.display = 'none';

    try {
        const res = await fetch('/api/set_password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupToken: tempSetupToken, newPassword: newPass }) });
        const data = await res.json();
        if (data.success) {
            alert("Password set successfully! Please log in.");
            document.getElementById('loginPassword').value = '';
            switchAuthView('viewLogin');
        } else {
            errorMsg.innerText = data.msg; errorMsg.style.display = 'block';
        }
    } catch (err) { errorMsg.innerText = "Server error."; errorMsg.style.display = 'block'; }
    btn.disabled = false; btn.innerText = "Save & Continue";
});

document.getElementById('forgotForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    tempResetEmail = document.getElementById('forgotEmail').value;
    const errorMsg = document.getElementById('forgotErrorMsg');
    const btn = document.getElementById('forgotBtn');

    btn.disabled = true; btn.innerText = "Sending..."; errorMsg.style.display = 'none';
    try {
        const res = await fetch('/api/forgot_password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: tempResetEmail }) });
        const data = await res.json();
        if (data.success) { switchAuthView('viewReset'); } 
        else { errorMsg.innerText = data.msg; errorMsg.style.display = 'block'; }
    } catch (err) { errorMsg.innerText = "Server error."; errorMsg.style.display = 'block'; }
    btn.disabled = false; btn.innerText = "Send OTP";
});

document.getElementById('resetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = document.getElementById('resetOtp').value;
    const newPass = document.getElementById('resetNewPass').value;
    const errorMsg = document.getElementById('resetErrorMsg');
    const btn = document.getElementById('resetBtn');

    btn.disabled = true; btn.innerText = "Verifying..."; errorMsg.style.display = 'none';
    try {
        const res = await fetch('/api/reset_password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: tempResetEmail, otp: otp, newPassword: newPass }) });
        const data = await res.json();
        if (data.success) {
            alert(data.msg);
            document.getElementById('loginPassword').value = '';
            switchAuthView('viewLogin');
        } else {
            errorMsg.innerText = data.msg; errorMsg.style.display = 'block';
        }
    } catch (err) { errorMsg.innerText = "Server error."; errorMsg.style.display = 'block'; }
    btn.disabled = false; btn.innerText = "Confirm & Reset";
});

// --- COURSES & VIDEO PLAYER LOGIC ---
window.toggleAccordions = function(action) {
    const allCollapses = document.querySelectorAll('.accordion-collapse');
    const allButtons = document.querySelectorAll('.accordion-button');
    if (action === 'all') { allCollapses.forEach(el => el.classList.add('show')); allButtons.forEach(el => { el.classList.remove('collapsed'); el.setAttribute('aria-expanded', 'true'); }); } 
    else if (action === 'none') { allCollapses.forEach(el => el.classList.remove('show')); allButtons.forEach(el => { el.classList.add('collapsed'); el.setAttribute('aria-expanded', 'false'); }); } 
    else if (action === 'first') {
        allCollapses.forEach(el => el.classList.remove('show')); allButtons.forEach(el => { el.classList.add('collapsed'); el.setAttribute('aria-expanded', 'false'); });
        const firstModCollapse = document.querySelector('.course-module > .accordion-collapse');
        const firstModBtn = document.querySelector('.course-module > .accordion-header > .accordion-button');
        if (firstModCollapse && firstModBtn) {
            firstModCollapse.classList.add('show'); firstModBtn.classList.remove('collapsed'); firstModBtn.setAttribute('aria-expanded', 'true');
            const firstLessonCollapse = firstModCollapse.querySelector('.lesson-collapse'); const firstLessonBtn = firstModCollapse.querySelector('.lesson-accordion-btn');
            if (firstLessonCollapse && firstLessonBtn) { firstLessonCollapse.classList.add('show'); firstLessonBtn.classList.remove('collapsed'); firstLessonBtn.setAttribute('aria-expanded', 'true'); }
        }
    }
};

async function fetchPublicCourses() {
    try {
        const response = await fetch('/api/public/courses');
        const modules = await response.json();
        
        let demoHtml = ''; let otherHtml = '';
        let demoCount = 0; let otherCount = 0;

        modules.forEach((mod) => {
            if (mod.show_on_home === false) return; 

            const isDemo = mod.required_level === 'demo';
            let displayNoticeHtml = '';
            if (!isDemo) {
                let displayNotice = mod.lock_notice ? mod.lock_notice : `⚠️ Locked. Login or register to unlock.`;
                displayNoticeHtml = `<div class="lock-notice">${displayNotice}</div>`;
            }

            let lessonHtml = '';
            if (mod.lessons && mod.lessons.length > 0) {
                lessonHtml += `<div class="accordion w-100" id="accLsn${mod.id}">`;
                mod.lessons.forEach(l => {
                    const hasVideo = l.hls_manifest_url && l.hls_manifest_url.length > 5;
                    const isLocked = !isDemo;

                    const overlayIcon = isLocked ? 'lock' : 'play_circle_filled'; 
                    const documentIcon = isLocked ? 'lock' : 'article';
                    const iconColor = isLocked ? '#999' : 'var(--blue)';
                    const textColor = isLocked ? '#666' : '#333';
                    const opacityLvl = isLocked ? '0.6' : '1';
                    
                    let mediaHtml = '';
                    let onClickAction = '';
                    let pointerEv = isLocked ? 'not-allowed' : 'auto';

                    if (hasVideo) {
                        onClickAction = isLocked ? `onclick="openLoginModal()"` : `onclick="openDemoVideo(${l.id})"`;
                        pointerEv = isLocked ? 'not-allowed' : 'pointer';
                        
                        const thumbIconColor = isLocked ? '#ccc' : '#fff';
                        const thumbnailImg = l.thumbnail_url 
                            ? `<div class="thumb-wrapper-full"><img src="${l.thumbnail_url}" loading="lazy"><div class="thumb-play-overlay-full"><span class="material-icons-round" style="color: ${thumbIconColor};">${overlayIcon}</span></div></div>` 
                            : `<div class="thumb-wrapper-full"><div class="w-100 h-100 bg-dark d-flex align-items-center justify-content-center" style="min-height: 250px;"><span class="material-icons-round" style="font-size:48px; color:#444;">${overlayIcon}</span></div><div class="thumb-play-overlay-full"><span class="material-icons-round" style="color: ${thumbIconColor};">${overlayIcon}</span></div></div>`;
                            
                        mediaHtml = `<div class="w-100" style="cursor: ${pointerEv};" ${onClickAction}>${thumbnailImg}</div>`;
                    }

                    const finalHeaderIcon = hasVideo ? overlayIcon : documentIcon;

                    lessonHtml += `
                        <div class="accordion-item lesson-accordion-item">
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
                                        <div class="d-flex justify-content-between align-items-start">
                                            <div class="flex-grow-1" style="overflow-wrap: break-word;">
                                                ${l.description ? `<div class="text-dark mt-2" style="font-size: 13px; line-height: 1.6; padding: 0 5px; white-space: pre-wrap;">${l.description}</div>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
                });
                lessonHtml += `</div>`;
            } else { lessonHtml = '<div class="text-muted p-3 text-center" style="font-size:12px;">No videos yet.</div>'; }
            
            const modHtml = `
                <div class="accordion-item course-module">
                    <h2 class="accordion-header" id="heading${mod.id}">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${mod.id}" aria-expanded="false" aria-controls="collapse${mod.id}">
                            <div class="d-flex align-items-center flex-grow-1"><span class="mb-0 fw-bold" style="font-size:14px;">${mod.title}</span></div>
                        </button>
                    </h2>
                    ${displayNoticeHtml}
                    <div id="collapse${mod.id}" class="accordion-collapse collapse" aria-labelledby="heading${mod.id}"><div class="accordion-body p-0">${lessonHtml}</div></div>
                </div>`;

            if (isDemo) { demoHtml += modHtml; demoCount++; } else { otherHtml += modHtml; otherCount++; }
        });

        if (demoCount > 0) { document.getElementById('publicCourseContainer_demo').innerHTML = demoHtml; document.getElementById('demoCoursesContainer').style.display = 'block'; }
        if (otherCount > 0) { document.getElementById('publicCourseContainer_other').innerHTML = otherHtml; document.getElementById('otherCoursesContainer').style.display = 'block'; }
        
        try {
            const settingsRes = await fetch('/api/settings'); const settings = await settingsRes.json();
            
            if (settings.homepage_layout) {
                try {
                    const layoutOrder = JSON.parse(settings.homepage_layout);
                    const appWrapper = document.querySelector('.app-wrapper');
                    const footer = document.querySelector('.footer');
                    layoutOrder.forEach(id => {
                        const compContainer = document.querySelector(`[data-id="${id}"]`) || document.getElementById(id);
                        // Due to component structure, the element might be wrapped, finding it specifically
                        let elToMove = document.getElementById(id);
                        if (elToMove && elToMove.parentElement && elToMove.parentElement.id.startsWith('comp-')) {
                            elToMove = elToMove.parentElement; // Move the whole component wrapper
                        }

                        if(elToMove && appWrapper && footer) {
                            appWrapper.insertBefore(elToMove, footer);
                        }
                    });
                } catch(e) {}
            }
            
            // --- STICKY BUTTON RENDERING ---
            if (settings.show_sticky_footer !== 'false') {
                const wrapper = document.getElementById('stickyFooterWrapper');
                if (wrapper) {
                    wrapper.innerHTML = `
                        <a href="${settings.sticky_btn1_link || '#'}" target="_blank" class="sticky-btn btn-green">
                            <span class="material-icons-round">${settings.sticky_btn1_icon || 'chat'}</span> 
                            ${settings.sticky_btn1_text || 'WhatsApp Us'}
                        </a>
                        <a href="${settings.sticky_btn2_link || '#'}" target="_blank" class="sticky-btn btn-blue">
                            <span class="material-icons-round">${settings.sticky_btn2_icon || 'send'}</span> 
                            ${settings.sticky_btn2_text || 'Join Telegram'}
                        </a>
                    `;
                    wrapper.style.display = 'flex';
                }
            }

            setTimeout(() => { toggleAccordions(settings.accordion_state || 'first'); }, 100);
        } catch (e) { setTimeout(() => { toggleAccordions('first'); }, 100); }
    } catch (err) { }
}

window.openDemoVideo = async function(lessonId) {
    if (!videoPlayer) {
        videoPlayer = videojs('my-video', { hls: { overrideNative: true }, html5: { vhs: { overrideNative: true } }, controlBar: { fullscreenToggle: false, pictureInPictureToggle: false }});
        videoPlayer.el().addEventListener('contextmenu', function(e) { e.preventDefault(); });
        videoPlayer.on('loadedmetadata', async function() {
            const vw = videoPlayer.videoWidth();
            const vh = videoPlayer.videoHeight();
            if (screen.orientation && screen.orientation.lock) {
                try { if (vw > vh) { await screen.orientation.lock("landscape"); } else { await screen.orientation.lock("portrait"); } } catch (e) {}
            } else {
                if (vw > vh && window.innerHeight > window.innerWidth) { alert("For the best experience, please rotate your device horizontally."); }
            }
        });
    }
    videoPlayer.reset(); stopWatermark();
    try {
        const response = await fetch(`/api/public/lesson/${lessonId}`);
        if (!response.ok) { alert("❌ Failed to load demo."); return; }
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
};

window.closeVideoPlayer = function() {
    if (progressInterval) clearInterval(progressInterval);
    if (videoPlayer) { videoPlayer.pause(); videoPlayer.reset(); }
    if (screen.orientation && screen.orientation.unlock) { try { screen.orientation.unlock(); } catch (e) {} }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) { document.exitFullscreen().catch(e => {}); } else if (document.webkitExitFullscreen) { document.webkitExitFullscreen().catch(e => {}); }
    }
    stopWatermark(); document.getElementById('videoPlayerContainer').style.display = 'none';
};

function startWatermark() {
    const wmEl = document.getElementById('dynamicWatermark');
    wmEl.innerHTML = `Rdalgo.in`;
    wmEl.style.display = 'block';
    if (watermarkInterval) clearInterval(watermarkInterval); 
    moveWatermark(); 
    watermarkInterval = setInterval(moveWatermark, 3000); 
}

function stopWatermark() { if (watermarkInterval) clearInterval(watermarkInterval); watermarkInterval = null; document.getElementById('dynamicWatermark').style.display = 'none'; }

function moveWatermark() {
    const wmEl = document.getElementById('dynamicWatermark'); const container = document.getElementById('videoPlayerContainer');
    if (!videoPlayer) return;
    const vw = videoPlayer.videoWidth(); const vh = videoPlayer.videoHeight();
    if (!vw || !vh) { wmEl.style.left = '50%'; wmEl.style.top = '50%'; wmEl.style.transform = 'translate(-50%, -50%)'; return; } else { wmEl.style.transform = 'none'; }
    const cw = container.clientWidth; const ch = container.clientHeight; const videoRatio = vw / vh; const containerRatio = cw / ch;
    let renderedWidth, renderedHeight, offsetX, offsetY;
    if (videoRatio > containerRatio) { renderedWidth = cw; renderedHeight = cw / videoRatio; offsetX = 0; offsetY = (ch - renderedHeight) / 2; } 
    else { renderedHeight = ch; renderedWidth = ch * videoRatio; offsetX = (cw - renderedWidth) / 2; offsetY = 0; }
    const minX = offsetX + 10; const maxX = Math.max(minX, offsetX + renderedWidth - wmEl.clientWidth - 10);
    const minY = offsetY + 50; const maxY = Math.max(minY, offsetY + renderedHeight - wmEl.clientHeight - 20);
    wmEl.style.left = Math.floor(Math.random() * (maxX - minX + 1)) + minX + 'px'; wmEl.style.top = Math.floor(Math.random() * (maxY - minY + 1)) + minY + 'px';
}

async function fetchSystemSettings() {
    try {
        const settingsRes = await fetch('/api/settings');
        const settings = await settingsRes.json();
        const regBtn = document.getElementById('registerLinkBtn');
        if (regBtn && settings.register_link) {
            regBtn.href = settings.register_link;
        }
    } catch(e) {}
}

// --- PWA INSTALL LOGIC ---
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('installAppBtn');
    if (installBtn) installBtn.style.display = 'inline-block';
});

window.installPWA = function() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
        deferredPrompt = null;
        const installBtn = document.getElementById('installAppBtn');
        if(installBtn) installBtn.style.display = 'none';
    });
};

window.addEventListener('appinstalled', (evt) => {
    const installBtn = document.getElementById('installAppBtn');
    if (installBtn) installBtn.style.display = 'none';
});


// --- SMART PUSH LOGIC FOR PUBLIC USERS ---
function checkAndPromptPushSubscription() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    const hasBeenPrompted = sessionStorage.getItem('publicPushPromptDismissed');

    if (Notification.permission === 'granted') {
        registerPublicServiceWorker(); 
    } 
    else if (Notification.permission === 'denied') {
        if (!hasBeenPrompted) {
            document.getElementById('pushModalTitle').innerText = 'Notifications Blocked';
            document.getElementById('pushModalDesc').innerText = 'You are missing out on free trade alerts.';
            document.getElementById('pushBlockedInstructions').style.display = 'block';
            document.getElementById('btnEnablePush').style.display = 'none';
            
            const modal = new bootstrap.Modal(document.getElementById('pushReminderModal'));
            modal.show();
        }
    } 
    else {
        if (!hasBeenPrompted) {
            document.getElementById('pushModalTitle').innerText = 'Get Free Trade Alerts!';
            document.getElementById('pushModalDesc').innerText = 'Enable notifications to get instant updates on market signals and profit bookings.';
            document.getElementById('pushBlockedInstructions').style.display = 'none';
            document.getElementById('btnEnablePush').style.display = 'block';
            
            const modal = new bootstrap.Modal(document.getElementById('pushReminderModal'));
            modal.show();
        }
    }
}

window.handlePushEnableClick = function() {
    const btn = document.getElementById('btnEnablePush');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Allowing...';
    btn.disabled = true;

    Notification.requestPermission().then(permission => {
        const modalEl = document.getElementById('pushReminderModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        if (permission === 'granted') {
            registerPublicServiceWorker();
        } else {
            sessionStorage.setItem('publicPushPromptDismissed', 'true');
        }
    });
};

window.dismissPushPrompt = function() {
    sessionStorage.setItem('publicPushPromptDismissed', 'true');
};

async function registerPublicServiceWorker() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const keyRes = await fetch('/api/push/public_key');
            const keyData = await keyRes.json();
            if (!keyData.success) return;

            const registration = await navigator.serviceWorker.register('/sw.js');
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: keyData.publicKey
            });
            
            await fetch('/api/push/subscribe', {
                method: 'POST',
                body: JSON.stringify(subscription),
                headers: { 'content-type': 'application/json' }
            });
        } catch (error) { console.log('Public Push Registration failed'); }
    }
}

// Ensure execution starts AFTER components are loaded into the DOM
document.addEventListener('DOMContentLoaded', () => {
    // Initializers
    initCallWidget();
    loadGallery();
    fetchPublicCourses();
    fetchSystemSettings(); 
    
    // Trigger push prompt after 3s
    setTimeout(checkAndPromptPushSubscription, 3000);
});
