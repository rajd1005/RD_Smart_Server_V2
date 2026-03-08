let currentChannelId = null;

async function initChannelTab() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        const navBtn = document.getElementById('navChannelBtn');
        if (navBtn) {
            if (data.show_channel_tab === 'false' && typeof userData !== 'undefined' && userData.role !== 'admin' && userData.role !== 'manager') {
                navBtn.style.display = 'none';
            } else {
                navBtn.style.display = 'flex';
            }
        }
        const toggle = document.getElementById('adminShowChannelTab');
        if (toggle) toggle.checked = (data.show_channel_tab !== 'false');
    } catch(e) {}
}

setTimeout(initChannelTab, 1000);

async function fetchChannels() {
    showChannelList();
    try {
        const res = await fetch('/api/channels', { credentials: 'same-origin' });
        const data = await res.json();
        const listObj = document.getElementById('channelListView');
        
        if (data.data.length === 0) {
            listObj.innerHTML = '<div class="text-center text-muted mt-5"><span class="material-icons-round" style="font-size:48px; opacity:0.2;">forum</span><br>No channels available.</div>';
            return;
        }
        
        let html = '';
        let accessLevels = {};
        try { accessLevels = JSON.parse(localStorage.getItem('accessLevels')) || {}; } catch(e) {}

        data.data.forEach(c => {
            const isLocked = (typeof userData !== 'undefined' && userData.role !== 'admin' && userData.role !== 'manager') && c.access_level !== 'demo' && accessLevels[c.access_level] !== 'Yes';
            
            if (typeof userData !== 'undefined' && userData.role !== 'admin' && userData.role !== 'manager') {
                if (c.dashboard_visibility === 'hidden') return;
                if (c.dashboard_visibility === 'accessible' && isLocked) return;
            }

            const iconHtml = isLocked ? 
                `<div class="bg-light text-muted rounded-circle d-flex align-items-center justify-content-center me-3" style="width: 40px; height: 40px; border: 1px solid #ccc;"><span class="material-icons-round">lock</span></div>` :
                `<div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center me-3" style="width: 40px; height: 40px; font-weight: bold; font-size: 18px;">${c.name.charAt(0).toUpperCase()}</div>`;
            
            const action = isLocked ? `alert('⚠️ Locked. Please upgrade your access level.')` : `openChannel(${c.id}, '${c.name.replace(/'/g, "\\'")}')`;

            html += `
            <div class="p-3 bg-white rounded shadow-sm mb-2 d-flex align-items-center" style="cursor:pointer; border: 1px solid var(--border-color); ${isLocked ? 'opacity: 0.7;' : ''}" onclick="${action}">
                ${iconHtml}
                <div>
                    <h6 class="mb-0 fw-bold" style="font-size: 14px; color: #000;">${c.name}</h6>
                    <div class="text-muted" style="font-size: 11px;">${isLocked ? 'Access Restricted' : (c.description || 'Tap to view messages')}</div>
                </div>
            </div>`;
        });
        listObj.innerHTML = html;
        
        if (window.pendingChannelId) {
            const targetChannel = data.data.find(c => c.id == window.pendingChannelId);
            if (targetChannel) {
                // Double check if locked before opening
                const isLocked = (typeof userData !== 'undefined' && userData.role !== 'admin' && userData.role !== 'manager') && targetChannel.access_level !== 'demo' && accessLevels[targetChannel.access_level] !== 'Yes';
                if (!isLocked) openChannel(targetChannel.id, targetChannel.name);
            }
            window.pendingChannelId = null;
        }
    } catch(e) {}
}

function showChannelList() {
    currentChannelId = null;
    document.getElementById('channelListView').style.display = 'block';
    document.getElementById('channelChatView').style.display = 'none';
    document.getElementById('channelInputBox').style.display = 'none';
    document.getElementById('btnBackChannels').style.display = 'none';
    document.getElementById('channelHeaderTitle').innerHTML = '<span class="material-icons-round text-primary me-2 align-middle">forum</span>Channels';
}

async function openChannel(id, name) {
    currentChannelId = id;
    document.getElementById('channelListView').style.display = 'none';
    document.getElementById('channelChatView').style.display = 'flex';
    document.getElementById('btnBackChannels').style.display = 'block';
    document.getElementById('channelHeaderTitle').innerText = name;
    
    if (typeof userData !== 'undefined' && (userData.role === 'admin' || userData.role === 'manager')) {
        document.getElementById('channelInputBox').style.display = 'block';
        document.getElementById('activeChannelId').value = id;
    }

    fetchChannelMessages(id);
}

async function fetchChannelMessages(id) {
    try {
        const res = await fetch(`/api/channels/${id}/messages`, { credentials: 'same-origin' });
        const data = await res.json();
        const chatObj = document.getElementById('channelChatView');
        chatObj.innerHTML = '';
        
        if (data.data.length === 0) {
            chatObj.innerHTML = '<div class="text-center text-muted mt-4" style="font-size:12px;">No messages yet.</div>';
            return;
        }

        let html = '';
        data.data.forEach(m => {
            const dateStr = new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            let imgHtml = m.image_url ? `<img src="${m.image_url}" style="max-width: 100%; border-radius: 8px; margin-bottom: 6px;">` : '';
            let linkHtml = m.link_url ? `<a href="${m.link_url}" target="_blank" class="chat-link mt-2" style="font-size:11px;">${m.link_url}</a>` : '';

            html += `
            <div class="chat-bubble mb-3 w-100 shadow-sm" style="background-color: #fff; max-width: 90%; align-self: flex-start; border: 1px solid var(--border-color); border-radius: 12px; border-bottom-left-radius: 0; padding: 10px 14px;">
                <div class="d-flex justify-content-between mb-1 border-bottom pb-1">
                    <span style="font-size: 10px; font-weight: 900; color: var(--blue); text-transform: uppercase;">${m.sender_email.split('@')[0]}</span>
                    <span style="font-size: 9px; color: var(--text-secondary);">${dateStr}</span>
                </div>
                <div class="chat-title mt-1">${m.title}</div>
                ${imgHtml}
                <div class="chat-body" style="font-size: 13px; color: #333;">${m.body}</div>
                ${linkHtml}
            </div>`;
        });
        chatObj.innerHTML = html;
        chatObj.scrollTop = chatObj.scrollHeight;
    } catch(e) {}
}

const formChannelMsg = document.getElementById('formChannelMessage');
if (formChannelMsg) {
    formChannelMsg.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnChannelSubmit');
        btn.disabled = true;

        const id = document.getElementById('activeChannelId').value;
        const formData = new FormData();
        formData.append('title', document.getElementById('channelMsgTitle').value);
        formData.append('body', document.getElementById('channelMsgBody').value);
        formData.append('link_url', document.getElementById('channelMsgUrl').value);
        
        const imageEl = document.getElementById('channelMsgImage');
        if (imageEl && imageEl.files[0]) formData.append('image', imageEl.files[0]);

        try {
            const res = await fetch(`/api/channels/${id}/messages`, { method: 'POST', body: formData, credentials: 'same-origin' });
            if (res.ok) {
                document.getElementById('channelMsgTitle').value = '';
                document.getElementById('channelMsgBody').value = '';
                document.getElementById('channelMsgUrl').value = '';
                if (imageEl) imageEl.value = '';
                fetchChannelMessages(id);
                
                const adv = document.getElementById('advancedChannelOptions');
                if (adv.classList.contains('show')) new bootstrap.Collapse(adv).hide();
            }
        } catch(e) {} finally { btn.disabled = false; }
    });
}

if (typeof socket !== 'undefined') {
    const channelSound = new Audio('/chaching.mp3'); 
    socket.on('new_channel_msg', (data) => {
        channelSound.play().catch(e => { console.log("Sound autoplay blocked"); });
        if (currentChannelId == data.channel_id) {
            fetchChannelMessages(currentChannelId);
        }
    });
}

const formAddChannel = document.getElementById('formAddChannel');
if (formAddChannel) {
    formAddChannel.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            name: document.getElementById('adminChannelName').value,
            description: document.getElementById('adminChannelDesc').value,
            access_level: document.getElementById('adminChannelLevel').value,
            show_on_home: document.getElementById('adminChannelShowHome').value === 'true',
            dashboard_visibility: document.getElementById('adminChannelDashVis').value,
            display_order: document.getElementById('adminChannelOrder').value || 0
        };
        await fetch('/api/channels/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'same-origin' });
        formAddChannel.reset();
        fetchAdminChannels();
    });
}

async function fetchAdminChannels() {
    const list = document.getElementById('adminChannelList');
    if (!list) return;
    try {
        const res = await fetch('/api/channels', { credentials: 'same-origin' });
        const data = await res.json();
        let html = '<table class="table table-sm" style="font-size:10px;">';
        data.data.forEach(c => {
            const safeName = c.name.replace(/'/g, "\\'");
            const safeDesc = (c.description || '').replace(/'/g, "\\'");
            const showHome = c.show_on_home !== false;
            const visBadge = showHome ? '<span class="text-success fw-bold" style="font-size:9px;">👁️ Visible</span>' : '<span class="text-danger fw-bold" style="font-size:9px;">🚫 Hidden</span>';
            const dashVis = c.dashboard_visibility || 'all';
            const order = c.display_order || 0;
            
            html += `<tr>
                <td><b style="color:var(--blue);">${c.name}</b> <span class="ms-1">${visBadge}</span><br><span class="text-muted">${c.access_level} | Order: ${order}</span></td>
                <td class="text-end align-middle">
                    <button class="btn btn-sm text-primary p-0 me-2" onclick="openEditChannelModal(${c.id}, '${safeName}', '${safeDesc}', '${c.access_level}', ${showHome}, '${dashVis}', ${order})"><span class="material-icons-round" style="font-size:16px;">edit</span></button>
                    <button class="btn btn-sm text-danger p-0" onclick="deleteChannel(${c.id})"><span class="material-icons-round" style="font-size:16px;">delete</span></button>
                </td>
            </tr>`;
        });
        html += '</table>';
        list.innerHTML = html;
    } catch(e){}
}

window.deleteChannel = async function(id) {
    if(!confirm("Are you sure you want to delete this channel? ALL messages inside will be permanently lost!")) return;
    await fetch(`/api/channels/admin/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    fetchAdminChannels();
};

const adminModal = document.getElementById('adminCourseModal');
if (adminModal) {
    adminModal.addEventListener('show.bs.modal', function () { fetchAdminChannels(); });
}

window.openEditChannelModal = function(id, name, desc, level, showHome, dashVis, order) {
    document.getElementById('editChannelId').value = id;
    document.getElementById('editChannelName').value = name;
    document.getElementById('editChannelDesc').value = desc;
    document.getElementById('editChannelLevel').value = level;
    document.getElementById('editChannelShowHome').value = showHome ? 'true' : 'false';
    document.getElementById('editChannelDashVis').value = dashVis;
    document.getElementById('editChannelOrder').value = order;
    
    const modal = new bootstrap.Modal(document.getElementById('editChannelModal'));
    modal.show();
};

const formEditChannel = document.getElementById('formEditChannel');
if (formEditChannel) {
    formEditChannel.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editChannelId').value;
        const data = {
            name: document.getElementById('editChannelName').value,
            description: document.getElementById('editChannelDesc').value,
            access_level: document.getElementById('editChannelLevel').value,
            show_on_home: document.getElementById('editChannelShowHome').value === 'true',
            dashboard_visibility: document.getElementById('editChannelDashVis').value,
            display_order: document.getElementById('editChannelOrder').value || 0
        };
        
        try {
            const res = await fetch(`/api/channels/admin/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'same-origin' });
            if (res.ok) {
                const modal = bootstrap.Modal.getInstance(document.getElementById('editChannelModal'));
                if (modal) modal.hide();
                fetchAdminChannels();
                fetchChannels(); 
            }
        } catch(e) {}
    });
}
