let currentChannelId = null;
window.appSettings = {};
let channelMediaGallery = [];
let currentGalleryIndex = 0;

// Converts standard Markdown and URLs into clickable HTML (Bulletproofed)
function parseMarkdownToHtml(text) {
    if (!text || text === 'null' || text === 'undefined') return '';
    let html = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    // 1. Markdown Links: [text](url) -> becomes active hyperlink
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--blue); text-decoration:underline; font-weight:600;">$1</a>');
    
    // 2. Auto-link loose URLs
    html = html.replace(/(^|\s)(https?:\/\/[^\s]+)/g, '$1<a href="$2" target="_blank" style="color:var(--blue); text-decoration:underline; font-weight:600;">$2</a>');

    // 3. Telegram Formatting
    html = html.replace(/\*\*([^\*]+)\*\*/g, '<b>$1</b>'); 
    html = html.replace(/\*([^\*]+)\*/g, '<b>$1</b>');     
    html = html.replace(/_([^_]+)_/g, '<i>$1</i>');
    html = html.replace(/~([^~]+)~/g, '<s>$1</s>');
    html = html.replace(/`([^`]+)`/g, '<code style="background:#f1f1f1; padding:2px 4px; border-radius:4px; color:#d63384;">$1</code>');
    
    // 4. Line Breaks
    html = html.replace(/\n/g, '<br>');
    return html;
}

// Function to show full-screen swipeable media gallery
window.openSwipeGallery = function(index) {
    currentGalleryIndex = index;
    renderGalleryModal();
};

function renderGalleryModal() {
    const existing = document.getElementById('mediaPopupModal');
    if (existing) existing.remove();

    const item = channelMediaGallery[currentGalleryIndex];
    if (!item) return;
    const isVideo = item.url.match(/\.(mp4|mov|webm|ogg)$/i);

    const modalHtml = `
        <div id="mediaPopupModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:9999; display:flex; align-items:center; justify-content:center;">
            <span class="material-icons-round" style="position:absolute; top:20px; right:20px; color:#fff; font-size:32px; cursor:pointer; z-index:10001;" onclick="document.getElementById('mediaPopupModal').remove()">close</span>
            
            <button onclick="changeGalleryItem(-1)" style="position:absolute; left:10px; background:none; border:none; color:white; z-index:10001;"><span class="material-icons-round" style="font-size:48px;">chevron_left</span></button>
            <button onclick="changeGalleryItem(1)" style="position:absolute; right:10px; background:none; border:none; color:white; z-index:10001;"><span class="material-icons-round" style="font-size:48px;">chevron_right</span></button>

            <div id="galleryContent" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
                ${isVideo ? 
                    `<video src="${item.url}" controls autoplay style="max-width:95%; max-height:90vh;"></video>` : 
                    `<img src="${item.url}" style="max-width:95%; max-height:90vh; object-fit:contain; border-radius:4px;">`
                }
            </div>
            
            <div style="position:absolute; bottom:20px; color:white; font-size:12px; font-weight:bold;">
                ${currentGalleryIndex + 1} / ${channelMediaGallery.length}
            </div>
        </div>`;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.changeGalleryItem = function(direction) {
    currentGalleryIndex += direction;
    if (currentGalleryIndex < 0) currentGalleryIndex = channelMediaGallery.length - 1;
    if (currentGalleryIndex >= channelMediaGallery.length) currentGalleryIndex = 0;
    renderGalleryModal();
};

async function initChannelTab() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        window.appSettings = data;
        
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
        
        // Reset and populate the global media gallery list for swiping
        channelMediaGallery = data.data
            .filter(m => m.image_url && m.image_url !== 'null' && m.image_url !== 'undefined')
            .map(m => ({ url: m.image_url, id: m.id }));

        const chatObj = document.getElementById('channelChatView');
        chatObj.innerHTML = '';
        
        const pinnedBar = document.getElementById('channelPinnedMsgBar');

        if (data.data.length === 0) {
            chatObj.innerHTML = '<div class="text-center text-muted mt-4" style="font-size:12px;">No messages yet.</div>';
            if (pinnedBar) pinnedBar.style.display = 'none';
            return;
        }

        let pinnedMsgs = data.data.filter(m => m.is_pinned);
        let latestPinned = pinnedMsgs.length > 0 ? pinnedMsgs[pinnedMsgs.length - 1] : null;
        
        if (latestPinned && pinnedBar) {
            pinnedBar.style.display = 'block';
            const pinnedTitleSafe = latestPinned.body ? String(latestPinned.body).substring(0, 40).replace(/[\*\_~`]/g, '') + '...' : 'Pinned Message';
            const pinnedText = document.getElementById('channelPinnedMsgText');
            if (pinnedText) pinnedText.innerText = pinnedTitleSafe;
            pinnedBar.onclick = () => {
                const target = document.getElementById(`msg-${latestPinned.id}`);
                if(target) target.scrollIntoView({behavior: 'smooth', block: 'center'});
            };
        } else if (pinnedBar) { 
            pinnedBar.style.display = 'none'; 
        }

        let html = '';
        const isAdminRole = (typeof userData !== 'undefined' && (userData.role === 'admin' || userData.role === 'manager'));

        data.data.forEach(m => {
            const dateStr = new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            
            // --- MEDIA RENDERING FIRST ---
            let mediaHtml = '';
            if (m.image_url && m.image_url !== 'null' && m.image_url !== 'undefined') {
                const safeImgUrl = String(m.image_url);
                const galleryIndex = channelMediaGallery.findIndex(item => item.id === m.id);
                const isVideo = safeImgUrl.match(/\.(mp4|mov|webm|ogg)$/i);
                
                if (isVideo) {
                    mediaHtml = `<video src="${safeImgUrl}" controls style="max-width: 100%; border-radius: 8px; margin-bottom: 8px; cursor: pointer;" onclick="openSwipeGallery(${galleryIndex})"></video>`;
                } else {
                    mediaHtml = `<img src="${safeImgUrl}" style="max-width: 100%; border-radius: 8px; margin-bottom: 8px; cursor: pointer;" onclick="openSwipeGallery(${galleryIndex})" onerror="this.style.display='none'">`;
                }
            }
            
            let linkHtml = m.link_url ? `<a href="${m.link_url}" target="_blank" class="chat-link mt-2" style="font-size:11px;">${m.link_url}</a>` : '';

            const safeBody = String(m.body || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n');
            const safeLink = String(m.link_url || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            
            const formattedBodyHtml = parseMarkdownToHtml(m.body);

            const replySnippet = m.reply_to_id ? `
                <div style="border-left: 3px solid var(--blue); background: rgba(0,0,0,0.04); padding: 4px 8px; border-radius: 4px; margin-bottom: 6px; font-size: 11px; cursor: pointer;" onclick="const t = document.getElementById('msg-${m.reply_to_id}'); if(t) t.scrollIntoView({behavior:'smooth', block:'center'});">
                    <div style="font-weight:bold; color:var(--blue);">Reply</div>
                    <div style="color:#555; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.reply_body_snippet ? String(m.reply_body_snippet).replace(/[\*\_~`]/g, '') : 'Deleted'}</div>
                </div>
            ` : '';

            const pinIcon = m.is_pinned ? `<span class="material-icons-round text-primary ms-2" style="font-size: 14px; vertical-align: middle;">push_pin</span>` : '';

            let optionsMenu = '';
            if (isAdminRole) {
                optionsMenu = `
                <div class="dropdown float-end z-3">
                    <span class="material-icons-round text-muted" style="font-size: 18px; cursor: pointer; padding: 2px;" data-bs-toggle="dropdown">more_vert</span>
                    <ul class="dropdown-menu dropdown-menu-end shadow-sm" style="font-size: 12px; min-width: 120px;">
                        <li><a class="dropdown-item" href="#" onclick="replyChannelMsg(${m.id}, '${safeBody.substring(0,30)}')"><span class="material-icons-round align-middle me-2" style="font-size:16px;">reply</span>Reply</a></li>
                        <li><a class="dropdown-item" href="#" onclick="editChannelMsgInit(${m.id}, '${safeBody}', '${safeLink}')"><span class="material-icons-round align-middle me-2" style="font-size:16px;">edit</span>Edit</a></li>
                        <li><a class="dropdown-item" href="#" onclick="togglePinChannelMsg(${m.id}, ${!m.is_pinned})"><span class="material-icons-round align-middle me-2" style="font-size:16px;">${m.is_pinned ? 'push_pin' : 'push_pin'}</span>${m.is_pinned ? 'Unpin' : 'Pin'}</a></li>
                        <li><hr class="dropdown-divider"></li>
                        <li><a class="dropdown-item text-danger" href="#" onclick="deleteChannelMsg(${m.id})"><span class="material-icons-round align-middle me-2" style="font-size:16px;">delete</span>Delete</a></li>
                    </ul>
                </div>`;
            }

            html += `
            <div id="msg-${m.id}" class="chat-bubble mb-3 w-100 shadow-sm" style="background-color: #fff; max-width: 90%; align-self: flex-start; border: 1px solid var(--border-color); border-radius: 12px; border-bottom-left-radius: 0; padding: 10px 14px; position:relative;">
                ${optionsMenu}
                <div class="d-flex justify-content-between mb-1 border-bottom pb-1 ${isAdminRole ? 'pe-4' : ''}">
                    <span style="font-size: 10px; font-weight: 900; color: var(--blue); text-transform: uppercase;"><span class="material-icons-round" style="font-size: 12px; vertical-align: text-top; margin-right: 2px;">verified</span>ADMIN</span>
                    <span style="font-size: 9px; color: var(--text-secondary);">${dateStr}${pinIcon}</span>
                </div>
                ${replySnippet}

                ${mediaHtml}

                <div class="chat-body mt-1" style="font-size: 13px; color: #333; line-height: 1.5;">${formattedBodyHtml}</div>
                ${linkHtml}
            </div>`;
        });
        
        chatObj.innerHTML = html;
        chatObj.scrollTop = chatObj.scrollHeight;
    } catch(e) { console.log(e) }
}

window.replyChannelMsg = function(id, snippet) {
    const preview = document.getElementById('channelReplyPreview');
    if (preview) {
        preview.style.display = 'block';
        preview.style.backgroundColor = '#e3f2fd';
        preview.style.borderLeftColor = 'var(--blue)';
        document.getElementById('channelReplyModeText').innerHTML = 'Replying to... <span class="material-icons-round float-end text-muted" style="font-size:14px; cursor:pointer;" onclick="cancelChannelReplyEdit()">close</span>';
        document.getElementById('channelReplyText').innerText = String(snippet).replace(/[\*\_~`]/g, '') + '...';
    }

    const replyIdEl = document.getElementById('activeReplyId');
    if(replyIdEl) replyIdEl.value = id;
    
    const editIdEl = document.getElementById('activeEditMsgId');
    if(editIdEl) editIdEl.value = '';
    
    const bodyEl = document.getElementById('channelMsgBody');
    if(bodyEl) bodyEl.focus();
};

window.editChannelMsgInit = function(id, body, url) {
    const preview = document.getElementById('channelReplyPreview');
    if (preview) {
        preview.style.display = 'block';
        preview.style.backgroundColor = '#fff3cd';
        preview.style.borderLeftColor = '#ffc107';
        document.getElementById('channelReplyModeText').innerHTML = 'Editing message... <span class="material-icons-round float-end text-muted" style="font-size:14px; cursor:pointer;" onclick="cancelChannelReplyEdit()">close</span>';
        document.getElementById('channelReplyText').innerText = String(body).substring(0,40).replace(/[\*\_~`]/g, '') + '...';
    }

    const editIdEl = document.getElementById('activeEditMsgId');
    if(editIdEl) editIdEl.value = id;
    
    const replyIdEl = document.getElementById('activeReplyId');
    if(replyIdEl) replyIdEl.value = '';
    
    document.getElementById('channelMsgBody').value = body;
    
    const urlEl = document.getElementById('channelMsgUrl');
    if(urlEl) urlEl.value = url || '';
    
    const submitBtn = document.getElementById('btnChannelSubmit');
    if(submitBtn) submitBtn.innerHTML = '<span class="material-icons-round" style="font-size:18px; margin-left:4px;">check</span>';
};

window.cancelChannelReplyEdit = function() {
    const preview = document.getElementById('channelReplyPreview');
    if(preview) preview.style.display = 'none';
    
    const replyIdEl = document.getElementById('activeReplyId');
    if(replyIdEl) replyIdEl.value = '';
    
    const editIdEl = document.getElementById('activeEditMsgId');
    if(editIdEl) editIdEl.value = '';
    
    const submitBtn = document.getElementById('btnChannelSubmit');
    if(submitBtn) submitBtn.innerHTML = '<span class="material-icons-round" style="font-size:18px; margin-left:4px;">send</span>';
    
    const form = document.getElementById('formChannelMessage');
    if(form) form.reset();
};

window.deleteChannelMsg = async function(id) {
    if(!confirm("Are you sure you want to delete this message?")) return;
    try { await fetch(`/api/channels/messages/${id}`, { method: 'DELETE', credentials: 'same-origin' }); } catch(e) {}
};

window.togglePinChannelMsg = async function(id, isPinned) {
    try {
        await fetch(`/api/channels/messages/${id}/pin`, { 
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_pinned: isPinned }), credentials: 'same-origin' 
        });
    } catch(e) {}
};

const formChannelMsg = document.getElementById('formChannelMessage');
if (formChannelMsg) {
    formChannelMsg.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnChannelSubmit');
        if (btn) btn.disabled = true;

        const id = document.getElementById('activeChannelId').value;
        const editIdEl = document.getElementById('activeEditMsgId');
        const replyIdEl = document.getElementById('activeReplyId');
        const editId = editIdEl ? editIdEl.value : '';
        const replyId = replyIdEl ? replyIdEl.value : '';

        try {
            const formData = new FormData();
            formData.append('body', document.getElementById('channelMsgBody').value);
            formData.append('link_url', document.getElementById('channelMsgUrl').value);
            
            const imageEl = document.getElementById('channelMsgImage');
            if (imageEl && imageEl.files[0]) formData.append('image', imageEl.files[0]);

            if (editId) {
                // EDIT EXISTING MESSAGE (With potential new media)
                await fetch(`/api/channels/messages/${editId}`, {
                    method: 'PUT',
                    body: formData,
                    credentials: 'same-origin'
                });
            } else {
                // NEW MESSAGE
                if (replyId) formData.append('reply_to_id', replyId);
                await fetch(`/api/channels/${id}/messages`, { method: 'POST', body: formData, credentials: 'same-origin' });
            }
            
            cancelChannelReplyEdit(); 
            const adv = document.getElementById('advancedChannelOptions');
            if (adv && adv.classList.contains('show')) new bootstrap.Collapse(adv).hide();
        } catch(e) { console.error("Submit Error:", e); } 
        finally { if (btn) btn.disabled = false; }
    });
}

if (typeof socket !== 'undefined') {
    const channelSound = new Audio('/chaching.mp3'); 
    socket.on('new_channel_msg', (data) => {
        if (typeof userData !== 'undefined' && userData.role !== 'admin' && userData.role !== 'manager') {
            if (window.appSettings && window.appSettings.show_channel_tab === 'false') return;
        }
        channelSound.play().catch(e => { console.log("Sound autoplay blocked"); });
        if (currentChannelId == data.channel_id) {
            fetchChannelMessages(currentChannelId);
        }
    });

    socket.on('channel_msg_update', (data) => {
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
            display_order: document.getElementById('adminChannelOrder').value || 0,
            telegram_chat_id: document.getElementById('adminChannelTelegram') ? document.getElementById('adminChannelTelegram').value : ''
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
            const tgId = c.telegram_chat_id || '';
            
            html += `<tr>
                <td><b style="color:var(--blue);">${c.name}</b> <span class="ms-1">${visBadge}</span><br><span class="text-muted">${c.access_level} | Order: ${order}</span></td>
                <td class="text-end align-middle">
                    <button class="btn btn-sm text-primary p-0 me-2" onclick="openEditChannelModal(${c.id}, '${safeName}', '${safeDesc}', '${c.access_level}', ${showHome}, '${dashVis}', ${order}, '${tgId}')"><span class="material-icons-round" style="font-size:16px;">edit</span></button>
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

window.openEditChannelModal = function(id, name, desc, level, showHome, dashVis, order, tgId) {
    document.getElementById('editChannelId').value = id;
    document.getElementById('editChannelName').value = name;
    document.getElementById('editChannelDesc').value = desc;
    document.getElementById('editChannelLevel').value = level;
    document.getElementById('editChannelShowHome').value = showHome ? 'true' : 'false';
    document.getElementById('editChannelDashVis').value = dashVis;
    document.getElementById('editChannelOrder').value = order;
    
    const editChannelTelegram = document.getElementById('editChannelTelegram');
    if(editChannelTelegram) editChannelTelegram.value = tgId || '';
    
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
            display_order: document.getElementById('editChannelOrder').value || 0,
            telegram_chat_id: document.getElementById('editChannelTelegram') ? document.getElementById('editChannelTelegram').value : ''
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

// --- TEXT FORMATTING & EMOJIS FOR CHANNEL MESSAGES ---

window.formatChannelText = function(prefix, suffix) {
    const textarea = document.getElementById('channelMsgBody');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);

    const before = text.substring(0, start);
    const after = text.substring(end, text.length);

    // Wrap the selected text with the styling markers
    textarea.value = before + prefix + selectedText + suffix + after;

    // Reset selection and focus back inside
    textarea.selectionStart = start + prefix.length;
    textarea.selectionEnd = end + prefix.length;
    textarea.focus();
    
    // Trigger input event to auto-resize textarea
    textarea.dispatchEvent(new Event('input')); 
};

window.formatChannelLink = function() {
    const url = prompt("Enter the URL link:");
    if (!url) return;
    window.formatChannelText('[', `](${url})`);
};

window.insertChannelEmoji = function(emoji) {
    const textarea = document.getElementById('channelMsgBody');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + emoji + text.substring(end, text.length);

    textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
};

function initEmojiPicker() {
    const grid = document.getElementById('emojiPickerGrid');
    if (grid) {
        // Essential trading and chatting emojis
        const emojis = ['👍', '❤️', '🔥', '🚀', '✅', '❌', '⚠️', '📈', '📉', '💰', '💎', '🎉', '🚨', '👀', '🟢', '🔴', '🤔', '😅', '🙌', '💯', '💸', '🏆', '🎯', '⏳'];
        grid.innerHTML = emojis.map(e => 
            `<button type="button" class="btn btn-light btn-sm border-0" style="font-size: 18px; padding: 4px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;" onclick="insertChannelEmoji('${e}')">${e}</button>`
        ).join('');
    }
}

// Initialize picker
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEmojiPicker);
} else {
    initEmojiPicker();
}
