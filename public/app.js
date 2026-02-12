const API_URL = '/api/trades'; 
let allTrades = []; 
let isSelectionMode = false;
const socket = io(); 

window.onload = function() {
    setTodayDate();
    fetchTrades();
};

// --- REAL-TIME LISTENER ---
socket.on('trade_update', () => {
    fetchTrades();
});

function setTodayDate() {
    // Set Input to IST Date
    const istDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    document.getElementById('filterDate').value = istDate;
}

async function fetchTrades() {
    const checkedIds = getCheckedIds();
    try {
        const response = await fetch(API_URL);
        allTrades = await response.json();
        applyFilters(checkedIds); 
    } catch (error) {
        console.error("Error fetching trades:", error);
    }
}

function applyFilters(preserveIds = []) {
    const filterSymbol = document.getElementById('filterSymbol').value.toUpperCase();
    const filterStatus = document.getElementById('filterStatus').value;
    const filterDateInput = document.getElementById('filterDate').value; 

    const filtered = allTrades.filter(trade => {
        const tradeDateObj = new Date(trade.created_at);
        const tradeDateStr = tradeDateObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        const matchesDate = (filterDateInput === "") || (tradeDateStr === filterDateInput);
        const matchesSymbol = trade.symbol.includes(filterSymbol);
        const matchesStatus = filterStatus === 'ALL' || 
                              (filterStatus === 'TP' && trade.status.includes('TP')) ||
                              (filterStatus === 'SL' && trade.status.includes('SL')) ||
                              (filterStatus === 'OPEN' && trade.status === 'ACTIVE');

        return matchesDate && matchesSymbol && matchesStatus;
    });

    renderTrades(filtered, preserveIds);
    calculateStats(filtered);
}

// --- CARD RENDERING ENGINE (FIXED) ---
function renderTrades(trades, preserveIds) {
    const container = document.getElementById('tradeListContainer');
    const noDataMsg = document.getElementById('noDataMessage');
    
    container.innerHTML = '';
    
    if (trades.length === 0) {
        if(noDataMsg) noDataMsg.style.display = 'block';
        return;
    } else {
        if(noDataMsg) noDataMsg.style.display = 'none';
    }

    trades.forEach((trade, index) => {
        const dateObj = new Date(trade.created_at);
        const timeString = dateObj.toLocaleTimeString('en-US', { 
            timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true 
        });

        // Styles Logic
        let statusClass = 'st-wait';
        let profitClass = 'profit-neu';
        let badgeClass = trade.type === 'BUY' ? 'badge-buy' : 'badge-sell';
        
        if (trade.status === 'ACTIVE') statusClass = 'st-active';
        else if (trade.status.includes('TP')) { statusClass = 'st-tp'; profitClass = 'profit-pos'; }
        else if (trade.status.includes('SL')) { statusClass = 'st-sl'; profitClass = 'profit-neg'; }

        let pts = parseFloat(trade.points_gained);
        // Force color if active trade has profit/loss
        if (pts > 0) profitClass = 'profit-pos';
        if (pts < 0) profitClass = 'profit-neg';

        // FIX: Always show 5 digits for precision (Removed the <10 logic)
        let displayPts = pts.toFixed(5);
        
        const isChecked = preserveIds.includes(trade.trade_id) ? 'checked' : '';
        const checkDisplay = isSelectionMode ? 'block' : 'none';

        // --- CARD HTML (Added TP2 & TP3) ---
        const cardHtml = `
            <div class="trade-card">
                <div class="status-pill ${statusClass}">${trade.status}</div>
                
                <div class="tc-header">
                    <div class="d-flex align-items-center">
                        <input type="checkbox" class="custom-check trade-checkbox" value="${trade.trade_id}" ${isChecked} style="display:${checkDisplay}">
                        <div class="tc-symbol">${trade.symbol}</div>
                        <div class="badge-type ${badgeClass} ms-2">${trade.type}</div>
                    </div>
                    <div class="tc-time">${timeString}</div>
                </div>

                <div class="tc-body">
                    <div class="tc-details" style="width: 60%;">
                        <div class="tc-row">
                            <span style="width: 40px;">Entry:</span> <span class="tc-val">${parseFloat(trade.entry_price).toFixed(5)}</span>
                        </div>
                        <div class="tc-row">
                            <span style="width: 40px;">SL:</span> <span class="tc-val text-danger">${parseFloat(trade.sl_price).toFixed(5)}</span>
                        </div>
                        <div class="tc-row mt-2 border-top pt-1">
                            <span style="width: 40px;">TP1:</span> <span class="tc-val text-muted">${parseFloat(trade.tp1_price).toFixed(5)}</span>
                        </div>
                        <div class="tc-row">
                            <span style="width: 40px;">TP2:</span> <span class="tc-val text-muted">${parseFloat(trade.tp2_price).toFixed(5)}</span>
                        </div>
                        <div class="tc-row">
                            <span style="width: 40px;">TP3:</span> <span class="tc-val text-muted">${parseFloat(trade.tp3_price).toFixed(5)}</span>
                        </div>
                    </div>
                    
                    <div class="text-end">
                        <div style="font-size:0.7rem; color:#94a3b8; margin-bottom:2px;">PROFIT</div>
                        <div class="tc-profit ${profitClass}">
                            ${pts > 0 ? '+' : ''}${displayPts}
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.innerHTML += cardHtml;
    });
}

function calculateStats(trades) {
    let totalPoints = 0;
    let wins = 0;
    let losses = 0;
    let active = 0;

    trades.forEach(t => {
        if (t.status === 'ACTIVE' || t.status === 'SETUP') active++;
        else {
            const pts = parseFloat(t.points_gained);
            totalPoints += pts;
            if (pts > 0) wins++;
            else if (pts < 0) losses++;
        }
    });

    const totalClosed = wins + losses;
    const winRate = totalClosed === 0 ? 0 : Math.round((wins / totalClosed) * 100);

    if(document.getElementById('totalTrades')) document.getElementById('totalTrades').innerText = trades.length;
    if(document.getElementById('winRate')) document.getElementById('winRate').innerText = winRate + "%";
    
    // Fix Stats Precision as well
    let displayTotal = totalPoints.toFixed(5);
    if(document.getElementById('totalPips')) document.getElementById('totalPips').innerText = displayTotal;
    
    if(document.getElementById('activeTrades')) document.getElementById('activeTrades').innerText = active;
}

// --- UTILS ---
function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    const checkboxes = document.querySelectorAll('.trade-checkbox');
    const icon = document.getElementById('selectIcon');
    
    checkboxes.forEach(cb => {
        cb.style.display = isSelectionMode ? 'block' : 'none';
    });

    if (isSelectionMode) {
        icon.innerText = "check_circle";
        icon.style.color = "#3b82f6";
    } else {
        icon.innerText = "check_circle_outline";
        icon.style.color = "";
        checkboxes.forEach(cb => cb.checked = false);
    }
}

function getCheckedIds() {
    return Array.from(document.querySelectorAll('.trade-checkbox:checked')).map(cb => cb.value);
}

async function deleteSelected() {
    if (!isSelectionMode) {
        toggleSelectionMode();
        alert("Select trades to delete, then click Delete again.");
        return;
    }

    const tradeIdsToDelete = getCheckedIds();
    
    if (tradeIdsToDelete.length === 0) {
        alert("Please select at least one trade to delete.");
        return;
    }

    if(!confirm(`⚠️ Delete ${tradeIdsToDelete.length} trades permanently?`)) {
        return;
    }

    try {
        const response = await fetch('/api/delete_trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trade_ids: tradeIdsToDelete })
        });

        const result = await response.json();
        if (result.success) {
            toggleSelectionMode(); 
        } else {
            alert("Error: " + result.msg);
        }
    } catch (err) {
        console.error(err);
    }
}

// Event Listeners
document.getElementById('filterDate').addEventListener('change', () => applyFilters());
document.getElementById('filterSymbol').addEventListener('keyup', () => applyFilters());
document.getElementById('filterStatus').addEventListener('change', () => applyFilters());
