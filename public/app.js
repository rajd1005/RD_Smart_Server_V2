// --- CONFIG & STATE ---
const API_URL_TRADES = '/api/trades'; 
const API_URL_COURSES = '/api/courses'; // NEW Endpoint
const API_URL_LESSON = '/api/lesson/';  // NEW Endpoint for specific secure lesson

let allTrades = []; 
let isSelectionMode = false;
const socket = io(); 
let datePicker;
let videoPlayer = null; // Store Video.js instance
let watermarkInterval = null; // Store watermark movement timer

// Current User Data (Extracted from localStorage after login)
const userData = {
    email: localStorage.getItem('userEmail'),
    phone: localStorage.getItem('userPhone'),
    role: localStorage.getItem('userRole')
};

// --- STARTUP ---
window.onload = function() {
    initClock();
    
    // Default startup logic for Trading Section
    initDatePicker();
    fetchTrades();

    // Check if learning data exists in storage (saved during login)
    checkLearningAccess();
};

// --- NAVIGATION LOGIC ---
function switchSection(sectionName) {
    const tradeSec = document.getElementById('tradeSection');
    const learnSec = document.getElementById('learningSection');
    const navTrade = document.getElementById('navTrade');
    const navLearn = document.getElementById('navLearning');

    if (sectionName === 'trade') {
        tradeSec.style.display = 'block';
        learnSec.style.display = 'none';
        navTrade.classList.add('b-active');
        navLearn.classList.remove('b-active');
        fetchTrades(); // Refresh trades
    } else if (sectionName === 'learning') {
        tradeSec.style.display = 'none';
        learnSec.style.display = 'block';
        navLearn.classList.add('b-active');
        navTrade.classList.remove('b-active');
        fetchCourses(); // NEW: Fetch courses
    }
}

// --- CLOCK HELPER ---
function initClock() {
    setInterval(() => { document.getElementById('clock').innerText = new Date().toLocaleTimeString('en-GB'); }, 1000);
}

// ==============================================================================
// --- NEW PHASE: LEARNING & SECURE VIDEO LOGIC ---
// ==============================================================================

function checkLearningAccess() {
    // Check if level data was saved during login process
    const accessLevels = localStorage.getItem('accessLevels');
    if (!accessLevels) {
        console.warn("Learning access levels not found. User needs to re-login.");
        // Optional: Could redirect to login here if learning is mandatory
    }
}

async function fetchCourses() {
    const container = document.getElementById('courseModuleContainer');
    container.innerHTML = '<div class="p-4 text-center text-muted">Loading courses...</div>';

    try {
        const response = await fetch(API_URL_COURSES);
        
        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login.html'; // Token expired/IP changed
            return;
        }
        
        const modules = await response.json();
        
        // Parse access levels saved during login
        const accessLevelsStr = localStorage.getItem('accessLevels');
        let accessLevels = {};
        try {
            accessLevels = accessLevelsStr ? JSON.parse(accessLevelsStr) : {};
        } catch(e) { console.error("Error parsing access levels", e); }

        renderCourses(modules, accessLevels);
    } catch (error) { 
        console.error(error); 
        container.innerHTML = `<div class="p-3 text-danger text-center fw-bold">❌ Connection Error. Please refresh.</div>`;
    }
}

function renderCourses(modules, accessLevels) {
    const container = document.getElementById('courseModuleContainer');
    if (modules.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-muted">No courses available yet.</div>';
        return;
    }

    let htmlContent = '';

    modules.forEach((mod) => {
        // Core Access Control Check (User Role Admin bypasses this)
        const isLocked = userData.role !== 'admin' && accessLevels[mod.required_level] !== 'Yes';
        
        const levelBadge = isLocked 
            ? '<span class="module-level-badge badge-locked">LOCKED</span>'
            : '<span class="module-level-badge badge-unlocked">UNLOCKED</span>';

        let lessonListHtml = '';
        if (isLocked) {
            lessonListHtml = `<div class="lock-notice">⚠️ Level ${mod.required_level.split('_')[1]} Status: NO. Access Denied. Contact Admin.</div>`;
        } else {
            // Populate actual lessons for unlocked modules
            if (mod.lessons && mod.lessons.length > 0) {
                mod.lessons.forEach(lesson => {
                    lessonListHtml += `
                        <div class="lesson-item" onclick="openSecureVideo(${lesson.id}, '${lesson.title}')">
                            <span class="material-icons-round lesson-icon">play_circle_filled</span>
                            <div>
                                <div class="fw-bold">${lesson.title}</div>
                                ${lesson.description ? `<div class="text-muted small">${lesson.description}</div>` : ''}
                            </div>
                        </div>`;
                });
            } else {
                lessonListHtml = '<div class="text-muted small p-3">No videos in this module.</div>';
            }
        }

        htmlContent += `
            <div class="course-module ${isLocked ? 'module-locked' : ''}">
                <div class="module-header d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="module-title">${mod.title}</h6>
                        ${mod.description ? `<div class="text-muted small">${mod.description}</div>` : ''}
                    </div>
                    ${levelBadge}
                </div>
                <div class="lesson-list">
                    ${lessonListHtml}
                </div>
            </div>`;
    });
    
    container.innerHTML = htmlContent;
}

// --- SECURE HLS VIDEO PLAYER LOGIC WITH WATERMARK ---

async function openSecureVideo(lessonId, lessonTitle) {
    console.log(`Attempting to play secure lesson ${lessonId}...`);
    
    // 1. Initialize Video.js if not already done
    if (!videoPlayer) {
        videoPlayer = videojs('my-video', {
            hls: { overrideNative: true }, // Force HLS parsing
            html5: { vhs: { overrideNative: true } } // Video.js HLS handler
        });
        
        // NEW: Event Listener to start watermark movement only when playing
        videoPlayer.on('play', () => {
            document.getElementById('dynamicWatermark').style.display = 'block';
            startDynamicWatermark(); 
        });
        
        // NEW: Event Listener to stop watermark when paused/ended
        videoPlayer.on(['pause', 'ended', 'waiting'], () => {
            stopDynamicWatermark();
        });
    }

    // 2. Clear previous source
    videoPlayer.reset();
    stopDynamicWatermark(); // Stop any running movement

    try {
        // 3. NEW: API Call to get the secure HLS manifest URL (Backend verifies access again)
        const response = await fetch(`${API_URL_LESSON}${lessonId}`);
        if (response.status === 403) {
            alert("❌ ACCESS DENIED: Your user level has not unlocked this specific course.");
            return;
        }
        if (!response.ok) throw new Error("Failed to load lesson manifest.");
        
        const data = await response.json();

        // 4. Set NEW Source (.m3u8 manifest)
        videoPlayer.src({
            src: data.hlsUrl, // Secure backend URL serving the manifest
            type: 'application/x-mpegURL'
        });

        // 5. Setup UI
        document.getElementById('videoPlayerContainer').style.display = 'block';
        
        // Add a history state so back button closes video
        history.pushState({ videoOpen: true }, '', '#video');
        
        // 6. Play
        videoPlayer.play();

    } catch(err) {
        console.error(err);
        alert("🚨 Error loading secure video stream. Check console.");
    }
}

function closeVideoPlayer() {
    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.reset(); // Clean up current source
    }
    stopDynamicWatermark(); // Stop movement
    document.getElementById('videoPlayerContainer').style.display = 'none';
}

// --- DYNAMIC WATERMARK LOGIC (Moving Text) ---

function startDynamicWatermark() {
    const wmEl = document.getElementById('dynamicWatermark');
    const container = document.getElementById('videoPlayerContainer');
    
    if(!userData.email || !userData.phone) {
        console.error("User data missing for watermark.");
        return;
    }

    // NEW: Inject Dynamic Text fetched from user record
    wmEl.innerText = `RD ALGO • ${userData.email} • ${userData.phone} • IP bound`;
    wmEl.style.display = 'block';

    if (watermarkInterval) clearInterval(watermarkInterval);

    // Initial random position
    moveWatermark();

    // NEW: Move the watermark randomly every 5 seconds to prevent static screens capturing
    watermarkInterval = setInterval(moveWatermark, 5000); 
}

function stopDynamicWatermark() {
    if (watermarkInterval) clearInterval(watermarkInterval);
    document.getElementById('dynamicWatermark').style.display = 'none';
}

function moveWatermark() {
    const wmEl = document.getElementById('dynamicWatermark');
    const container = document.getElementById('videoPlayerContainer');
    
    // Calculate boundaries (accounting for header height in player container)
    const maxX = container.clientWidth - wmEl.clientWidth - 30; // 15px padding
    const maxY = container.clientHeight - wmEl.clientHeight - 80; // Accounting for close button & controls

    // Generate random coordinates
    const randomX = Math.floor(Math.random() * Math.max(0, maxX)) + 15;
    const randomY = Math.floor(Math.random() * Math.max(0, maxY)) + 60; // Start below close button

    // Apply smooth transition CSS randomly (for "jumping" vs "smooth drift")
    const smoothMove = Math.random() < 0.5;
    wmEl.style.transition = smoothMove ? 'all 1s ease-in-out' : 'all 0.1s linear';

    // Set position
    wmEl.style.left = randomX + 'px';
    wmEl.style.top = randomY + 'px';
}


// ==============================================================================
// --- EXISTING PHASE: TRADING DASHBOARD LOGIC (Preserved) ---
// ==============================================================================

function initDatePicker() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    datePicker = flatpickr("#filterDateRange", {
        mode: "range", dateFormat: "Y-m-d", defaultDate: today, 
        onChange: function() { applyFilters(); }
    });
}

socket.on('trade_update', () => { fetchTrades(); });

async function fetchTrades() {
    const checkedIds = getCheckedIds();
    try {
        const response = await fetch(API_URL_TRADES);
        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login.html'; 
            return;
        }
        allTrades = await response.json();
        populateSymbolFilter(allTrades);
        applyFilters(checkedIds); 
    } catch (error) { console.error(error); }
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
    
    if (!startDate && !endDate) dateDisplay.innerText = "All Time";
    else if (startDate === endDate) dateDisplay.innerText = (startDate === todayStr) ? "Today" : startDate;
    else dateDisplay.innerText = `${startDate.substring(5)} to ${endDate.substring(5)}`;

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
            displayStatus = pts > 0 ? 'PROFIT (CLOSED)' : (pts < 0 ? 'LOSS (CLOSED)' : 'CLOSED (BREAKEVEN)');
        }

        const typeMatch = (filterType === 'ALL' || trade.type === filterType);
        const symbolMatch = (filterSymbol === "" || trade.symbol === filterSymbol);
        
        let statusMatch = true;
        if (filterStatus === 'TP') statusMatch = (displayStatus.includes('TP') || displayStatus.includes('PROFIT'));
        else if (filterStatus === 'SL') statusMatch = (displayStatus.includes('SL') || displayStatus.includes('LOSS'));
        else if (filterStatus === 'OPEN') statusMatch = isVisuallyActive;

        if (typeMatch && symbolMatch && statusMatch) acc.push({ ...trade, displayStatus, isVisuallyActive, tradeDateObj });
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
        const pts = parseFloat(trade.points_gained);
        const displayPts = pts.toFixed(2);

        let profitColor = 'text-muted'; let statusColor = '#878a8d'; let statusText = trade.displayStatus.replace(' (Reversal)', '');
        
        if (trade.isVisuallyActive) { statusColor = '#007aff'; }
        else if (statusText.includes('TP') || statusText.includes('PROFIT')) { statusColor = '#00b346'; profitColor = 'c-green'; }
        else if (statusText.includes('SL') || statusText.includes('LOSS')) { statusColor = '#ff3b30'; profitColor = 'c-red'; }
        else if (pts > 0) { profitColor = 'c-green'; } else if (pts < 0) { profitColor = 'c-red'; }

        htmlContent += `
            <div class="trade-card">
                <div class="tc-top">
                    <div class="tc-symbol">${trade.symbol}</div>
                    <div class="tc-profit ${profitColor}">${pts > 0 ? '+' : ''}${displayPts}</div>
                </div>
                <div class="tc-mid">
                    <span class="type-badge ${trade.type === 'BUY' ? 'bg-buy' : 'bg-sell'}">${trade.type}</span>
                    <span class="tc-time">${dateString} • ${timeString}</span>
                    <span class="status-txt ms-auto" style="color:${statusColor}">${statusText}</span>
                </div>
                <div class="tc-bot">
                    <div class="dt-item"><span class="dt-lbl">ENTRY</span><span class="dt-val">${parseFloat(trade.entry_price).toFixed(2)}</span></div>
                    <div class="dt-item"><span class="dt-lbl">SL</span><span class="dt-val c-red">${parseFloat(trade.sl_price).toFixed(2)}</span></div>
                    <div class="dt-item"><span class="dt-lbl">TP1</span><span class="dt-val">${parseFloat(trade.tp1_price).toFixed(2)}</span></div>
                    <div class="dt-item"><span class="dt-lbl">TP2</span><span class="dt-val">${parseFloat(trade.tp2_price).toFixed(2)}</span></div>
                    <div class="dt-item"><span class="dt-lbl">TP3</span><span class="dt-val">${parseFloat(trade.tp3_price).toFixed(2)}</span></div>
                </div>
            </div>`;
    });
    container.innerHTML = htmlContent;
}

function calculateStats(trades) {
    let totalPoints = 0; let wins = 0; let losses = 0; let active = 0;
    trades.forEach(t => { if (t.isVisuallyActive) { active++; } else { const pts = parseFloat(t.points_gained); totalPoints += pts; if (pts > 0) wins++; else if (pts < 0) losses++; } });
    const totalClosed = wins + losses;
    const winRate = totalClosed === 0 ? 0 : Math.round((wins / totalClosed) * 100);
    if(document.getElementById('totalTrades')) document.getElementById('totalTrades').innerText = trades.length;
    if(document.getElementById('winRate')) document.getElementById('winRate').innerText = winRate + "%";
    const pipsEl = document.getElementById('totalPips'); pipsEl.innerText = totalPoints.toFixed(2); pipsEl.className = totalPoints >= 0 ? 'stat-val val-green' : 'stat-val val-red';
    if(document.getElementById('activeTrades')) document.getElementById('activeTrades').innerText = active;
}

function getCheckedIds() { return []; } // Preservation helper

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        // NEW: Clear user learning data
        localStorage.removeItem('userEmail'); localStorage.removeItem('userPhone'); localStorage.removeItem('userRole'); localStorage.removeItem('accessLevels'); 
        window.location.href = '/login.html';
    } catch (err) { console.error("Logout failed", err); }
}

document.getElementById('filterSymbol').addEventListener('change', () => applyFilters());
document.getElementById('filterStatus').addEventListener('change', () => applyFilters());
document.getElementById('filterType').addEventListener('change', () => applyFilters());
