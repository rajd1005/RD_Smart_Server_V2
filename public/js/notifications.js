let chatNotifications = [];
let adminNotifOffset = 0;
const NOTIF_LIMIT = 15; 

socket.on('new_notification', () => {
    if (typeof fetchUserNotifications === 'function') fetchUserNotifications(false);
    if (typeof fetchChatNotifications === 'function') fetchChatNotifications(false);
    
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'block';
    
    tradeSound.play().catch(e => {});
});

// --- ADD THIS BLOCK: Listen for settings changes and refresh instantly ---
socket.on('settings_updated', () => {
    // Re-fetch the notifications immediately. 
    // Since the server logic now filters out trades based on the live setting, 
    // this will instantly remove them from the UI.
    if (typeof fetchUserNotifications === 'function') {
        fetchUserNotifications(false);
    }
    // Also re-fetch trades to clear them out if the setting was turned off
    if (typeof fetchTrades === 'function') {
        fetchTrades(); 
    }
});

async function fetchChatNotifications(loadMore = false) {
    const history = document.getElementById('chatHistory');
    if(!history) return;
    
    if (loadMore) {
        adminNotifOffset += NOTIF_LIMIT;
        const btn = document.getElementById('btnLoadMoreAdmin');
        if(btn) btn.innerText = 'Loading...';
    } else {
        adminNotifOffset = 0;
        chatNotifications = [];
    }

    try {
        const res = await fetch(`/api/admin/notifications?limit=${NOTIF_LIMIT}&offset=${adminNotifOffset}`, { credentials: 'same-origin' });
        const json = await res.json();
        
        if(json.success) {
            const fetched = json.data;
            
            if (!loadMore) chatNotifications = fetched;
            else chatNotifications = [...chatNotifications, ...fetched];
            
            if (chatNotifications.length === 0) {
                history.innerHTML = '<div class="text-center text-muted mt-3" style="font-size:12px;">No broadcasts sent yet.</div>';
                return;
            }

            const sortedForDisplay = [...chatNotifications].reverse();
            
            let html = '';
            if (fetched.length === NOTIF_LIMIT) {
                html += `<div class="text-center my-2"><button id="btnLoadMoreAdmin" class="btn btn-sm btn-outline-secondary shadow-sm" style="font-size: 11px; border-radius: 12px; padding: 4px 12px; background: #fff;" onclick="fetchChatNotifications(true)">Show More Old Broadcasts</button></div>`;
            }

            html += sortedForDisplay.map(n => {
                const dateObj = n.scheduled_for ? new Date(n.scheduled_for) : new Date(n.created_at);
                const dateStr = dateObj.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ' ' + dateObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
                
                const isScheduled = n.status === 'pending';
                const bubbleClass = isScheduled ? 'scheduled' : 'sent';
                const icon = isScheduled ? 'schedule' : 'done_all';
                const iconColor = isScheduled ? '#856404' : '#53bdeb';
                
                let targetText = '';
if (n.target_audience === 'logged_in') targetText = '🔒 Login Users';
else if (n.target_audience === 'non_logged_in') targetText = '🌐 Public Users';
else if (n.target_audience === 'both') targetText = '🌍 All Users';
else if (n.target_audience === 'login_no_level_2') targetText = '🔒 Login (No Lvl 2)';
else if (n.target_audience === 'login_no_level_3') targetText = '🔒 Login (No Lvl 3)';
else if (n.target_audience === 'login_no_level_4') targetText = '🔒 Login (No Lvl 4)';
else if (n.target_audience === 'login_with_level_2') targetText = '🔒 Login (With Lvl 2)';
else if (n.target_audience === 'login_with_level_3') targetText = '🔒 Login (With Lvl 3)';
else if (n.target_audience === 'login_with_level_4') targetText = '🔒 Login (With Lvl 4)';
else targetText = '🌍 All Users';

                let recurrenceText = '';
                if (n.recurrence === 'daily') recurrenceText = ' | 🔁 Daily';
                else if (n.recurrence === 'weekly') recurrenceText = ' | 🔁 Weekly';

                return `
                <div class="chat-bubble ${bubbleClass}">
                    <div class="chat-title">${n.title}</div>
                    <div class="chat-body">${n.body}</div>
                    ${n.url && n.url !== '/' ? `<a href="${n.url}" target="_blank" class="chat-link">${n.url}</a>` : ''}
                    <div class="chat-meta">
                    <span class="badge bg-secondary me-auto" style="font-size:8px;">${targetText}${recurrenceText}</span>
                    <span>${isScheduled ? 'Sched: ' : ''}${dateStr}</span>
                    <span class="material-icons-round" style="font-size:14px; color:${iconColor};">${icon}</span>
                    
                    <span class="material-icons-round chat-del-btn ms-2" style="color:var(--blue);" onclick='replyToPush(${JSON.stringify(n).replace(/'/g, "\\'")})' title="Reply">reply</span>
                    <span class="material-icons-round chat-del-btn ms-2" style="color:#856404;" onclick='openEditPushModal(${JSON.stringify(n).replace(/'/g, "\\'")})' title="Edit">edit</span>
                    
                    <span class="material-icons-round chat-del-btn ms-2" onclick="deleteChatPush(${n.id})" title="Delete">delete</span>
                </div>
            </div>`;
            }).join('');
            
            const oldScrollHeight = history.scrollHeight;
            history.innerHTML = html;

            if (!loadMore) history.scrollTop = history.scrollHeight;
            else history.scrollTop = history.scrollHeight - oldScrollHeight;
        }
    } catch (e) {
        if(!loadMore) history.innerHTML = '<div class="text-center text-danger mt-3" style="font-size:12px;">Error loading messages.</div>';
    }
}

const formChatPush = document.getElementById('formChatPush');

// --- NEW: Restore the last saved Target Audience for this specific user ---
if (formChatPush && typeof userData !== 'undefined' && userData.email) {
    const savedTarget = localStorage.getItem(`lastPushTarget_${userData.email}`);
    if (savedTarget) {
        const targetSelect = document.getElementById('chatPushTarget');
        if (targetSelect) {
            // Check if the saved option is still valid in the dropdown
            const optionExists = Array.from(targetSelect.options).some(opt => opt.value === savedTarget);
            if (optionExists) targetSelect.value = savedTarget;
        }
    }
}

if (formChatPush) {
    formChatPush.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnChatPushSubmit');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        const targetAudienceVal = document.getElementById('chatPushTarget').value; // Capture selected target

        const formData = new FormData();
        formData.append('target_audience', targetAudienceVal);
        formData.append('title', document.getElementById('chatPushTitle').value);
        formData.append('body', document.getElementById('chatPushBody').value);
        formData.append('url', document.getElementById('chatPushUrl').value);
        
        const scheduleTime = document.getElementById('chatPushSchedule').value;
        if (scheduleTime) formData.append('schedule_time', scheduleTime);
        
        formData.append('recurrence', document.getElementById('chatPushRecurrence').value || 'none');
        
        const imageEl = document.getElementById('chatPushImage');
        if (imageEl && imageEl.files[0]) {
            formData.append('push_image', imageEl.files[0]);
        }

        try {
            const res = await fetch('/api/admin/notifications', {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });

            if (res.ok) {
                // --- NEW: Save the selected Target Audience for this user ---
                if (typeof userData !== 'undefined' && userData.email) {
                    localStorage.setItem(`lastPushTarget_${userData.email}`, targetAudienceVal);
                }

                // Clear the form fields (but deliberately leave the target dropdown intact)
                document.getElementById('chatPushTitle').value = '';
                document.getElementById('chatPushBody').value = '';
                document.getElementById('chatPushUrl').value = '';
                document.getElementById('chatPushSchedule').value = '';
                document.getElementById('chatPushRecurrence').value = 'none';
                if (imageEl) imageEl.value = '';
                
                fetchChatNotifications(false); 
            } else {
                alert("Error sending notification.");
            }
        } catch (e) { alert("Network Error"); }
        finally { 
            btn.disabled = false; 
            btn.innerHTML = '<span class="material-icons-round" style="margin-left:4px; font-size:18px;">send</span>';
        }
    });
}

window.replyToPush = function(n) {
    const targetSelect = document.getElementById('chatPushTarget');
    if (targetSelect) {
        const optionExists = Array.from(targetSelect.options).some(opt => opt.value === n.target_audience);
        if (optionExists) targetSelect.value = n.target_audience;
    }
    
    const titleInput = document.getElementById('chatPushTitle');
    if (titleInput) {
        titleInput.value = n.title.startsWith('Re: ') ? n.title : `Re: ${n.title}`;
    }
    
    const bodyInput = document.getElementById('chatPushBody');
    if (bodyInput) {
        bodyInput.focus();
    }
    
    // Smooth scroll back to the creation form
    const form = document.getElementById('formChatPush');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
};

async function fetchScheduledPushes() {
    const list = document.getElementById('scheduledPushList');
    if(!list) return;
    list.innerHTML = '<div class="text-center text-muted p-3" style="font-size: 12px;">Loading...</div>';
    try {
        const res = await fetch('/api/admin/notifications/scheduled', { credentials: 'same-origin' });
        const json = await res.json();
        if(json.success) {
            if(json.data.length === 0) {
                list.innerHTML = '<div class="text-center text-muted p-3" style="font-size: 12px;">No scheduled or recurring pushes found.</div>';
                return;
            }
            list.innerHTML = json.data.map(n => {
                const dateObj = n.scheduled_for ? new Date(n.scheduled_for) : null;
                const dateStr = dateObj ? dateObj.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ' ' + dateObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'Immediate/Sent';
                
                let targetText = '🌍 All Users';
if (n.target_audience === 'logged_in') targetText = '🔒 Login Users';
else if (n.target_audience === 'non_logged_in') targetText = '🌐 Public Users';
else if (n.target_audience === 'login_no_level_2') targetText = '🔒 Login (No Lvl 2)';
else if (n.target_audience === 'login_no_level_3') targetText = '🔒 Login (No Lvl 3)';
else if (n.target_audience === 'login_no_level_4') targetText = '🔒 Login (No Lvl 4)';
else if (n.target_audience === 'login_with_level_2') targetText = '🔒 Login (With Lvl 2)';
else if (n.target_audience === 'login_with_level_3') targetText = '🔒 Login (With Lvl 3)';
else if (n.target_audience === 'login_with_level_4') targetText = '🔒 Login (With Lvl 4)';
                let recurrenceText = n.recurrence === 'daily' ? ' | 🔁 Daily' : (n.recurrence === 'weekly' ? ' | 🔁 Weekly' : ' | Once');

                return `
                <div class="p-2 mb-2 bg-white rounded border shadow-sm position-relative">
                    <div class="fw-bold text-dark" style="font-size: 13px;">${n.title}</div>
                    <div class="text-muted" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.body}</div>
                    <div class="mt-1 d-flex justify-content-between align-items-center">
                        <span class="badge bg-light text-dark border" style="font-size: 9px;">${targetText}${recurrenceText}</span>
                        <span class="text-primary fw-bold" style="font-size: 10px;">${dateStr}</span>
                    </div>
                    <div class="mt-2 d-flex gap-2">
                        <button class="btn btn-sm btn-outline-primary w-50 py-1" style="font-size:10px; font-weight:bold;" onclick='openEditPushModal(${JSON.stringify(n).replace(/'/g, "\\'")})'>Edit</button>
                        <button class="btn btn-sm btn-outline-danger w-50 py-1" style="font-size:10px; font-weight:bold;" onclick="deleteScheduledPush(${n.id})">Delete</button>
                    </div>
                </div>`;
            }).join('');
        }
    } catch(e) { list.innerHTML = '<div class="text-center text-danger p-3" style="font-size: 12px;">Error loading.</div>'; }
}

window.openEditPushModal = function(n) {
    document.getElementById('editPushId').value = n.id;
    document.getElementById('editPushTarget').value = n.target_audience || 'both';
    document.getElementById('editPushTitle').value = n.title || '';
    document.getElementById('editPushBody').value = n.body || '';
    document.getElementById('editPushUrl').value = n.url !== '/' ? n.url : '';
    document.getElementById('editPushRecurrence').value = n.recurrence || 'none';
    
    const imgInput = document.getElementById('editPushImage');
    if(imgInput) imgInput.value = ''; 
    
    const currentImgLabel = document.getElementById('editPushCurrentImgLabel');
    if(currentImgLabel) {
        currentImgLabel.style.display = n.image_path ? 'block' : 'none';
    }

    if (n.scheduled_for) {
        const d = new Date(n.scheduled_for);
        const tzOffset = d.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(d - tzOffset)).toISOString().slice(0, 16);
        document.getElementById('editPushSchedule').value = localISOTime;
    } else {
        document.getElementById('editPushSchedule').value = '';
    }

    bootstrap.Modal.getOrCreateInstance(document.getElementById('editPushModal')).show();
};

// --- NEW: Function to delete sent broadcasts ---
window.deleteChatPush = async function(id) {
    if(!confirm("Are you sure you want to delete this broadcast from the history?")) return;
    try {
        const res = await fetch(`/api/admin/notifications/${id}`, { 
            method: 'DELETE', 
            credentials: 'same-origin' 
        });
        
        if(res.ok) {
            // Refresh the history immediately
            fetchChatNotifications(false);
        } else {
            alert("Error deleting notification.");
        }
    } catch(e) { 
        alert("Network Error: Could not delete."); 
    }
};

window.deleteScheduledPush = async function(id) {
    if(!confirm("Delete this scheduled notification?")) return;
    try {
        const res = await fetch(`/api/admin/notifications/${id}`, { method: 'DELETE', credentials: 'same-origin' });
        if(res.ok) {
            fetchScheduledPushes();
            fetchChatNotifications(false);
        }
    } catch(e) { alert("Error deleting."); }
};

const formEditPush = document.getElementById('formEditPush');
if (formEditPush) {
    formEditPush.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnEditPushSubmit');
        btn.disabled = true; btn.innerText = 'Saving...';

        const id = document.getElementById('editPushId').value;
        const formData = new FormData();
        formData.append('target_audience', document.getElementById('editPushTarget').value);
        formData.append('title', document.getElementById('editPushTitle').value);
        formData.append('body', document.getElementById('editPushBody').value);
        formData.append('url', document.getElementById('editPushUrl').value);
        
        const scheduleTime = document.getElementById('editPushSchedule').value;
        if(scheduleTime) formData.append('schedule_time', scheduleTime);
        
        formData.append('recurrence', document.getElementById('editPushRecurrence').value || 'none');
        
        const silentEl = document.getElementById('editPushSilent');
        if (silentEl) formData.append('silent_edit', silentEl.checked ? 'true' : 'false');
        
        const imageEl = document.getElementById('editPushImage');
        if (imageEl && imageEl.files[0]) {
            formData.append('push_image', imageEl.files[0]);
        }

        try {
            const res = await fetch(`/api/admin/notifications/${id}`, {
                method: 'PUT',
                body: formData,
                credentials: 'same-origin'
            });
            if (res.ok) {
                bootstrap.Modal.getInstance(document.getElementById('editPushModal')).hide();
                fetchScheduledPushes();
                fetchChatNotifications(false);
            } else {
                alert("Error updating notification.");
            }
        } catch (e) { alert("Network Error"); }
        finally { btn.disabled = false; btn.innerText = 'Save Changes'; }
    });
}

let userNotifications = [];
let userNotifOffset = 0;

async function fetchUserNotifications(loadMore = false) {
    const list = document.getElementById('userNotificationList');
    if(!list) return;
    
    if (loadMore) {
        userNotifOffset += NOTIF_LIMIT;
        const btn = document.getElementById('btnLoadMoreUser');
        if(btn) btn.innerText = 'Loading...';
    } else {
        userNotifOffset = 0;
        userNotifications = [];
    }
    
    try {
        const res = await fetch(`/api/user/notifications?limit=${NOTIF_LIMIT}&offset=${userNotifOffset}`, { credentials: 'same-origin' });
        if (!res.ok) return;
        const json = await res.json();
        
        if(json.success) {
            const fetched = json.data;
            
            if (!loadMore) userNotifications = fetched;
            else userNotifications = [...userNotifications, ...fetched];
            
            if(userNotifications.length === 0) {
                list.innerHTML = '<div class="text-center text-muted mt-3" style="font-size:12px;">No notifications yet.</div>';
                return;
            }
            
            let html = userNotifications.map(n => {
                const dateObj = n.scheduled_for ? new Date(n.scheduled_for) : new Date(n.created_at);
                const dateStr = dateObj.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ' ' + dateObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
                
                return `
                <div class="chat-bubble sent" style="max-width: 100%; margin-left:0; border-radius: 8px;">
                    <div class="chat-title">${n.title}</div>
                    <div class="chat-body">${n.body}</div>
                    ${n.url && n.url !== '/' ? `<a href="${n.url}" target="_blank" class="chat-link">${n.url}</a>` : ''}
                    <div class="chat-meta mt-1 pt-1">
                        <span>${dateStr}</span>
                    </div>
                </div>`;
            }).join('');
            
            if (fetched.length === NOTIF_LIMIT) {
                html += `<div class="text-center my-3"><button id="btnLoadMoreUser" class="btn btn-sm btn-outline-secondary w-100 fw-bold" style="font-size: 12px; border-radius: 8px; background: #fff;" onclick="fetchUserNotifications(true)">Show More History</button></div>`;
            }

            list.innerHTML = html;
        }
    } catch (e) {
        if(!loadMore) list.innerHTML = '<div class="text-center text-danger mt-3" style="font-size:12px;">Error loading alerts.</div>';
    }
}
// --- NEW: Quick Notification Templates Logic ---
function getPushTemplates() {
    if (typeof userData === 'undefined' || !userData.email) return [];
    const saved = localStorage.getItem(`pushTemplates_${userData.email}`);
    return saved ? JSON.parse(saved) : [];
}

function savePushTemplates(templates) {
    if (typeof userData === 'undefined' || !userData.email) return;
    localStorage.setItem(`pushTemplates_${userData.email}`, JSON.stringify(templates));
}

window.loadPushTemplatesUI = function() {
    const select = document.getElementById('chatPushTemplate');
    if (!select) return;
    const templates = getPushTemplates();
    
    select.innerHTML = '<option value="">⚡ Load Quick Notification...</option>';
    templates.forEach((t, index) => {
        select.innerHTML += `<option value="${index}">${t.name}</option>`;
    });
    
    const btnDel = document.getElementById('btnDelTemplate');
    if (btnDel) btnDel.style.display = 'none';
};

window.applyPushTemplate = function() {
    const select = document.getElementById('chatPushTemplate');
    if (!select) return;
    const index = select.value;
    const btnDel = document.getElementById('btnDelTemplate');
    
    if (index === '') {
        if (btnDel) btnDel.style.display = 'none';
        return;
    }
    
    const templates = getPushTemplates();
    const t = templates[index];
    if (t) {
        const titleInput = document.getElementById('chatPushTitle');
        const bodyInput = document.getElementById('chatPushBody');
        const urlInput = document.getElementById('chatPushUrl');
        
        if (titleInput) titleInput.value = t.title || '';
        if (bodyInput) bodyInput.value = t.body || '';
        if (urlInput) urlInput.value = t.url || '';
        
        if (btnDel) btnDel.style.display = 'block'; // Show delete button
    }
};

window.savePushTemplate = function() {
    const titleInput = document.getElementById('chatPushTitle');
    const bodyInput = document.getElementById('chatPushBody');
    const urlInput = document.getElementById('chatPushUrl');
    
    if (!titleInput || !bodyInput) return;

    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    const url = urlInput ? urlInput.value.trim() : '';

    if (!title || !body) {
        alert("Please enter at least a Title and Body to save a quick notification.");
        return;
    }

    const name = prompt("Enter a short name for this Quick Notification (e.g., 'New Strategy', 'Profit Book'):");
    if (!name) return;

    const templates = getPushTemplates();
    templates.push({ name, title, body, url });
    savePushTemplates(templates);
    
    loadPushTemplatesUI();
    
    // Auto-select the newly added template
    const select = document.getElementById('chatPushTemplate');
    if (select) select.value = templates.length - 1;
    
    const btnDel = document.getElementById('btnDelTemplate');
    if (btnDel) btnDel.style.display = 'block';
};

window.deletePushTemplate = function() {
    const select = document.getElementById('chatPushTemplate');
    if (!select) return;
    
    const index = select.value;
    if (index === '') return;
    
    if (!confirm("Are you sure you want to delete this Quick Notification?")) return;

    const templates = getPushTemplates();
    templates.splice(index, 1);
    savePushTemplates(templates);
    
    loadPushTemplatesUI();
    
    // Clear the form fields
    const titleInput = document.getElementById('chatPushTitle');
    const bodyInput = document.getElementById('chatPushBody');
    const urlInput = document.getElementById('chatPushUrl');
    
    if (titleInput) titleInput.value = '';
    if (bodyInput) bodyInput.value = '';
    if (urlInput) urlInput.value = '';
};

// Initialize UI a half-second after script loads to ensure DOM is ready
setTimeout(loadPushTemplatesUI, 500);
