const tradeSound = new Audio('/chaching.mp3');
let tradeSoundEnabled = true; // Default to true

// --- NEW: Fetch settings to see if trade alerts (and sound) are enabled ---
async function updateTradeSoundSetting() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        // Disable sound if push_trade_alerts is explicitly 'false'
        tradeSoundEnabled = (data.push_trade_alerts !== 'false' && data.push_trade_alerts !== '0');
    } catch (e) {
        console.error("Could not fetch trade sound settings");
    }
}

// Check settings on load and whenever an Admin updates them
updateTradeSoundSetting();
socket.on('settings_updated', updateTradeSoundSetting);
// --------------------------------------------------------------------------

setInterval(() => {
    const tradeSec = document.getElementById('tradeSection');
    if (tradeSec && tradeSec.style.display === 'block' && !isSelectionMode) {
        fetchTrades();
    }
}, 5000); 

socket.on('trade_update', () => { 
    fetchTrades(); 
    // --- NEW: Only play the sound if the setting is currently enabled ---
    if (tradeSoundEnabled) {
        tradeSound.play().catch(e => { console.log("Browser blocked auto-play sound."); });
    }
});

function initDatePicker() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    datePicker = flatpickr("#filterDateRange", { mode: "range", dateFormat: "Y-m-d", defaultDate: today, onChange: function() { applyFilters(); } });
}

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

const filterSymbolEl = document.getElementById('filterSymbol');
if (filterSymbolEl) filterSymbolEl.addEventListener('change', () => applyFilters());

const filterStatusEl = document.getElementById('filterStatus');
if (filterStatusEl) filterStatusEl.addEventListener('change', () => applyFilters());

const filterTypeEl = document.getElementById('filterType');
if (filterTypeEl) filterTypeEl.addEventListener('change', () => applyFilters());

const filterCategoryEl = document.getElementById('filterCategory');
if (filterCategoryEl) filterCategoryEl.addEventListener('change', () => applyFilters());
