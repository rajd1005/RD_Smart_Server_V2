// --- API ENDPOINTS ---
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
    applyRoleRestrictions(); 
};

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

// ==========================================
// --- LMS COURSE LOGIC ---
// ==========================================

async function fetchCourses() {
    const container = document.getElementById('courseModuleContainer');
    if (!container) return;
    container.innerHTML = '<div class="p-4 text-center text-muted">Loading courses...</div>';
    
    try {
        const response = await fetch(API_URL_COURSES, { credentials: 'same-origin' });
        if (response.status === 401 || response.status === 403) { window.location.href = '/login.html'; return; }
        
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

        globalModules.forEach(mod => {
            const isLocked = userData.role !== 'admin' && accessLevels[mod.required_level] !== 'Yes';
            const levelBadge = isLocked ? '<span class="module-level-badge badge-locked">LOCKED</span>' : '<span class="module-level-badge badge-unlocked">UNLOCKED</span>';
            
            // Clean Strings to safely pass into edit functions
            const safeTitle = (mod.title || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const safeDesc = (mod.description || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            
            const adminBtnsMod = userData.role === 'admin' ? `
                <div class="d-flex align-items-center ms-2">
                    <button class="admin-edit-btn" onclick="openEditModule(${mod.id}, '${safeTitle}', '${safeDesc}', '${mod.required_level}')"><span class="material-icons-round" style="font-size: 18px;">edit</span></button>
                    <button class="admin-del-btn" onclick="deleteModule(${mod.id})"><span class="material-icons-round" style="font-size: 18px;">delete</span></button>
                </div>` : '';

            let lessonHtml = '';
            if (isLocked) {
                lessonHtml = `<div class="lock-notice">⚠️ Your WP Level Status restricts access. Contact Admin.</div>`;
            } else if (mod.lessons && mod.lessons.length > 0) {
                mod.lessons.forEach(l => {
                    const safeLT = (l.title || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const safeLD = (l.description || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const adminBtnsLess = userData.role === 'admin' ? `
                        <div class="d-flex align-items-center ms-2">
                            <button class="admin-edit-btn" onclick="openEditLesson(event, ${l.id}, '${safeLT}', '${safeLD}')"><span class="material-icons-round" style="font-size: 18px;">edit</span></button>
                            <button class="admin-del-btn" onclick="deleteLesson(event, ${l.id})"><span class="material-icons-round" style="font-size: 18px;">delete</span></button>
                        </div>` : '';

                    lessonHtml += `
                        <div class="lesson-item" onclick="openSecureVideo(${l.id})">
                            <div class="d-flex align-items-center w-100">
                                <span class="material-icons-round lesson-icon">play_circle_filled</span>
                                <div class="flex-grow-1">
                                    <div class="fw-bold">${l.title}</div>
                                    ${l.description ? `<div class="text-muted small">${l.description}</div>` : ''}
                                </div>
                                ${adminBtnsLess}
                            </div>
                        </div>`;
                });
            } else {
                lessonHtml = '<div class="text-muted small p-2">No videos yet.</div>';
            }

            htmlContent += `
                <div class="course-module ${isLocked ? 'module-locked' : ''}">
                    <div class="module-header">
                        <div class="d-flex align-items-center"><h6 class="module-title mb-0">${mod.title}</h6>${adminBtnsMod}</div>
                        ${levelBadge}
                    </div>
                    <div>${lessonHtml}</div>
                </div>`;
        });
        container.innerHTML = htmlContent || '<div class="p-4 text-center text-muted">No courses found.</div>';
    } catch (err) { 
        console.error(err);
        container.innerHTML = `<div class="p-3 text-danger text-center">❌ Error loading courses.</div>`; 
    }
}

// ==========================================
// --- SECURE VIDEO PLAYER & WATERMARK LOGIC ---
// ==========================================

document.getElementById('videoPlayerContainer').addEventListener('contextmenu', function(e) {
    e.preventDefault();
});

async function openSecureVideo(lessonId) {
    if (!videoPlayer) {
        videoPlayer = videojs('my-video', { 
            hls: { overrideNative: true }, 
            html5: { vhs: { overrideNative: true } },
            controlBar: {
                fullscreenToggle: false, 
                pictureInPictureToggle: false 
            }
        });
        videoPlayer.el().addEventListener('contextmenu', function(e) { e.preventDefault(); });
    }
    
    videoPlayer.reset(); 
    stopWatermark();
    
    try {
        const response = await fetch(`${API_URL_LESSON}${lessonId}`, { credentials: 'same-origin' });
        if (response.status === 403) { alert("❌ ACCESS DENIED."); return; }
        const data = await response.json();
        
        videoPlayer.src({ src: data.hlsUrl, type: 'application/x-mpegURL' });
        
        const playerContainer = document.getElementById('videoPlayerContainer');
        playerContainer.style.display = 'block';
        
        // 1. FIRST: Request Native Fullscreen (Required by browsers to allow rotation)
        if (playerContainer.requestFullscreen) {
            await playerContainer.requestFullscreen().catch(e => console.warn(e));
        } else if (playerContainer.webkitRequestFullscreen) { /* Safari */
            await playerContainer.webkitRequestFullscreen().catch(e => console.warn(e));
        }

        // 2. THEN: Force Auto-Rotate to Landscape
        if (screen.orientation && screen.orientation.lock) {
            try { 
                await screen.orientation.lock("landscape"); 
            } catch (e) { 
                console.warn("Auto-rotate blocked by browser. User may need to tilt phone manually."); 
            }
        }

        startWatermark();
        videoPlayer.play();
        
    } catch(err) { alert("🚨 Error loading video stream."); }
}

function closeVideoPlayer() {
    if (videoPlayer) { videoPlayer.pause(); videoPlayer.reset(); }
    
    // 1. Unlock Mobile Rotation
    if (screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch (e) {}
    }
    
    // 2. Exit Native Fullscreen
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(e => console.warn(e));
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen().catch(e => console.warn(e));
        }
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
    document.getElementById('dynamicWatermark').style.display = 'none';
}

function moveWatermark() {
    const wmEl = document.getElementById('dynamicWatermark');
    const container = document.getElementById('videoPlayerContainer');
    const maxX = Math.max(0, container.clientWidth - wmEl.clientWidth - 20);
    const maxY = Math.max(0, container.clientHeight - wmEl.clientHeight - 80);
    wmEl.style.left = Math.floor(Math.random() * maxX) + 'px';
    wmEl.style.top = (Math.floor(Math.random() * maxY) + 50) + 'px';
}

// ==========================================
// --- ADMIN COURSE MANAGEMENT FORMS ---
// ==========================================

const formAddModule = document.getElementById('formAddModule');
if (formAddModule) {
    formAddModule.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            title: document.getElementById('modTitle').value, description: document.getElementById('modDesc').value, required_level: document.getElementById('modLevel').value
        };
        try {
            const res = await fetch('/api/admin/modules', { method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify(data) });
            if(res.ok) { alert("Module Added!"); formAddModule.reset(); fetchCourses(); } else alert("Error adding module");
        } catch(e) { console.error(e); }
    });
}

const formAddLesson = document.getElementById('formAddLesson');
if (formAddLesson) {
    formAddLesson.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.append('module_id', document.getElementById('lessonModuleId').value);
        formData.append('title', document.getElementById('lessonTitle').value);
        formData.append('description', document.getElementById('lessonDesc').value);
        formData.append('video_file', document.getElementById('lessonVideoFile').files[0]);

        const btn = e.target.querySelector('button'); btn.innerText = "⏳ Uploading & Encrypting..."; btn.disabled = true;
        try {
            const res = await fetch('/api/admin/lessons', { method: 'POST', credentials: 'same-origin', body: formData });
            const data = await res.json();
            if(res.ok) { alert(data.msg); formAddLesson.reset(); } else { alert(data.msg || "Error uploading video."); }
        } catch(err) { alert("Server connection failed."); } 
        finally { btn.innerText = "Upload Video File"; btn.disabled = false; }
    });
}

async function deleteModule(id) {
    if(!confirm("⚠️ Delete this entire module AND all its videos?")) return;
    try {
        const res = await fetch(`/api/admin/modules/${id}`, { method: 'DELETE', credentials: 'same-origin' });
        if(res.ok) fetchCourses();
    } catch(e) { console.error(e); }
}

async function deleteLesson(e, id) {
    e.stopPropagation(); 
    if(!confirm("⚠️ Delete this video?")) return;
    try {
        const res = await fetch(`/api/admin/lessons/${id}`, { method: 'DELETE', credentials: 'same-origin' });
        if(res.ok) fetchCourses();
    } catch(e) { console.error(e); }
}

// --- NEW: EDIT LOGIC ---
function openEditModule(id, title, desc, level) {
    document.getElementById('editModId').value = id;
    document.getElementById('editModTitle').value = title;
    document.getElementById('editModDesc').value = (desc !== 'null' && desc !== 'undefined') ? desc : '';
    document.getElementById('editModLevel').value = level;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editModuleModal')).show();
}

function openEditLesson(e, id, title, desc) {
    e.stopPropagation();
    document.getElementById('editLessonId').value = id;
    document.getElementById('editLessonTitle').value = title;
    document.getElementById('editLessonDesc').value = (desc !== 'null' && desc !== 'undefined') ? desc : '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editLessonModal')).show();
}

const formEditModule = document.getElementById('formEditModule');
if (formEditModule) {
    formEditModule.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editModId').value;
        const data = {
            title: document.getElementById('editModTitle').value,
            description: document.getElementById('editModDesc').value,
            required_level: document.getElementById('editModLevel').value
        };
        try {
            const res = await fetch(`/api/admin/modules/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify(data) });
            if(res.ok) { bootstrap.Modal.getInstance(document.getElementById('editModuleModal')).hide(); fetchCourses(); } 
            else { alert("Error updating module"); }
        } catch(err) { console.error(err); }
    });
}

const formEditLesson = document.getElementById('formEditLesson');
if (formEditLesson) {
    formEditLesson.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editLessonId').value;
        const data = { title: document.getElementById('editLessonTitle').value, description: document.getElementById('editLessonDesc').value };
        try {
            const res = await fetch(`/api/admin/lessons/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify(data) });
            if(res.ok) { bootstrap.Modal.getInstance(document.getElementById('editLessonModal')).hide(); fetchCourses(); } 
            else { alert("Error updating lesson"); }
        } catch(err) { console.error(err); }
    });
}

// ==========================================
// --- ORIGINAL TRADE LOGIC (100% RESTORED) ---
// ==========================================

function applyRoleRestrictions() {
    const role = localStorage.getItem('userRole');
    if (role === 'admin') {
        document.getElementById('btnSelect').style.display = 'flex';
        document.getElementById('btnDelete').style.display = 'flex';
        const btnAdminCourseManager = document.getElementById('btnAdminCourseManager');
        if (btnAdminCourseManager) btnAdminCourseManager.style.display = 'inline-block';
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
        if (response.status === 401 || response.status === 403) { window.location.href = '/login.html'; return; }
        allTrades = await response.json();
        populateSymbolFilter(allTrades);
        applyFilters(checkedIds); 
    } catch (error) { 
        console.error(error); 
        const container = document.getElementById('tradeListContainer');
        if (container) container.innerHTML = `<div class="p-3 text-danger text-center fw-bold">❌ Connection Error. Please refresh.</div>`;
    }
}

function populateSymbolFilter(trades) {
    const symbolSelect = document.getElementById('filterSymbol');
    const currentVal = symbolSelect.value;
    const uniqueSymbols = [...new Set(trades.map(t => t.symbol))].sort();
    symbolSelect.innerHTML = '<option value="">All Symbols</option>';
    uniqueSymbols.forEach(sym => { const option = document.createElement('option'); option.value = sym; option.text = sym; symbolSelect.appendChild(option); });
    if(uniqueSymbols.includes(currentVal)) symbolSelect.value = currentVal;
}

function applyFilters(preserveIds = []) {
    const filterSymbol = document.getElementById('filterSymbol').value;
    const filterStatus = document.getElementById('filterStatus').value;
    const filterType = document.getElementById('filterType').value;
    let startDate = ""; let endDate = "";
    if (datePicker && datePicker.selectedDates.length > 0) {
        const formatOpts = { timeZone: 'Asia/Kolkata' };
        startDate = datePicker.selectedDates[0].toLocaleDateString('en-CA', formatOpts);
        endDate = datePicker.selectedDates.length === 2 ? datePicker.selectedDates[1].toLocaleDateString('en-CA', formatOpts) : startDate;
    }
    const dateDisplay = document.getElementById('activeDateDisplay');
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (!startDate && !endDate) { dateDisplay.innerText = "All Time"; } 
    else if (startDate === endDate) { dateDisplay.innerText = (startDate === todayStr) ? "Today" : startDate; } 
    else { dateDisplay.innerText = `${startDate.substring(5)} to ${endDate.substring(5)}`; }

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

        if (typeMatch && symbolMatch && statusMatch) { acc.push({ ...trade, displayStatus, isVisuallyActive, tradeDateObj }); }
        return acc;
    }, []);

    renderTrades(filtered, preserveIds);
    calculateStats(filtered);
}

function renderTrades(trades, preserveIds) {
    const container = document.getElementById('tradeListContainer');
    const noDataMsg = document.getElementById('noData');
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
    pipsEl.innerText = totalPoints.toFixed(2);
    pipsEl.className = totalPoints >= 0 ? 'stat-val val-green' : 'stat-val val-red';
    
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
        const res = await fetch('/api/delete_trades', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ trade_ids: ids, password: password }) 
        });
        const result = await res.json();
        if (result.success) { toggleSelectionMode(); alert("✅ Deleted Successfully"); } else { alert(result.msg || "❌ Error Deleting"); }
    } catch (err) { console.error(err); }
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
        localStorage.clear();
        window.location.href = '/login.html';
    } catch (err) { console.error("Logout failed", err); }
}

document.getElementById('filterSymbol').addEventListener('change', () => applyFilters());
document.getElementById('filterStatus').addEventListener('change', () => applyFilters());
document.getElementById('filterType').addEventListener('change', () => applyFilters());
