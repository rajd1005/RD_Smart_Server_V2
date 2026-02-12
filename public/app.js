const API_URL = '/api/trades'; 
let allTrades = []; 
const socket = io(); // Initialize Socket.io

window.onload = function() {
    setTodayDate();
    fetchTrades();
};

// --- REAL-TIME LISTENER ---
socket.on('trade_update', () => {
    // When server says "Update", we re-fetch data instantly
    fetchTrades();
});

function setTodayDate() {
    const istDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    document.getElementById('filterDate').value = istDate;
}

async function fetchTrades() {
    // 1. Save currently checked IDs to preserve selection
    const checkedIds = Array.from(document.querySelectorAll('.trade-checkbox:checked')).map(cb => cb.value);

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

    renderTable(filtered, preserveIds);
    calculateStats(filtered);
}

function renderTable(trades, preserveIds) {
    const tbody = document.getElementById('tradeTableBody');
    const noDataMsg = document.getElementById('noDataMessage');
    
    tbody.innerHTML = '';
    
    // Reset Select All (unless all are checked, but simplistic is fine)
    const selectAll = document.getElementById('selectAll');
    if(selectAll) selectAll.checked = false;

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

        let statusClass = 'text-secondary';
        if (trade.status === 'ACTIVE') statusClass = 'status-active';
        if (trade.status.includes('TP')) statusClass = 'status-tp';
        if (trade.status.includes('SL')) statusClass = 'status-sl';

        let pts = parseFloat(trade.points_gained);
        let ptsColor = pts > 0 ? 'text-success' : (pts < 0 ? 'text-danger' : 'text-muted');
        let displayPts = Math.abs(pts) < 10 && Math.abs(pts) > 0 ? pts.toFixed(5) : pts.toFixed(2);

        // Check if this ID was previously selected
        const isChecked = preserveIds.includes(trade.trade_id) ? 'checked' : '';

        const row = `
            <tr>
                <td><input type="checkbox" class="form-check-input trade-checkbox" value="${trade.trade_id}" ${isChecked}></td>
                <td class="fw-bold text-muted">${index + 1}</td>
                <td>${timeString}</td>
                <td><b>${trade.symbol}</b></td>
                <td><span class="badge ${trade.type === 'BUY' ? 'badge-buy' : 'badge-sell'}">${trade.type}</span></td>
                <td class="${statusClass}">${trade.status}</td>
                <td>${parseFloat(trade.entry_price).toFixed(5)}</td>
                <td>${parseFloat(trade.sl_price).toFixed(5)}</td>
                <td>${parseFloat(trade.tp1_price).toFixed(5)}</td>
                <td>${parseFloat(trade.tp2_price).toFixed(5)}</td>
                <td>${parseFloat(trade.tp3_price).toFixed(5)}</td>
                <td class="fw-bold ${ptsColor}" style="font-size:1.1rem">${displayPts}</td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function toggleSelectAll() {
    const selectAllBox = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.trade-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAllBox.checked);
}

async function deleteSelected() {
    const checkedBoxes = document.querySelectorAll('.trade-checkbox:checked');
    if (checkedBoxes.length === 0) {
        alert("Please select at least one trade to delete.");
        return;
    }

    if(!confirm(`⚠️ WARNING: Are you sure you want to PERMANENTLY delete ${checkedBoxes.length} trades?`)) {
        return;
    }

    const tradeIdsToDelete = Array.from(checkedBoxes).map(cb => cb.value);

    try {
        const response = await fetch('/api/delete_trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trade_ids: tradeIdsToDelete })
        });

        const result = await response.json();
        if (result.success) {
            document.getElementById('selectAll').checked = false;
            // No need to call fetchTrades() here, the Socket event will trigger it automatically!
        } else {
            alert("Error deleting trades: " + result.msg);
        }
    } catch (err) {
        console.error(err);
        alert("Server error during deletion.");
    }
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
    
    let displayTotal = Math.abs(totalPoints) < 10 && Math.abs(totalPoints) > 0 ? totalPoints.toFixed(5) : totalPoints.toFixed(2);
    if(document.getElementById('totalPips')) document.getElementById('totalPips').innerText = displayTotal;
    
    if(document.getElementById('activeTrades')) document.getElementById('activeTrades').innerText = active;
}

// Event Listeners
document.getElementById('filterDate').addEventListener('change', () => applyFilters());
document.getElementById('filterSymbol').addEventListener('keyup', () => applyFilters());
document.getElementById('filterStatus').addEventListener('change', () => applyFilters());
