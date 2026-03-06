let currentChannelId = null;
let channelsList = [];

// 1. Fetch & Render Channels
async function loadChannels() {
    try {
        const res = await fetch('/api/channels', { credentials: 'same-origin' });
        const data = await res.json();
        if (data.success) {
            channelsList = data.data;
            renderChannelsList();
            
            // Check global settings to hide/show the tab
            const settingsRes = await fetch('/api/settings');
            const settings = await settingsRes.json();
            const role = localStorage.getItem('userRole'); // <--- CRASH FIX
            
            if (settings.show_channels_tab === 'true') {
                document.getElementById('navChannelsBtn').style.display = 'flex';
            } else if (role === 'admin') {
                document.getElementById('navChannelsBtn').style.display = 'flex'; // Admins always see it
            }
            
            // Update Global Notification Badge
            const totalUnread = channelsList.reduce((acc, ch) => acc + (ch.unread_count || 0), 0);
            const badge = document.getElementById('channelsUnreadBadge');
            if (badge) badge.style.display = totalUnread > 0 ? 'block' : 'none';
        }
    } catch (e) { console.error("Error loading channels:", e); }
}

function renderChannelsList() {
    const container = document.getElementById('channelsList');
    container.innerHTML = '';

    if (channelsList.length === 0) {
        container.innerHTML = '<div class="text-muted text-center mt-4" style="font-size: 12px;">No channels available.</div>';
        return;
    }

    channelsList.forEach(ch => {
        const unreadBadge = ch.unread_count > 0 ? `<span class="badge bg-primary rounded-pill ms-2">${ch.unread_count}</span>` : '';
        const isActive = ch.id === currentChannelId ? 'bg-light border-primary border-start border-4' : 'border-start border-4 border-transparent';
        
        container.innerHTML += `
            <div class="channel-item p-3 mb-2 rounded shadow-sm d-flex align-items-center" 
                 style="cursor: pointer; transition: 0.2s; background: #fff; ${isActive.includes('bg-light') ? 'border-left-color: var(--blue) !important;' : 'border-left-color: transparent;'}"
                 onclick="openChannel(${ch.id}, '${ch.name.replace(/'/g, "\\'")}', '${(ch.description || '').replace(/'/g, "\\'")}')">
                <div class="bg-primary text-white rounded-circle d-flex justify-content-center align-items-center fw-bold shadow-sm" style="width: 45px; height: 45px; font-size: 18px;">
                    ${ch.name.charAt(0).toUpperCase()}
                </div>
                <div class="ms-3 flex-grow-1 overflow-hidden">
                    <h6 class="mb-0 fw-bold text-truncate" style="font-size: 14px;">${ch.name}</h6>
                    <small class="text-muted text-truncate d-block" style="font-size: 11px;">${ch.description || 'Broadcast Channel'}</small>
                </div>
                ${unreadBadge}
            </div>
        `;
    });
}

// 2. Open Channel & Load Messages
async function openChannel(id, name, desc) {
    currentChannelId = id;
    document.getElementById('activeChannelName').innerText = name;
    document.getElementById('activeChannelDesc').innerText = desc || 'Broadcast Channel';
    
    // Mobile View Switching
    document.getElementById('channelListWrapper').classList.add('d-none', 'd-md-flex');
    document.getElementById('channelChatWrapper').classList.remove('d-none');
    
    // Show input box ONLY if Manager or Admin
    const role = localStorage.getItem('userRole'); // <--- CRASH FIX
    if (role === 'admin' || role === 'manager') {
        document.getElementById('chatInputArea').style.display = 'block';
    } else {
        document.getElementById('chatInputArea').style.display = 'none';
    }

    const chatArea = document.getElementById('chatMessagesArea');
    chatArea.innerHTML = '<div class="text-center mt-4"><div class="spinner-border text-primary spinner-border-sm"></div></div>';

    try {
        const res = await fetch(`/api/channels/${id}/messages`, { credentials: 'same-origin' });
        const data = await res.json();
        
        chatArea.innerHTML = '';
        if (data.data.length === 0) {
            chatArea.innerHTML = '<div class="text-center text-muted mt-5" style="font-size: 12px; background: rgba(0,0,0,0.05); padding: 10px; border-radius: 20px; display: inline-block; margin: 0 auto;">No messages yet.</div>';
            chatArea.style.textAlign = 'center';
        } else {
            chatArea.style.textAlign = 'left';
            data.data.forEach(msg => appendMessage(msg));
            scrollToBottom();
        }

        // Clear local unread badge
        const ch = channelsList.find(c => c.id === id);
        if (ch) ch.unread_count = 0;
        renderChannelsList();

        // Update Global Badge
        const totalUnread = channelsList.reduce((acc, ch) => acc + (ch.unread_count || 0), 0);
        const badge = document.getElementById('channelsUnreadBadge');
        if (badge) badge.style.display = totalUnread > 0 ? 'block' : 'none';

    } catch (e) { chatArea.innerHTML = '<div class="text-danger text-center mt-4">Failed to load messages.</div>'; }
}

function closeMobileChat() {
    document.getElementById('channelListWrapper').classList.remove('d-none');
    document.getElementById('channelChatWrapper').classList.add('d-none');
}

// 3. Render a Message Bubble
function appendMessage(msg) {
    const chatArea = document.getElementById('chatMessagesArea');
    if (chatArea.querySelector('#chatEmptyState')) chatArea.innerHTML = '';
    if (chatArea.innerHTML.includes('spinner-border')) chatArea.innerHTML = ''; // Remove loading spinner

    const timeString = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedText = formatTelegramMarkdown(msg.message_text || '');
    
    let mediaHtml = '';
    if (msg.media_url) {
        mediaHtml = `<img src="${msg.media_url}" class="img-fluid rounded mb-2 w-100" style="max-height: 400px; object-fit: contain; background: #000; cursor:pointer;" onclick="window.open('${msg.media_url}', '_blank')">`;
    }

    const role = localStorage.getItem('userRole'); // <--- CRASH FIX
    const deleteBtn = (role === 'admin' || role === 'manager') 
        ? `<span class="material-icons-round text-danger float-end" style="font-size: 16px; cursor:pointer; opacity: 0.5;" onclick="deleteChannelMsg(${msg.id})">delete</span>` 
        : '';

    const msgHtml = `
        <div class="card mb-3 border-0 shadow-sm w-100" id="chanMsg-${msg.id}" style="border-radius: 12px; overflow: hidden;">
            <div class="card-body p-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="fw-bold text-primary" style="font-size: 13px;">${msg.sender_name}</span>
                    ${deleteBtn}
                </div>
                ${mediaHtml}
                <div class="text-dark" style="font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word;">${formattedText}</div>
                <div class="text-end text-muted mt-2" style="font-size: 10px;">
                    ${timeString}
                </div>
            </div>
        </div>
    `;
    chatArea.insertAdjacentHTML('beforeend', msgHtml);
}

// 4. Telegram Markdown Formatter
function formatTelegramMarkdown(text) {
    if (!text) return '';
    let html = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') 
        .replace(/\*(.*?)\*/g, '<strong>$1</strong>')       
        .replace(/__(.*?)__/g, '<em>$1</em>')             
        .replace(/_(.*?)_/g, '<em>$1</em>')                 
        .replace(/~~(.*?)~~/g, '<del>$1</del>')             
        .replace(/~(.*?)~/g, '<del>$1</del>');              
    
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return html.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: var(--blue); text-decoration: underline;">$1</a>');
}

// 5. Smart Input Box (Auto-expand) & Attachments
const chatInput = document.getElementById('chatTextInput');
if (chatInput) {
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight < 120 ? this.scrollHeight : 120) + 'px';
        if(this.value === '') this.style.height = 'auto';
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

function clearChatImage() {
    document.getElementById('chatImageInput').value = '';
    document.getElementById('chatImagePreviewContainer').style.display = 'none';
}

function scrollToBottom() {
    const area = document.getElementById('chatMessagesArea');
    area.scrollTop = area.scrollHeight;
}

// 6. Send Message
document.getElementById('formSendChannelMsg')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentChannelId) return;

    const text = document.getElementById('chatTextInput').value;
    const fileInput = document.getElementById('chatImageInput');
    
    if (!text.trim() && (!fileInput.files || fileInput.files.length === 0)) return;

    const btn = document.getElementById('btnSendChat');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:1rem;height:1rem;"></span>';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('message_text', text);
    if (fileInput.files[0]) formData.append('media', fileInput.files[0]);

    try {
        const res = await fetch(`/api/channels/${currentChannelId}/messages`, { method: 'POST', body: formData, credentials: 'same-origin' });
        if (res.ok) {
            document.getElementById('chatTextInput').value = '';
            document.getElementById('chatTextInput').style.height = 'auto';
            clearChatImage();
        }
    } catch (err) { alert("Failed to send message."); }
    finally {
        btn.innerHTML = '<span class="material-icons-round" style="margin-left:3px;">send</span>';
        btn.disabled = false;
    }
});

// 7. Delete Message
async function deleteChannelMsg(msgId) {
    if (!confirm("Delete this message for everyone?")) return;
    try {
        await fetch(`/api/channels/messages/${msgId}`, { method: 'DELETE', credentials: 'same-origin' });
    } catch (e) {}
}

// 8. Create Channel (Admin)
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
        const res = await fetch('/api/channels', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data), credentials: 'same-origin' });
        if (res.ok) {
            const m = bootstrap.Modal.getInstance(document.getElementById('createChannelModal'));
            if(m) m.hide();
            e.target.reset();
            loadChannels();
        } else { alert("Failed to create channel."); }
    } catch(e) {}
    finally { btn.innerText = "Create Channel"; btn.disabled = false; }
});

// 9. Socket Listeners for Real-Time Updates
if (typeof io !== 'undefined') {
    const chanSocket = typeof socket !== 'undefined' ? socket : io();
    
    chanSocket.on('new_channel_message', (msg) => {
        if (currentChannelId === msg.channel_id) {
            appendMessage(msg);
            scrollToBottom();
        } else {
            loadChannels(); 
        }
    });

    chanSocket.on('channel_message_deleted', (data) => {
        const msgEl = document.getElementById(`chanMsg-${data.id}`);
        if (msgEl) msgEl.remove();
    });
}
