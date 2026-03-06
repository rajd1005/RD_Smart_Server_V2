function applyRoleRestrictions() {
    const role = localStorage.getItem('userRole');
    const statPoints = document.getElementById('statPoints');
    const statWinRate = document.getElementById('statWinRate');

    if (role === 'admin') {
        document.getElementById('btnSelect').style.display = 'flex';
        document.getElementById('btnDelete').style.display = 'flex';
        const btnAdminCourseManager = document.getElementById('btnAdminCourseManager');
        if (btnAdminCourseManager) btnAdminCourseManager.style.display = 'flex';
        const adminAccordionControls = document.getElementById('adminAccordionControls');
        if (adminAccordionControls) adminAccordionControls.style.display = 'block';

        if (statPoints) statPoints.style.display = 'flex';
        if (statWinRate) statWinRate.style.display = 'flex';

        const navPushBtn = document.getElementById('navPushBtn');
        if (navPushBtn) navPushBtn.style.display = 'flex';

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

        const showStickyFooter = document.getElementById('adminShowStickyFooter')?.checked ? 'true' : 'false';
        const sticky_btn1_text = document.getElementById('adminBtn1Text')?.value || '';
        const sticky_btn1_icon = document.getElementById('adminBtn1Icon')?.value || '';
        const sticky_btn1_link = document.getElementById('adminBtn1Link')?.value || '';
        const sticky_btn2_text = document.getElementById('adminBtn2Text')?.value || '';
        const sticky_btn2_icon = document.getElementById('adminBtn2Icon')?.value || '';
        const sticky_btn2_link = document.getElementById('adminBtn2Link')?.value || '';
        
        const showDisclaimer = document.getElementById('adminShowDisclaimer')?.checked ? 'true' : 'false';
        const register_link = document.getElementById('adminRegisterLink')?.value || '';
        
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
                show_sticky_footer: showStickyFooter,
                sticky_btn1_text: sticky_btn1_text,
                sticky_btn1_icon: sticky_btn1_icon,
                sticky_btn1_link: sticky_btn1_link,
                sticky_btn2_text: sticky_btn2_text,
                sticky_btn2_icon: sticky_btn2_icon,
                sticky_btn2_link: sticky_btn2_link,
                show_disclaimer: showDisclaimer,
                register_link: register_link
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
