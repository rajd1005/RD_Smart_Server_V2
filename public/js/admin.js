function applyRoleRestrictions() {
    const role = localStorage.getItem('userRole');
    const statPoints = document.getElementById('statPoints');
    const statWinRate = document.getElementById('statWinRate');

    // Both Admin and Manager get access to Trades & Push
    if (role === 'admin' || role === 'manager') {
        document.getElementById('btnSelect').style.display = 'flex';
        document.getElementById('btnDelete').style.display = 'flex';

        if (statPoints) statPoints.style.display = 'flex';
        if (statWinRate) statWinRate.style.display = 'flex';

        const navPushBtn = document.getElementById('navPushBtn');
        if (navPushBtn) navPushBtn.style.display = 'flex';

        // ADMIN AND MANAGER gets the Course Manager / Settings Gear icon
        const btnAdminCourseManager = document.getElementById('btnAdminCourseManager');
        if (btnAdminCourseManager) btnAdminCourseManager.style.display = 'flex';

        const adminAccordionControls = document.getElementById('adminAccordionControls');
        if (adminAccordionControls && role === 'admin') adminAccordionControls.style.display = 'block';

        // --- NEW RESTRICTION: Managers can ONLY see the Users Tab ---
        if (role === 'manager') {
            const tabsToHide = ['tab-module', 'tab-lesson', 'tab-settings', 'tab-progress', 'tab-symbols', 'tab-channels'];
            tabsToHide.forEach(tabId => {
                const el = document.getElementById(tabId);
                if (el && el.parentElement) el.parentElement.style.display = 'none'; // Hide the <li> wrapper
            });
            
            // Force the 'Users' tab to be active by default for Managers
            const tabUsers = document.getElementById('tab-users');
            if (tabUsers) {
                // Remove active classes from all tabs and panes
                document.querySelectorAll('#adminTabs .nav-link').forEach(n => n.classList.remove('active'));
                document.querySelectorAll('#adminTabsContent .tab-pane').forEach(p => p.classList.remove('show', 'active'));
                
                // Activate the Users tab
                tabUsers.classList.add('active');
                const paneUsers = document.getElementById('pane-users');
                if (paneUsers) paneUsers.classList.add('show', 'active');
            }
        }

    } else {
        if (statPoints) statPoints.style.display = 'none';
        if (statWinRate) statWinRate.style.display = 'none';
    }
}

const formAdminSettings = document.getElementById('formAdminSettings');
if (formAdminSettings) {
    formAdminSettings.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        
        const state = document.getElementById('adminAccordionState')?.value || 'first';
        const hideTrade = document.getElementById('adminHideTradeTab')?.checked ? 'true' : 'false';
        const push_trade_alerts = document.getElementById('adminPushTradeAlerts')?.checked ? 'true' : 'false';
        const showGallery = document.getElementById('adminShowGallery')?.checked ? 'true' : 'false';
        const showCallWidget = document.getElementById('adminShowCallWidget')?.checked ? 'true' : 'false';
        const showChannelTab = document.getElementById('adminShowChannelTab')?.checked ? 'true' : 'false';

        const showStickyFooter = document.getElementById('adminShowStickyFooter')?.checked ? 'true' : 'false';
        const sticky_btn1_text = document.getElementById('adminBtn1Text')?.value || '';
        const sticky_btn1_icon = document.getElementById('adminBtn1Icon')?.value || '';
        const sticky_btn1_link = document.getElementById('adminBtn1Link')?.value || '';
        const sticky_btn2_text = document.getElementById('adminBtn2Text')?.value || '';
        const sticky_btn2_icon = document.getElementById('adminBtn2Icon')?.value || '';
        const sticky_btn2_link = document.getElementById('adminBtn2Link')?.value || '';
        
        const showDisclaimer = document.getElementById('adminShowDisclaimer')?.checked ? 'true' : 'false';
        const register_link = document.getElementById('adminRegisterLink')?.value || '';
        const manager_emails = document.getElementById('adminManagerEmails')?.value || '';
        
        let homepage_layout = undefined;
        const layoutList = document.querySelectorAll('#homepageLayoutDraggable li');
        if (layoutList.length > 0) {
            const layoutArray = Array.from(layoutList).map(li => li.getAttribute('data-id'));
            homepage_layout = JSON.stringify(layoutArray);
        }
        
        try {
            const bodyData = { 
                accordion_state: state, 
                hide_trade_tab: hideTrade, 
                push_trade_alerts: push_trade_alerts,
                show_gallery: showGallery, 
                show_call_widget: showCallWidget,
                show_channel_tab: showChannelTab,
                show_sticky_footer: showStickyFooter,
                sticky_btn1_text: sticky_btn1_text,
                sticky_btn1_icon: sticky_btn1_icon,
                sticky_btn1_link: sticky_btn1_link,
                sticky_btn2_text: sticky_btn2_text,
                sticky_btn2_icon: sticky_btn2_icon,
                sticky_btn2_link: sticky_btn2_link,
                show_disclaimer: showDisclaimer,
                register_link: register_link,
                manager_emails: manager_emails
            };
            if (homepage_layout) bodyData.homepage_layout = homepage_layout;

            const res = await fetch('/api/admin/settings', { 
                method: 'PUT', 
                headers: {'Content-Type': 'application/json'}, 
                credentials: 'same-origin', 
                body: JSON.stringify(bodyData) 
            });
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('adminCourseModal'));
                if(m) m.hide();
                fetchCourses(); 
            } else { 
                const errData = await res.json().catch(()=>({}));
                alert("Error saving settings: " + (errData.msg || "Unknown"));
            }
        } catch(err) { alert("Network error saving settings."); }
        finally { btn.innerText = "Save Settings"; btn.disabled = false; }
    });
}

const formAdminSymbols = document.getElementById('formAdminSymbols');
if (formAdminSymbols) {
    formAdminSymbols.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        
        try {
            const bodyData = { 
                cat_forex_crypto: document.getElementById('adminCatForex')?.value || '',
                cat_stock: document.getElementById('adminCatStock')?.value || '',
                cat_index: document.getElementById('adminCatIndex')?.value || '',
                cat_mcx: document.getElementById('adminCatMcx')?.value || ''
            };

            const res = await fetch('/api/admin/settings/symbols', { 
                method: 'PUT', 
                headers: {'Content-Type': 'application/json'}, 
                credentials: 'same-origin', 
                body: JSON.stringify(bodyData) 
            });
            
            if(res.ok) { 
                alert("Symbol Categories saved successfully!");
                fetchCourses(); 
            } else { 
                const errData = await res.json().catch(()=>({}));
                alert("Error saving symbols: " + (errData.msg || "Unknown"));
            }
        } catch(err) { alert("Network error saving symbols."); }
        finally { btn.innerText = "Save Symbols"; btn.disabled = false; }
    });
}

const formAddModule = document.getElementById('formAddModule');
if (formAddModule) {
    formAddModule.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Creating..."; btn.disabled = true;
        
        const data = {
            title: document.getElementById('modTitle')?.value || '', 
            description: document.getElementById('modDesc')?.value || '', 
            required_level: document.getElementById('modLevel')?.value || 'demo', 
            display_order: document.getElementById('modDisplayOrder')?.value || 0,
            lock_notice: document.getElementById('modLockNotice')?.value || '',
            show_on_home: document.getElementById('modShowHome')?.value === 'true',
            dashboard_visibility: document.getElementById('modDashVis')?.value || 'all'
        };

        try {
            const res = await fetch('/api/admin/modules', { method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify(data) });
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('adminCourseModal'));
                if(m) m.hide();
                formAddModule.reset(); 
                fetchCourses(); 
            } else {
                const errData = await res.json().catch(()=>({}));
                alert("Error adding module: " + (errData.msg || "Database error. Check duplicate title."));
            }
        } catch(e) { alert("Network Error"); }
        finally { btn.innerText = "Create Module"; btn.disabled = false; }
    });
}

const formAddLesson = document.getElementById('formAddLesson');
if (formAddLesson) {
    formAddLesson.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.append('module_id', document.getElementById('lessonModuleId')?.value || '');
        formData.append('title', document.getElementById('lessonTitle')?.value || '');
        formData.append('description', document.getElementById('lessonDesc')?.value || '');
        formData.append('display_order', document.getElementById('lessonDisplayOrder')?.value || 0);
        
        const videoEl = document.getElementById('lessonVideoFile');
        if (videoEl && videoEl.files[0]) formData.append('video_file', videoEl.files[0]);
        
        const thumbEl = document.getElementById('lessonThumbnailFile');
        if (thumbEl && thumbEl.files[0]) formData.append('thumbnail_file', thumbEl.files[0]);

        const btn = e.target.querySelector('button'); 
        btn.innerText = (videoEl && videoEl.files[0]) ? "⏳ Uploading Video..." : "Saving Document..."; 
        btn.disabled = true;
        
        try {
            const res = await fetch('/api/admin/lessons', { method: 'POST', credentials: 'same-origin', body: formData });
            const data = await res.json().catch(()=>({}));
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('adminCourseModal'));
                if(m) m.hide();
                alert(data.msg); 
                formAddLesson.reset(); 
                fetchCourses();
            } else { alert("Error uploading lesson: " + (data.msg || "Unknown")); }
        } catch(err) { alert("Network error saving lesson."); } 
        finally { btn.innerText = "Upload Video"; btn.disabled = false; }
    });
}

window.openEditModule = function(e, id, title, desc, level, notice, order, showHome, dashVis) {
    e.stopPropagation();
    const modalEl = document.getElementById('editModuleModal');
    if (!modalEl) { alert("Please use the dashboard to edit modules."); return; }

    const safeSet = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
    
    safeSet('editModId', id);
    safeSet('editModTitle', title);
    safeSet('editModDesc', (desc !== 'null' && desc !== 'undefined') ? desc : '');
    safeSet('editModLevel', level);
    safeSet('editModDisplayOrder', order);
    safeSet('editModLockNotice', (notice !== 'null' && notice !== 'undefined') ? notice : '');
    safeSet('editModShowHome', (showHome === false || showHome === 'false') ? 'false' : 'true');
    safeSet('editModDashVis', (dashVis === 'null' || !dashVis) ? 'all' : dashVis);
    
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

const formEditModule = document.getElementById('formEditModule');
if (formEditModule) {
    formEditModule.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        const id = document.getElementById('editModId')?.value || '';
        const data = {
            title: document.getElementById('editModTitle')?.value || '', 
            description: document.getElementById('editModDesc')?.value || '',
            required_level: document.getElementById('editModLevel')?.value || 'demo', 
            display_order: document.getElementById('editModDisplayOrder')?.value || 0,
            lock_notice: document.getElementById('editModLockNotice')?.value || '',
            show_on_home: document.getElementById('editModShowHome')?.value === 'true',
            dashboard_visibility: document.getElementById('editModDashVis')?.value || 'all'
        };
        try {
            const res = await fetch(`/api/admin/modules/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify(data) });
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('editModuleModal'));
                if(m) m.hide();
                fetchCourses(); 
            } else { 
                const errData = await res.json().catch(()=>({}));
                alert("Error updating module: " + (errData.msg || "Unknown")); 
            }
        } catch(err) { alert("Network Error"); }
        finally { btn.innerText = "Save Changes"; btn.disabled = false; }
    });
}

window.openEditLesson = function(e, id, title, desc, order) {
    e.stopPropagation();
    const modalEl = document.getElementById('editLessonModal');
    if (!modalEl) { alert("Please use the dashboard to edit videos."); return; }

    const safeSet = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };

    safeSet('editLessonId', id);
    safeSet('editLessonTitle', title);
    safeSet('editLessonDesc', (desc !== 'null' && desc !== 'undefined') ? desc : '');
    safeSet('editLessonDisplayOrder', order);
    safeSet('editLessonThumbnailFile', '');
    
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

const formEditLesson = document.getElementById('formEditLesson');
if (formEditLesson) {
    formEditLesson.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        const id = document.getElementById('editLessonId')?.value || '';
        const formData = new FormData();
        formData.append('title', document.getElementById('editLessonTitle')?.value || '');
        formData.append('description', document.getElementById('editLessonDesc')?.value || '');
        formData.append('display_order', document.getElementById('editLessonDisplayOrder')?.value || 0);
        
        const thumbEl = document.getElementById('editLessonThumbnailFile');
        if (thumbEl && thumbEl.files[0]) formData.append('thumbnail_file', thumbEl.files[0]);

        try {
            const res = await fetch(`/api/admin/lessons/${id}`, { method: 'PUT', credentials: 'same-origin', body: formData });
            if(res.ok) { 
                const m = bootstrap.Modal.getInstance(document.getElementById('editLessonModal'));
                if(m) m.hide();
                fetchCourses(); 
            } else { 
                const errData = await res.json().catch(()=>({}));
                alert("Error updating lesson: " + (errData.msg || "Unknown")); 
            }
        } catch(err) { alert("Network Error"); }
        finally { btn.innerText = "Save Changes"; btn.disabled = false; }
    });
}

window.deleteLesson = async function(e, id) {
    e.stopPropagation(); 
    const password = prompt("🔒 Enter Admin Password to delete this lesson:");
    if (!password) return;
    try { 
        const res = await fetch(`/api/admin/lessons/${id}`, { 
            method: 'DELETE', 
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ password })
        }); 
        const data = await res.json();
        if(res.ok && data.success) fetchCourses(); 
        else alert(data.msg || "Error deleting lesson");
    } catch(e) {}
}

window.deleteModule = async function(e, id) {
    e.stopPropagation();
    const password = prompt("🔒 Enter Admin Password to delete this module:");
    if (!password) return;
    try { 
        const res = await fetch(`/api/admin/modules/${id}`, { 
            method: 'DELETE', 
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ password })
        }); 
        const data = await res.json();
        if(res.ok && data.success) fetchCourses(); 
        else alert(data.msg || "Error deleting module");
    } catch(e) { console.error(e); }
}

window.fetchLocalUsers = async function() {
    const tbody = document.getElementById('localUsersTableBody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-2">Loading...</td></tr>';
    try {
        const res = await fetch('/api/admin/users');
        const json = await res.json();
        if(json.success && json.data.length > 0) {
            tbody.innerHTML = json.data.map(u => {
                let status = u.is_blocked ? '<span class="text-danger fw-bold">Blocked</span>' : (u.is_lifetime ? '<span class="text-success">Lifetime</span>' : 'Active');
                let levels = [];
                if(u.level_2_status === 'Yes') levels.push('L2');
                if(u.level_3_status === 'Yes') levels.push('L3');
                if(u.level_4_status === 'Yes') levels.push('L4');
                return `
                <tr>
                    <td class="text-break">${u.email}</td>
                    <td>${levels.length > 0 ? levels.join(', ') : 'L1'}</td>
                    <td>${status}</td>
                </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-2">No users found.</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-2">Error loading users.</td></tr>';
    }
}

const formAdminUsers = document.getElementById('formAdminUsers');
if(formAdminUsers) {
    formAdminUsers.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button'); btn.innerText = "Saving..."; btn.disabled = true;
        
        try {
            const bodyData = { 
                email: document.getElementById('adminUserEmail').value,
                phone: document.getElementById('adminUserPhone').value,
                level_2_status: document.getElementById('adminUserLvl2').checked ? 'Yes' : 'No',
                level_3_status: document.getElementById('adminUserLvl3').checked ? 'Yes' : 'No',
                level_4_status: document.getElementById('adminUserLvl4').checked ? 'Yes' : 'No',
                validity_days: document.getElementById('adminUserValidity').value,
                is_lifetime: document.getElementById('adminUserLifetime').checked,
                is_blocked: document.getElementById('adminUserBlock').checked
            };

            const res = await fetch('/api/admin/users', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify(bodyData) 
            });
            const json = await res.json();
            if(json.success) { 
                alert("User saved successfully!");
                formAdminUsers.reset();
                if(typeof fetchLocalUsers === 'function') fetchLocalUsers();
            } else { 
                alert("Error: " + json.msg);
            }
        } catch(err) { alert("Network error saving user."); }
        finally { btn.innerText = "Save User"; btn.disabled = false; }
    });
}
