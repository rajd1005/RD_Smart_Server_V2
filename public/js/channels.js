let currentChannelId = null;
let channelsList = [];
let pinnedMsgId = null;
let lastMessageId = 0;
let pullInterval = null;

async function loadChannels() {
    try {
        const res = await fetch('/api/channels', { credentials: 'same-origin' });
        const data = await res.json();
        if (data.success) {
            channelsList = data.data;
            renderChannelsList();
            
            const settingsRes = await fetch('/api/settings');
            const settings = await settingsRes.json();
            const role = localStorage.getItem('userRole'); 
            
            if (settings.show_channels_tab === 'true' || role === 'admin') {
                document.getElementById('navChannelsBtn').style.display = 'flex';
            }
            
            const totalUnread = channelsList.reduce((acc, ch) => acc + (ch.unread_count || 0), 0);
            const badge = document.getElementById('channelsUnreadBadge');
            if (badge) badge.style.display = totalUnread > 0 ? 'block' : 'none';
        }
    } catch (e) { console.error(e); }
}

function renderChannelsList() {
    const container = document.getElementById('channelsList');
    container.innerHTML = '';
    if (channelsList.length === 0) return container.innerHTML = '<div class="text-muted text-center mt-4" style="font-size: 12px;">No channels available.</div>';

    channelsList.forEach(ch => {
        const unreadBadge = ch.unread_count > 0 ? `<span class="badge bg-primary rounded-pill ms-2" style="font-size:10px;">${ch.unread_count}</span>` : '';
        const isActive = ch.id === currentChannelId ? 'bg-light border-primary' : 'border-transparent';
        
        const role = localStorage.getItem('userRole'); 
        const adminControls = (role === 'admin') ?
            `<div class="dropdown ms-auto">
                <span class="material-icons-round text-muted p-1" data-bs-toggle="dropdown" style="font-size:18px; cursor:pointer;" onclick="event.stopPropagation()">more_vert</span>
                <ul class="dropdown-menu dropdown-menu-end shadow-sm" style="font-size: 12px;">
                    <li><a class="dropdown-item py-1" href="#" onclick="openEditChannelModal(${ch.id}, '${ch.name.replace(/'/g, "\\'")}', '${(ch.description || '').replace(/'/g, "\\'")}', '${ch.required_level}', '${ch.telegram_chat_id || ''}'); event.stopPropagation();">Edit Channel</a></li>
                    <li><hr class="dropdown-divider my-1"></li>
                    <li><a class="dropdown-item py-1 text-danger" href="#" onclick="deleteChannelAdmin(${ch.id}); event.stopPropagation();">Delete Channel</a></li>
                </ul>
            </div>` : '';

        container.innerHTML += `
            <div class="p-2 mb-1 rounded d-flex align-items-center border-start border-3 ${isActive}" 
                 style="cursor: pointer; transition: 0.2s; background: #fff;"
                 onclick="openChannel(${ch.id}, '${ch.name.replace(/'/g, "\\'")}', '${(ch.description || '').replace(/'/g, "\\'")}')">
                <div class="bg-primary text-white rounded-circle d-flex justify-content-center align-items-center fw-bold shadow-sm flex-shrink-0" style="width: 38px; height: 38px; font-size: 16px;">
                    ${ch.name.charAt(0).toUpperCase()}
                </div>
                <div class="ms-2 flex-grow-1 overflow-hidden">
                    <h6 class="mb-0 fw-bold text-truncate" style="font-size: 13px;">${ch.name}</h6>
                    <small class="text-muted text-truncate d-block" style="font-size: 10px;">${ch.description || 'Broadcast'}</small>
                </div>
                ${unreadBadge}
                ${adminControls}
            </div>
        `;
    });
}

async function pullNewMessages() {
    if (!currentChannelId) return;
    try {
        const res = await fetch(`/api/channels/${currentChannelId}/messages?after=${lastMessageId}`, { credentials: 'same-origin' });
        const data = await res.json();
        if (data.success && data.data.length > 0) {
            const chatArea = document.getElementById('chatMessagesArea');
            if (chatArea.querySelector('#chatEmptyState')) chatArea.innerHTML = '';
            
            data.data.forEach(msg => {
                if(msg.is_pinned) showPinnedBanner(msg.id, msg.message_text);
                const existing = document.getElementById(`chanMsg-${msg.id}`);
                if (!existing) { chatArea.insertAdjacentHTML('beforeend', renderMessageHTML(msg)); }
                if (msg.id > lastMessageId) lastMessageId = msg.id;
            });
            scrollToBottom();
        }
    } catch(e){}
}

async function openChannel(id, name, desc) {
    currentChannelId = id;
    pinnedMsgId = null;
    lastMessageId = 0;
    
    document.getElementById('activeChannelName').innerText = name;
    document.getElementById('activeChannelDesc').innerText = desc || 'Broadcast Channel';
    document.getElementById('channelListWrapper').classList.add('d-none', 'd-md-flex');
    document.getElementById('channelChatWrapper').classList.remove('d-none');
    
    const role = localStorage.getItem('userRole'); 
    document.getElementById('chatInputArea').style.display = (role === 'admin' || role === 'manager') ? 'block' : 'none';
    document.querySelectorAll('.admin-only-btn').forEach(el => el.style.display = (role === 'admin' || role === 'manager') ? 'block' : 'none');

    const chatArea = document.getElementById('chatMessagesArea');
    chatArea.innerHTML = '<div class="text-center mt-4 m-auto"><div class="spinner-border text-primary spinner-border-sm"></div></div>';
    
    hidePinnedBanner();
    cancelChatAction();
    if(pullInterval) clearInterval(pullInterval);

    try {
        const res = await fetch(`/api/channels/${id}/messages`, { credentials: 'same-origin' });
        const data = await res.json();
        
        chatArea.innerHTML = '';
        if (data.data.length === 0) {
            chatArea.innerHTML = '<div class="text-center text-muted m-auto" style="font-size: 12px;" id="chatEmptyState">No messages yet.</div>';
        } else {
            data.data.forEach(msg => {
                if(msg.id > lastMessageId) lastMessageId = msg.id;
                if(msg.is_pinned) showPinnedBanner(msg.id, msg.message_text);
                chatArea.insertAdjacentHTML('beforeend', renderMessageHTML(msg));
            });
            setTimeout(scrollToBottom, 100);
        }

        const ch = channelsList.find(c => c.id === id);
        if (ch) ch.unread_count = 0;
        renderChannelsList();

        pullInterval = setInterval(pullNewMessages, 3000); 

    } catch (e) { chatArea.innerHTML = '<div class="text-danger m-auto">Failed to load.</div>'; }
}

function closeMobileChat() {
    document.getElementById('channelListWrapper').classList.remove('d-none');
    document.getElementById('channelChatWrapper').classList.add('d-none');
    if(pullInterval) clearInterval(pullInterval);
}

function showPinnedBanner(id, text) {
    pinnedMsgId = id;
    document.getElementById('pinnedMessageBanner').style.setProperty('display', 'flex', 'important');
    document.getElementById('pinnedMessageText').innerText = text || 'Media Message';
}
function hidePinnedBanner() {
    pinnedMsgId = null;
    document.getElementById('pinnedMessageBanner').style.setProperty('display', 'none', 'important');
}
window.unpinMessage = function(e) { 
    if(e) e.stopPropagation(); 
    if(pinnedMsgId) fetch(`/api/channels/messages/${pinnedMsgId}/pin`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({is_pinned: false}) }); 
};
function scrollToPinned() { if(pinnedMsgId) document.getElementById(`chanMsg-${pinnedMsgId}`)?.scrollIntoView({behavior:'smooth'}); }
function toggleScheduleControls() { const el = document.getElementById('chatScheduleControls'); el.style.setProperty('display', el.style.display === 'none' ? 'flex' : 'none', 'important'); }

window.replyToMsg = function(id, text) {
    document.getElementById('chatReplyMsgId').value = id;
    document.getElementById('chatEditMsgId').value = '';
    document.getElementById('chatActionBanner').style.setProperty('display', 'flex', 'important');
    document.getElementById('chatActionTitle').innerText = 'Replying to...';
    document.getElementById('chatActionText').innerText = text || 'Media';
    document.getElementById('chatTextInput').focus();
};

window.editMsg = function(id, text) {
    document.getElementById('chatEditMsgId').value = id;
    document.getElementById('chatReplyMsgId').value = '';
    document.getElementById('chatActionBanner').style.setProperty('display', 'flex', 'important');
    document.getElementById('chatActionTitle').innerText = 'Editing message...';
    document.getElementById('chatActionTitle').classList.replace('text-primary', 'text-warning');
    document.getElementById('chatActionText').innerText = text || '';
    document.getElementById('chatTextInput').value = text || '';
    document.getElementById('chatTextInput').focus();
};

window.pinMsg = function(id, pinState) { fetch(`/api/channels/messages/${id}/pin`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({is_pinned: pinState}) }); };

function cancelChatAction() {
    document.getElementById('chatReplyMsgId').value = '';
    document.getElementById('chatEditMsgId').value = '';
    document.getElementById('chatActionBanner').style.setProperty('display', 'none', 'important');
    document.getElementById('chatActionTitle').classList.replace('text-warning', 'text-primary');
    document.getElementById('chatTextInput').value = '';
}

function renderMessageHTML(msg) {
    const timeString = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedText = formatTelegramMarkdown(msg.message_text || '');
    
    let mediaHtml = msg.media_url ? `<img src="${msg.media_url}" class="img-fluid rounded mb-2 w-100" style="max-height: 250px; object-fit: cover; cursor:pointer;" onclick="window.open('${msg.media_url}', '_blank')">` : '';
    let replyHtml = '';
    if (msg.reply_to_id && msg.reply_text !== undefined) {
        replyHtml = `<div class="bg-light p-2 mb-2 rounded" style="border-left: 3px solid var(--blue); font-size:11px; cursor:pointer;" onclick="document.getElementById('chanMsg-${msg.reply_to_id}')?.scrollIntoView({behavior:'smooth'})">
            <div class="fw-bold text-primary">${msg.reply_sender || 'User'}</div>
            <div class="text-truncate text-muted">${msg.reply_text || 'Media'}</div>
        </div>`;
    }

    const role = localStorage.getItem('userRole'); 
    let actionMenu = '';
    if (role === 'admin' || role === 'manager') {
        const safeText = (msg.message_text || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        actionMenu = `
        <div class="dropdown float-end ms-2">
            <span class="material-icons-round text-muted" data-bs-toggle="dropdown" style="font-size: 16px; cursor:pointer;">more_vert</span>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm" style="font-size: 12px; min-width: 120px;">
                <li><a class="dropdown-item py-1" href="#" onclick="replyToMsg(${msg.id}, '${safeText}')">Reply</a></li>
                <li><a class="dropdown-item py-1" href="#" onclick="editMsg(${msg.id}, '${safeText}')">Edit</a></li>
                <li><a class="dropdown-item py-1" href="#" onclick="pinMsg(${msg.id}, ${msg.is_pinned ? 'false' : 'true'})">${msg.is_pinned ? 'Unpin' : 'Pin'}</a></li>
                <li><hr class="dropdown-divider my-1"></li>
                <li><a class="dropdown-item py-1 text-danger" href="#" onclick="deleteChannelMsg(${msg.id})">Delete</a></li>
            </ul>
        </div>`;
    }

    return `
        <div class="card mb-2 border-0 shadow-sm w-100 flex-shrink-0" id="chanMsg-${msg.id}" style="border-radius: 12px; border-bottom-left-radius: 2px;">
            <div class="card-body p-2 px-3">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <span class="fw-bold text-primary" style="font-size: 12px;">${msg.sender_name}</span>
                    ${actionMenu}
                </div>
                ${replyHtml}
                ${mediaHtml}
                <div class="text-dark" style="font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word;">${formattedText}</div>
                <div class="text-end text-muted mt-1" style="font-size: 10px;">
                    ${msg.status === 'scheduled' ? '<span class="text-warning me-1">Scheduled</span>' : ''} ${timeString}
                    ${msg.is_edited ? '<span class="fst-italic ms-1">(edited)</span>' : ''}
                </div>
            </div>
        </div>
    `;
}

function formatTelegramMarkdown(text) {
    if (!text) return '';
    let html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<strong>$1</strong>')       
                   .replace(/__(.*?)__/g, '<em>$1</em>').replace(/_(.*?)_/g, '<em>$1</em>')                 
                   .replace(/~~(.*?)~~/g, '<del>$1</del>').replace(/~(.*?)~/g, '<del>$1</del>');              
    return html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: var(--blue); text-decoration: underline;">$1</a>');
}

const chatInput = document.getElementById('chatTextInput');
if (chatInput) {
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight < 100 ? this.scrollHeight : 100) + 'px';
    });
}

function previewChatImage(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('chatImagePreview').src = e.target.result;
            document.getElementById('chatImagePreviewContainer').style.display = 'block';
        }
        reader.readAsDataURL(input.files[0]);
    }
}
function clearChatImage() { document.getElementById('chatImageInput').value = ''; document.getElementById('chatImagePreviewContainer').style.display = 'none'; }
function scrollToBottom() { const area = document.getElementById('chatMessagesArea'); area.scrollTop = area.scrollHeight; }

document.getElementById('formSendChannelMsg')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentChannelId) return;

    const text = document.getElementById('chatTextInput').value;
    const fileInput = document.getElementById('chatImageInput');
    const replyId = document.getElementById('chatReplyMsgId').value;
    const editId = document.getElementById('chatEditMsgId').value;
    const scheduleTime = document.getElementById('chanScheduleTime').value;
    const recurrence = document.getElementById('chanScheduleRecurrence').value;

    if (!text.trim() && (!fileInput.files || fileInput.files.length === 0)) return;

    const btn = document.getElementById('btnSendChat');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:1rem;height:1rem;"></span>';
    btn.disabled = true;

    try {
        if (editId) {
            await fetch(`/api/channels/messages/${editId}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ message_text: text }) });
        } else {
            const formData = new FormData();
            formData.append('message_text', text);
            if (replyId) formData.append('reply_to_id', replyId);
            if (scheduleTime) { formData.append('scheduled_for', scheduleTime); formData.append('recurrence', recurrence); }
            if (fileInput.files[0]) formData.append('media', fileInput.files[0]);
            await fetch(`/api/channels/${currentChannelId}/messages`, { method: 'POST', body: formData });
        }
        
        document.getElementById('chatTextInput').value = '';
        document.getElementById('chatTextInput').style.height = 'auto';
        document.getElementById('chanScheduleTime').value = '';
        document.getElementById('chatScheduleControls').style.setProperty('display', 'none', 'important');
        clearChatImage(); cancelChatAction(); pullNewMessages(); 
    } catch (err) { alert("Failed to process message."); }
    finally { btn.innerHTML = '<span class="material-icons-round" style="margin-left:2px; font-size:18px;">send</span>'; btn.disabled = false; }
});

window.deleteChannelMsg = async function(msgId) {
    if (!confirm("Delete this message for everyone?")) return;
    try { await fetch(`/api/channels/messages/${msgId}`, { method: 'DELETE' }); 
        document.getElementById(`chanMsg-${msgId}`)?.remove();
    } catch (e) {}
};

document.getElementById('formCreateChannel')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.innerText = "Creating..."; btn.disabled = true;
    
    const data = {
        name: document.getElementById('newChanName').value,
        description: document.getElementById('newChanDesc').value,
        required_level: document.getElementById('newChanLevel').value,
        telegram_chat_id: document.getElementById('newChanTgId').value
    };

    try {
        const res = await fetch('/api/channels', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
        if (res.ok) {
            const m = bootstrap.Modal.getInstance(document.getElementById('createChannelModal'));
            if(m) m.hide(); e.target.reset(); loadChannels();
        }
    } catch(e) {} finally { btn.innerText = "Create Channel"; btn.disabled = false; }
});

window.openEditChannelModal = function(id, name, desc, level, tgId) {
    document.getElementById('editChanId').value = id;
    document.getElementById('editChanName').value = name;
    document.getElementById('editChanDesc').value = desc;
    document.getElementById('editChanLevel').value = level;
    document.getElementById('editChanTgId').value = tgId !== 'null' ? tgId : '';
    new bootstrap.Modal(document.getElementById('editChannelModal')).show();
};

document.getElementById('formEditChannel')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editChanId').value;
    const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
    
    const data = {
        name: document.getElementById('editChanName').value,
        description: document.getElementById('editChanDesc').value,
        required_level: document.getElementById('editChanLevel').value,
        telegram_chat_id: document.getElementById('editChanTgId').value
    };

    try {
        const res = await fetch(`/api/channels/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('editChannelModal')).hide();
            loadChannels(); 
        }
    } catch(e) {} finally { btn.innerText = "Save Changes"; btn.disabled = false; }
});

window.deleteChannelAdmin = async function(id) {
    if (!confirm("DANGER: Are you sure you want to permanently delete this channel and ALL its messages?")) return;
    try {
        const res = await fetch(`/api/channels/${id}`, { method: 'DELETE' });
        if (res.ok) {
            if (currentChannelId === id) {
                currentChannelId = null;
                document.getElementById('chatMessagesArea').innerHTML = '<div class="text-center text-muted m-auto" style="font-size:12px;">Select a channel</div>';
                document.getElementById('chatInputArea').style.display = 'none';
            }
            loadChannels();
        }
    } catch (e) {}
};

if (typeof io !== 'undefined') {
    const chanSocket = typeof socket !== 'undefined' ? socket : io();
    chanSocket.on('new_channel_message', (msg) => {
        if (currentChannelId === msg.channel_id) pullNewMessages();
        else loadChannels();
    });
    chanSocket.on('channel_message_updated', (data) => {
        if (currentChannelId === data.channel_id) {
            if (data.message_text !== undefined && data.is_pinned === undefined) {
                const msgEl = document.getElementById(`chanMsg-${data.id}`);
                if (msgEl) msgEl.outerHTML = renderMessageHTML(data);
            } else if (data.is_pinned !== undefined) {
                if(data.is_pinned) showPinnedBanner(data.id, data.message_text);
                else hidePinnedBanner();
            }
        }
    });
    chanSocket.on('channel_message_deleted', (data) => {
        document.getElementById(`chanMsg-${data.id}`)?.remove();
        if (pinnedMsgId === data.id) hidePinnedBanner();
    });
}
