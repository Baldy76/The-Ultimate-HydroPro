"use strict";

const DB_KEY = 'HydroPro_Gold_V36'; 
const W_API_KEY = "4c00e61833ea94d3c4a1bff9d2c32969"; 

let db = { customers: [], expenses: [], history: [], bank: { name: '', acc: '' } };

let curWeek = parseInt(localStorage.getItem('HP_curWeek')) || 1; 
let workingDay = localStorage.getItem('HP_workingDay');
if (!workingDay) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    workingDay = days[new Date().getDay()];
    if (workingDay === 'Sun') workingDay = 'Mon'; 
}

let financeChartInstance = null; 
let currentPayId = null;
let currentPayContext = null;
let currentPayTotal = 0;
let confirmCallback = null; 
let showArrearsOnly = false;
let editingCustomerId = null;
let currentPayMethod = 'Cash'; 

const idb = {
    db: null,
    init: () => new Promise((resolve, reject) => {
        const req = indexedDB.open('HydroPro_V3_DB', 1);
        req.onupgradeneeded = e => {
            e.target.result.createObjectStore('appData');
        };
        req.onsuccess = e => { idb.db = e.target.result; resolve(); };
        req.onerror = e => reject(e);
    }),
    get: (key) => new Promise(resolve => {
        const req = idb.db.transaction('appData', 'readonly').objectStore('appData').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    }),
    set: (key, val) => new Promise(resolve => {
        const req = idb.db.transaction('appData', 'readwrite').objectStore('appData').put(val, key);
        req.onsuccess = () => resolve();
    }),
    clear: () => new Promise(resolve => {
        const req = idb.db.transaction('appData', 'readwrite').objectStore('appData').clear();
        req.onsuccess = () => resolve();
    })
};

const triggerHaptic = () => { if (navigator.vibrate) navigator.vibrate(40); };

window.showToast = (msg, type = 'normal') => {
    triggerHaptic();
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 2500);
};

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error('PWA Reg Failed:', err));
    });
}

// 100% Syntax-safe HTML Escaping
const escapeHTML = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;"); 
};

window.getArrearsData = (c) => {
    const currentMonthStr = new Date().toLocaleString('en-GB', { month: 'short' });
    let pastLog = c.pastArrears || [];
    let thisMonthCharge = c.cleaned ? (parseFloat(c.price) || 0) : 0;
    let currentOwed = thisMonthCharge - (parseFloat(c.paidThisMonth) || 0);
    let breakdown = pastLog.map(a => ({ month: a.month, amt: parseFloat(a.amt) }));
    if (currentOwed > 0.01) breakdown.push({ month: currentMonthStr, amt: currentOwed });
    const totalOwed = breakdown.reduce((sum, item) => sum + item.amt, 0);
    return { isOwed: totalOwed > 0.01, total: totalOwed, monthsString: breakdown.map(b => b.month).join(', '), breakdown: breakdown };
};

let wthStartY = 0; let wthContainer = null; let ptrIndicator = null;
const initPTR = () => {
    wthContainer = document.getElementById('weather-root'); ptrIndicator = document.getElementById('ptr-indicator');
    if(!wthContainer || !ptrIndicator) return;
    wthContainer.addEventListener('touchstart', e => { if (wthContainer.scrollTop === 0) wthStartY = e.touches[0].clientY; }, {passive: true});
    wthContainer.addEventListener('touchmove', e => {
        if (wthContainer.scrollTop === 0 && wthStartY > 0) {
            let currentY = e.touches[0].clientY; let diff = currentY - wthStartY;
            if (diff > 20) ptrIndicator.classList.add('visible');
        }
    }, {passive: true});
    wthContainer.addEventListener('touchend', e => {
        if (ptrIndicator.classList.contains('visible')) {
            ptrIndicator.classList.remove('visible'); triggerHaptic(); showToast("Fetching Radar...", "normal"); initWeather();
        }
        wthStartY = 0;
    });
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Ultimate Hydro Pro v4.6 Booting...");
    try {
        await idb.init(); 
        let savedData = await idb.get('master_db');
        if (!savedData) {
            const legacyData = localStorage.getItem(DB_KEY);
            if (legacyData) { savedData = JSON.parse(legacyData); await idb.set('master_db', savedData); }
        }
        if (savedData) {
            db.customers = savedData.customers || []; db.expenses = savedData.expenses || [];
            db.history = savedData.history || []; db.bank = savedData.bank || { name: '', acc: '' };
        }
    } catch(err) { console.error("Boot Error:", err); }

    applyTheme(localStorage.getItem('HP_Theme') === 'true');
    const bNameEl = document.getElementById('bName'); const bAccEl = document.getElementById('bAcc');
    if(bNameEl) bNameEl.value = db.bank.name; if(bAccEl) bAccEl.value = db.bank.acc;

    const aiKeyEl = document.getElementById('sAIKey');
    if(aiKeyEl) aiKeyEl.value = localStorage.getItem('HP_AI_Key') || '';

    document.querySelectorAll('.WEE-day-btn').forEach(b => b.classList.remove('active'));
    const activeDayBtn = document.getElementById(`day-${workingDay}`);
    if(activeDayBtn) activeDayBtn.classList.add('active');
    
    document.querySelectorAll('.segment').forEach(b => { if(b.id && b.id.startsWith('wk-btn-')) b.classList.remove('active'); });
    const activeWkBtn = document.getElementById(`wk-btn-${curWeek}`);
    if(activeWkBtn) activeWkBtn.classList.add('active');
    
    // Bind Confirm Button
    const confirmBtn = document.getElementById('confirmActionBtn');
    if(confirmBtn) {
        confirmBtn.addEventListener('click', () => { if(confirmCallback) confirmCallback(); window.closeConfirmModal(); });
    }

    renderAllSafe(); initWeather(); initPTR();

    const weekView = document.getElementById('week-view-root');
    if(weekView) {
        weekView.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
        weekView.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; handleSwipe(); }, {passive: true});
    }
});

window.runDeepScanRecovery = async () => {
    triggerHaptic();
    showToast("Scanning device memory...", "normal");
    
    setTimeout(async () => {
        let foundDb = null;
        
        for (let i = 0; i < localStorage.length; i++) {
            let key = localStorage.key(i);
            if (key.includes('Hydro') || key.includes('DB') || key.includes('Gold')) {
                try {
                    let parsed = JSON.parse(localStorage.getItem(key));
                    if (parsed && parsed.customers && parsed.customers.length > (foundDb ? foundDb.customers.length : 0)) {
                        foundDb = parsed;
                    }
                } catch(e) { } 
            }
        }
        
        if (foundDb && foundDb.customers.length > 0) {
            db = foundDb;
            await idb.set('master_db', db);
            renderAllSafe();
            showToast(`Recovered ${db.customers.length} customers! 🛟`, "success");
        } else {
            showToast("No ghost data found in memory.", "error");
        }
    }, 500);
};

function applyTheme(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    const meta = document.getElementById('theme-meta'); if(meta) meta.content = isDark ? "#000" : "#f2f2f7";
    const btnLight = document.getElementById('btnLight'); const btnDark = document.getElementById('btnDark');
    if (btnLight && btnDark) {
        if (isDark) { btnLight.classList.remove('active'); btnDark.classList.add('active'); } 
        else { btnLight.classList.add('active'); btnDark.classList.remove('active'); }
    }
}

window.setThemeMode = (isDark) => { triggerHaptic(); applyTheme(isDark); localStorage.setItem('HP_Theme', isDark); if(document.getElementById('finances-root').classList.contains('active')) renderFinances(); };
window.saveData = () => { idb.set('master_db', db); };

window.openTab = (id, btnId = null) => {
    triggerHaptic(); document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const target = document.getElementById(id);
    if(target) { target.classList.add('active'); const titleText = target.getAttribute('data-title'); if(titleText) document.getElementById('dynamic-header-title').innerText = titleText; }
    if (btnId) {
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.home-fab').forEach(btn => btn.classList.remove('active'));
        const btnEl = document.getElementById(btnId); if(btnEl) btnEl.classList.add('active');
    }
    window.scrollTo(0,0); renderAllSafe();
};

window.renderAllSafe = () => {
    try {
        const home = document.getElementById('home-root'); if(home && home.classList.contains('active')) renderHome();
        const master = document.getElementById('master-root'); if(master && master.classList.contains('active')) renderMaster();
        const finances = document.getElementById('finances-root'); if(finances && finances.classList.contains('active')) renderFinances();
        const week = document.getElementById('week-view-root'); if(week && week.classList.contains('active')) renderWeek();
    } catch (err) { console.error("Render Error:", err); }
};

window.renderHome = () => {
    const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
    document.getElementById('home-date').innerText = new Date().toLocaleDateString('en-GB', dateOptions).toUpperCase();

    const currentHour = new Date().getHours();
    let greeting = "Good Morning.";
    if (currentHour >= 12 && currentHour < 17) greeting = "Good Afternoon.";
    else if (currentHour >= 17) greeting = "Good Evening.";
    const greetingEl = document.getElementById('home-greeting');
    if (greetingEl) greetingEl.innerText = greeting;

    let todaysJobs = db.customers.filter(c => String(c.week).trim() === String(curWeek).trim() && String(c.day).trim() === String(workingDay).trim() && !c.skipped);
    let routeValue = todaysJobs.reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0);
    document.getElementById('home-jobs-count').innerText = `${todaysJobs.length} Jobs Scheduled (Wk ${curWeek} ${workingDay})`;
    document.getElementById('home-jobs-value').innerText = `£${routeValue.toFixed(2)}`;

    let totalArrears = 0; db.customers.forEach(c => { const arrData = window.getArrearsData(c); if(arrData.isOwed) totalArrears += arrData.total; });
    let cashTotal = 0; let currentMonthStr = new Date().toLocaleDateString('en-GB').substring(3);
    db.history.forEach(h => { if (h.date && h.date.includes(currentMonthStr) && h.method !== 'Bank') { cashTotal += parseFloat(h.amt); } });

    document.getElementById('home-arrears').innerText = `£${totalArrears.toFixed(2)}`;
    document.getElementById('home-cash').innerText = `£${cashTotal.toFixed(2)}`;
};

window.openAITeaserModal = () => {
    triggerHaptic();
    const input = document.getElementById('aiKeyInputModal');
    if(input) input.value = localStorage.getItem('HP_AI_Key') || '';
    const modal = document.getElementById('aiTeaserModal');
    if(modal) modal.classList.remove('hidden');
};
window.closeAITeaserModal = () => { const m = document.getElementById('aiTeaserModal'); if(m) m.classList.add('hidden'); };
window.saveModalAIKey = () => {
    triggerHaptic(); const key = document.getElementById('aiKeyInputModal').value.trim();
    if(key) {
        localStorage.setItem('HP_AI_Key', key);
        const sAiKey = document.getElementById('sAIKey'); if(sAiKey) sAiKey.value = key;
        showToast("AI Engine Connected! ✨", "success"); closeAITeaserModal();
    } else { showToast("Please enter an API key", "error"); }
};
window.saveSettingsAIKey = () => {
    triggerHaptic(); const key = document.getElementById('sAIKey').value.trim();
    if(key) { localStorage.setItem('HP_AI_Key', key); showToast("AI Engine Secured! ✨", "success"); }
    else { localStorage.removeItem('HP_AI_Key'); showToast("AI Engine Disabled.", "normal"); }
};
window.triggerAI = (context, id = null) => {
    triggerHaptic(); const key = localStorage.getItem('HP_AI_Key');
    if(!key) { openAITeaserModal(); } 
    else {
        if(context === 'voice') showToast("Listening... (Awaiting API)", "normal");
        if(context === 'receipt') showToast("Scanning receipt... (Awaiting Vision API)", "normal");
        if(context === 'reply') showToast("Drafting reply... (Awaiting Text API)", "normal");
    }
};

window.openAddCustomerModal = (id = null) => { 
    triggerHaptic(); editingCustomerId = id;
    const titleEl = document.getElementById('customerModalTitle'); const saveBtn = document.getElementById('saveCustomerBtn'); const deleteBtn = document.getElementById('deleteCustomerBtn');
    if (id) {
        const c = db.customers.find(x => x.id === id); if(!c) return;
        titleEl.innerText = "Edit Customer"; saveBtn.innerText = "UPDATE"; deleteBtn.classList.remove('hidden'); 
        document.getElementById('cName').value = c.name || ''; document.getElementById('cHouseNum').value = c.houseNum || '';
        document.getElementById('cStreet').value = c.street || ''; document.getElementById('cPostcode').value = c.postcode || '';
        document.getElementById('cPhone').value = c.phone || ''; document.getElementById('cPrice').value = c.price || '';
        document.getElementById('cNotes').value = c.notes || ''; document.getElementById('cFreq').value = c.freq || '4'; 
        document.getElementById('cWeek').value = c.week || '1'; document.getElementById('cDay').value = c.day || 'Mon';
    } else {
        titleEl.innerText = "Add Customer"; saveBtn.innerText = "SAVE"; deleteBtn.classList.add('hidden'); 
        document.getElementById('cName').value = ''; document.getElementById('cHouseNum').value = ''; document.getElementById('cStreet').value = '';
        document.getElementById('cPostcode').value = ''; document.getElementById('cPhone').value = ''; document.getElementById('cPrice').value = '';
        document.getElementById('cNotes').value = ''; document.getElementById('cFreq').value = '4'; 
        document.getElementById('cWeek').value = '1'; document.getElementById('cDay').value = 'Mon';
    }
    document.getElementById('addCustomerModal').classList.remove('hidden'); 
};
window.closeAddCustomerModal = () => { editingCustomerId = null; document.getElementById('addCustomerModal').classList.add('hidden'); };

window.saveCustomer = () => {
    triggerHaptic();
    const name = document.getElementById('cName').value.trim();
    if(!name) { showToast("Customer Name is required", "error"); return; }
    
    // Convert Postcode to Uppercase Safely
    const rawPostcode = document.getElementById('cPostcode').value || '';
    
    const newDetails = {
        name, houseNum: document.getElementById('cHouseNum').value.trim(), street: document.getElementById('cStreet').value.trim(), 
        postcode: rawPostcode.trim().toUpperCase(), phone: document.getElementById('cPhone').value.trim(), 
        price: parseFloat(document.getElementById('cPrice').value) || 0, notes: document.getElementById('cNotes').value.trim(), 
        freq: parseInt(document.getElementById('cFreq').value) || 4, week: document.getElementById('cWeek').value, day: document.getElementById('cDay').value 
    };

    if (editingCustomerId) {
        const cIndex = db.customers.findIndex(x => x.id === editingCustomerId);
        if (cIndex > -1) { db.customers[cIndex] = { ...db.customers[cIndex], ...newDetails }; showToast(`${name} updated`, "success"); }
    } else {
        db.customers.push({ id: Date.now().toString(), order: Date.now(), cycleOffset: 0, photos: [], ...newDetails, cleaned: false, skipped: false, paidThisMonth: 0, pastArrears: [] });
        showToast(`${name} added to database`, "success"); 
    }

    curWeek = parseInt(newDetails.week); workingDay = newDetails.day;
    localStorage.setItem('HP_curWeek', curWeek); localStorage.setItem('HP_workingDay', workingDay);
    document.querySelectorAll('.segment').forEach(b => { if(b.id && b.id.startsWith('wk-btn-')) b.classList.remove('active'); }); 
    const wkBtn = document.getElementById(`wk-btn-${curWeek}`); if(wkBtn) wkBtn.classList.add('active');
    document.querySelectorAll('.WEE-day-btn').forEach(b => b.classList.remove('active')); 
    const dayBtn = document.getElementById(`day-${workingDay}`); if(dayBtn) dayBtn.classList.add('active');

    saveData(); closeAddCustomerModal(); renderAllSafe(); 
};

window.cmdDeleteCustomer = () => {
    if (!editingCustomerId) return;
    const c = db.customers.find(x => x.id === editingCustomerId); if (!c) return;
    window.showConfirm("Delete Customer?", `Are you sure you want to permanently remove ${c.name} from the route?`, () => {
        db.customers = db.customers.filter(x => x.id !== editingCustomerId); saveData(); showToast(`${c.name} deleted.`, "normal"); closeAddCustomerModal(); renderAllSafe();
    });
};
window.saveBank = () => { triggerHaptic(); db.bank.name = document.getElementById('bName').value; db.bank.acc = document.getElementById('bAcc').value; saveData(); showToast("Bank Details Secured 🔒", "success"); };

// ✨ RESTORED: Confirm Modals and Handlers ✨
window.showConfirm = (title, text, actionCallback) => { 
    triggerHaptic(); 
    document.getElementById('confirmTitle').innerText = title; 
    document.getElementById('confirmText').innerText = text; 
    confirmCallback = actionCallback; 
    document.getElementById('confirmModal').classList.remove('hidden'); 
};
window.closeConfirmModal = () => { document.getElementById('confirmModal').classList.add('hidden'); confirmCallback = null; };

window.cmdCycleMonth = () => {
    window.showConfirm("Start New Month?", "This will reset all cleans to false and roll unpaid balances into arrears.", () => {
        const cycleMonth = new Date().toLocaleString('en-GB', { month: 'short', year: '2-digit' });
        db.customers.forEach(c => { 
            const paid = parseFloat(c.paidThisMonth) || 0; const price = c.cleaned ? (parseFloat(c.price) || 0) : 0; 
            if (paid < price) { if (!c.pastArrears) c.pastArrears = []; c.pastArrears.push({ month: cycleMonth, amt: price - paid }); } 
            
            let freq = c.freq || 4; if (c.cycleOffset === undefined) c.cycleOffset = 0;
            if (c.cycleOffset > 0) { c.cycleOffset--; c.skipped = true; } else { c.cycleOffset = (freq / 4) - 1; c.skipped = false; }
            c.cleaned = false; c.paidThisMonth = 0; 
        }); 
        db.expenses = []; saveData(); location.reload();
    });
};
window.cmdNuclear = () => { window.showConfirm("FACTORY RESET?", "This will permanently delete all customer data, finances, and settings.", async () => { await idb.clear(); localStorage.removeItem(DB_KEY); location.reload(); }); };

window.exportToQuickBooks = () => { triggerHaptic(); let csv = "Date,Description,Amount,Type,Category\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},Income: ${escapeHTML(c.name)},${c.paidThisMonth},Income,Service\n`; }); db.expenses.forEach(e => { csv += `${e.date},${escapeHTML(e.desc)},${e.amt},Expense,${escapeHTML(e.cat) || 'Other'}\n`; }); triggerDownload(csv, "HydroPro_QuickBooks.csv"); };
window.exportToXero = () => { triggerHaptic(); let csv = "Date,Description,Reference,Amount,AccountCode\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},Window Cleaning - ${escapeHTML(c.name)},${c.id},${c.paidThisMonth},200\n`; }); db.expenses.forEach(e => { csv += `${e.date},${escapeHTML(e.desc)},${escapeHTML(e.cat)},-${e.amt},400\n`; }); triggerDownload(csv, "HydroPro_Xero.csv"); };
window.exportToSage = () => { triggerHaptic(); let csv = "Date,Reference,Details,Net Amount,Tax Amount\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},CUST-${c.id},Window Cleaning,${c.paidThisMonth},0.00\n`; }); db.expenses.forEach(e => { csv += `${e.date},EXP-${e.id},${escapeHTML(e.desc)},-${e.amt},0.00\n`; }); triggerDownload(csv, "HydroPro_Sage.csv"); };
window.exportToFreeAgent = () => { triggerHaptic(); let csv = "Date,Amount,Description\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},${c.paidThisMonth},Income: ${escapeHTML(c.name)}\n`; }); db.expenses.forEach(e => { csv += `${e.date},-${e.amt},Expense: ${escapeHTML(e.desc)}\n`; }); triggerDownload(csv, "HydroPro_FreeAgent.csv"); };

const triggerDownload = (csvContent, filename) => { const blob = new Blob([csvContent], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); showToast(`${filename} Generated!`, "success"); };
window.exportData = () => { triggerHaptic(); const blob = new Blob([JSON.stringify(db)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "HydroPro_Backup.json"; link.click(); };
window.importData = (event) => { const reader = new FileReader(); reader.onload = async (e) => { try { const imported = JSON.parse(e.target.result); db.customers = imported.customers || []; db.expenses = imported.expenses || []; db.history = imported.history || []; db.bank = imported.bank || { name: '', acc: '' }; await idb.set('master_db', db); showToast("Data Restored Successfully", "success"); setTimeout(() => location.reload(), 1500); } catch (err) { showToast("Invalid Format File", "error"); } }; reader.readAsText(event.target.files[0]); };

window.toggleArrearsFilter = () => { triggerHaptic(); showArrearsOnly = !showArrearsOnly; const btn = document.getElementById('arrearsFilterBtn'); if(showArrearsOnly) { btn.classList.add('active'); } else { btn.classList.remove('active'); } renderMaster(); };

window.renderMaster = () => { 
    const list = document.getElementById('CST-list-container'); if(!list) return; list.innerHTML = '';
    const search = (document.getElementById('mainSearch')?.value || "").toLowerCase(); let renderedCount = 0;
    const searchStr = search.replace(/\s+/g, '');
    
    db.customers.forEach(c => {
        const arrData = window.getArrearsData(c); if (showArrearsOnly && !arrData.isOwed) return;
        const phoneStr = (c.phone || "").replace(/\s+/g, ''); const postStr = (c.postcode || "").toLowerCase().replace(/\s+/g, '');
        if(c.name.toLowerCase().includes(search) || (c.street||"").toLowerCase().includes(search) || phoneStr.includes(searchStr) || postStr.includes(searchStr)) {
            renderedCount++;
            const arrearsBadge = arrData.isOwed ? `<span class="CST-badge badge-unpaid">OWES £${arrData.total.toFixed(2)}</span>` : `<span class="CST-badge badge-paid">PAID</span>`;
            const div = document.createElement('div'); div.className = 'CST-card-item'; div.onclick = () => window.showCustomerBriefing(c.id);
            div.innerHTML = `<div class="CST-card-top"><div><strong style="font-size:20px;">${escapeHTML(c.name)}</strong><br><small style="color:var(--accent); font-weight:800;">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</small></div><div style="font-weight:950; font-size:22px;">£${(parseFloat(c.price)||0).toFixed(2)}</div></div><div class="CST-card-badges">${arrearsBadge}</div>`;
            list.appendChild(div);
        }
    });
    if (renderedCount === 0) { list.innerHTML = `<div class="empty-state"><span class="empty-icon">👻</span><div class="empty-text">No Customers Found</div><button class="ADM-save-btn" style="width: 220px; font-size: 14px; height: 50px!important; margin-top: 20px; box-shadow: 0 5px 15px rgba(0,122,255,0.2);" onclick="openAddCustomerModal()">➕ ADD CUSTOMER</button></div>`; }
};

window.setWorkingWeek = (num) => { triggerHaptic(); curWeek = num; localStorage.setItem('HP_curWeek', curWeek); document.querySelectorAll('.segment').forEach(b => { if(b.id && b.id.startsWith('wk-btn-')) b.classList.remove('active'); }); const wkBtn = document.getElementById(`wk-btn-${num}`); if(wkBtn) wkBtn.classList.add('active'); renderWeek(); };
window.setWorkingDay = (day, btn) => { triggerHaptic(); workingDay = day; localStorage.setItem('HP_workingDay', workingDay); document.querySelectorAll('.WEE-day-btn').forEach(b => b.classList.remove('active')); if(btn) btn.classList.add('active'); renderWeek(); };
window.viewWeek = (num) => { setWorkingWeek(num); };

const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; let touchStartX = 0; let touchEndX = 0;
const handleSwipe = () => {
    const swipeDistance = touchStartX - touchEndX;
    if (Math.abs(swipeDistance) > 60) {
        let currentIndex = daysOfWeek.indexOf(workingDay);
        if (swipeDistance > 0 && currentIndex < 6) currentIndex++; else if (swipeDistance < 0 && currentIndex > 0) currentIndex--;
        const btns = document.querySelectorAll('.WEE-day-btn'); if(btns[currentIndex]) btns[currentIndex].click(); 
    }
};

const attachSwipeGestures = (wrap, fg, cId) => {
    let startX = 0; let currentX = 0; let isSwiping = false;
    fg.addEventListener('touchstart', e => { if(e.target.closest('.drag-handle') || e.target.closest('.quick-action-btn')) return; startX = e.touches[0].clientX; fg.classList.add('swiping'); }, {passive: true});
    fg.addEventListener('touchmove', e => {
        if(e.target.closest('.drag-handle') || e.target.closest('.quick-action-btn')) return; currentX = e.touches[0].clientX; let diff = currentX - startX;
        if (Math.abs(diff) > 10) isSwiping = true; if (diff > 75) diff = 75 + (diff - 75) * 0.2; if (diff < -75) diff = -75 + (diff + 75) * 0.2; fg.style.transform = `translate3d(${diff}px, 0, 0)`;
    }, {passive: true});
    fg.addEventListener('touchend', e => {
        if(e.target.closest('.drag-handle') || e.target.closest('.quick-action-btn')) return; let diff = currentX - startX; fg.classList.remove('swiping'); fg.style.transform = `translate3d(0, 0, 0)`;
        if (isSwiping) { if (diff > 55) { cmdToggleClean(cId); } else if (diff < -55) { cmdSettlePaid(cId, 'job'); } } setTimeout(() => { isSwiping = false; }, 100); startX = 0; currentX = 0;
    });
    fg.addEventListener('click', e => { if(!isSwiping && !e.target.closest('.drag-handle') && !e.target.closest('.quick-action-btn')) { window.showJobBriefing(cId); } });
};

const attachDragDrop = (wrap, listContainer) => {
    const handle = wrap.querySelector('.drag-handle'); let isDragging = false;
    handle.addEventListener('touchstart', e => { isDragging = true; triggerHaptic(); wrap.classList.add('dragging'); }, {passive: true});
    handle.addEventListener('touchmove', e => {
        if (!isDragging) return; e.preventDefault(); const touchY = e.touches[0].clientY; const siblings = [...listContainer.querySelectorAll('.swipe-wrapper:not(.dragging)')];
        let nextSibling = siblings.find(sib => { const rect = sib.getBoundingClientRect(); return touchY <= rect.top + rect.height / 2; });
        if (nextSibling) { listContainer.insertBefore(wrap, nextSibling); } else { listContainer.appendChild(wrap); }
    }, {passive: false});
    handle.addEventListener('touchend', e => {
        if (!isDragging) return; isDragging = false; wrap.classList.remove('dragging'); triggerHaptic();
        const newOrderEls = [...listContainer.querySelectorAll('.swipe-wrapper')];
        newOrderEls.forEach((el, index) => { const customer = db.customers.find(c => c.id === el.dataset.id); if(customer) customer.order = index; }); saveData();
    });
};

window.renderWeek = () => { 
    const list = document.getElementById('WEE-list-container'); if(!list) return; list.innerHTML = '';
    
    let customersToday = db.customers.filter(c => String(c.week).trim() === String(curWeek).trim() && String(c.day).trim() === String(workingDay).trim()).sort((a, b) => { if (a.skipped === b.skipped) return (a.order || 0) - (b.order || 0); return a.skipped ? 1 : -1; });
    const progressDash = document.getElementById('WEE-progress-dashboard');
    if(customersToday.length === 0) { progressDash.innerHTML = ''; list.innerHTML = `<div class="empty-state"><span class="empty-icon">🏖️</span><div class="empty-text">Zero Jobs Today</div><div class="empty-sub">Enjoy the day off, or add a job!</div><button class="ADM-save-btn" style="width: 220px; font-size: 14px; height: 50px!important; margin-top: 20px; box-shadow: 0 5px 15px rgba(0,122,255,0.2);" onclick="openAddCustomerModal()">➕ ADD CUSTOMER</button></div>`; return; }

    let completedCount = customersToday.filter(c => c.cleaned || c.skipped).length; let totalCount = customersToday.length; let pct = totalCount === 0 ? 0 : (completedCount / totalCount) * 100; let dailyValue = customersToday.filter(c => c.cleaned).reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0);
    progressDash.innerHTML = `<div class="WEE-progress-wrap"><div class="WEE-progress-fill" style="width: ${pct}%;"></div></div><div class="WEE-progress-text">${completedCount} of ${totalCount} Done • £${dailyValue.toFixed(2)} Cleaned Today</div>`;

    customersToday.forEach(c => {
        const arrData = window.getArrearsData(c);
        const cleanBadge = c.cleaned ? `<span class="CST-badge badge-clean">✅ CLEANED</span>` : '';
        const arrearsBadge = arrData.isOwed ? `<span class="CST-badge badge-unpaid">❌ OWES £${arrData.total.toFixed(2)}</span>` : `<span class="CST-badge badge-paid">✅ PAID</span>`;
        const skipBadge = c.skipped ? `<span class="CST-badge badge-unpaid" style="background: rgba(255, 149, 0, 0.15); color: #cc7700;">⏭️ SKIPPED</span>` : '';
        
        const wrap = document.createElement('div'); wrap.className = 'swipe-wrapper'; wrap.dataset.id = c.id;
        const bg = document.createElement('div'); bg.className = 'swipe-bg'; bg.innerHTML = `<div class="action-left">✅</div><div class="action-right">💰</div>`;
        const fg = document.createElement('div'); fg.className = `swipe-fg CST-card-item ${c.skipped ? 'skipped-card' : ''}`;
        
        fg.innerHTML = `<div style="flex:1;"><strong style="font-size:20px; display:block;">${escapeHTML(c.name)}</strong><small style="color:var(--accent); font-weight:800; display:block;">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</small><div class="CST-card-badges">${cleanBadge} ${arrearsBadge} ${skipBadge}</div></div><div style="display:flex; align-items:center; gap: 8px;"><span class="price-text" style="font-weight:950; font-size:22px;">£${(parseFloat(c.price)||0).toFixed(2)}</span><button class="quick-action-btn" onclick="cmdQuickRoute('${c.id}', event)">📍</button><button class="quick-action-btn" onclick="cmdQuickCall('${c.phone}', event)">📞</button><div class="drag-handle">≡</div></div>`;
        
        wrap.appendChild(bg); wrap.appendChild(fg); list.appendChild(wrap); attachSwipeGestures(wrap, fg, c.id); attachDragDrop(wrap, list);
    });
};

window.cmdQuickCall = (phone, e) => { e.stopPropagation(); triggerHaptic(); if(!phone) return showToast("No phone number saved.", "error"); window.location.href = `tel:${escapeHTML(phone)}`; };

// ✨ RESTORED: Route My Day Logic
window.routeMyDay = () => {
    triggerHaptic();
    let jobs = db.customers.filter(c => String(c.week).trim() === String(curWeek).trim() && String(c.day).trim() === String(workingDay).trim() && !c.skipped && !c.cleaned).sort((a,b) => (a.order||0) - (b.order||0)).slice(0, 10);
    if(jobs.length === 0) return showToast("No uncleaned jobs to route!", "error");
    let baseUrl = "https://www.google.com/maps/dir/";
    let waypoints = jobs.map(c => encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`)).join('/');
    window.open(baseUrl + waypoints, '_blank');
};
window.cmdQuickRoute = (id, e) => { e.stopPropagation(); triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c) return; const mapQuery = encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`); window.open(`https://www.google.com/maps/search/?api=1&query=${mapQuery}`, '_blank'); };

window.cmdToggleSkip = (id) => { triggerHaptic(); const c = db.customers.find(x => x.id === id); c.skipped = !c.skipped; if(c.skipped) c.cleaned = false; saveData(); renderAllSafe(); window.closeBriefing(); showToast(c.skipped ? "Job Skipped ⏭️" : "Skip Removed", "normal"); };

window.cmdReceiptWA = (phone, amt, date) => { triggerHaptic(); if(!phone || phone === 'undefined') return showToast("No phone number saved.", "error"); let p = phone.replace(/\D/g, ''); if(p.startsWith('0')) p = '44' + p.substring(1); let msg = `Receipt from Hydro Pro 💧\n\nReceived: £${parseFloat(amt).toFixed(2)}\nDate: ${date}\n\nThank you for your business!`; window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank'); };
window.cmdReceiptSMS = (phone, amt, date) => { triggerHaptic(); if(!phone || phone === 'undefined') return showToast("No phone number saved.", "error"); let p = phone.replace(/\D/g, ''); let msg = `Receipt from Hydro Pro 💧\n\nReceived: £${parseFloat(amt).toFixed(2)}\nDate: ${date}\n\nThank you for your business!`; const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; const separator = isIOS ? '&' : '?'; window.location.href = `sms:${p}${separator}body=${encodeURIComponent(msg)}`; };

window.cmdChaseWA = (id, type) => {
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c || !c.phone) return showToast("No phone number saved.", "error");
    const arrData = window.getArrearsData(c); let p = c.phone.replace(/\D/g, ''); if(p.startsWith('0')) p = '44' + p.substring(1);
    let msg = "";
    if (type === 'polite') { msg = `Hi ${c.name}, hope you're well! Just a quick reminder of an outstanding balance of £${arrData.total.toFixed(2)} for your window clean. Let me know if you need the bank details again! 💧`; }
    if (type === 'firm') { msg = `Hi ${c.name}, this is a reminder that your account is now overdue by £${arrData.total.toFixed(2)}. Please arrange payment as soon as possible to avoid interruption to your service. Thank you, Hydro Pro.`; }
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.cmdChaseSMS = (id, type) => {
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c || !c.phone) return showToast("No phone number saved.", "error");
    const arrData = window.getArrearsData(c); let p = c.phone.replace(/\D/g, '');
    let msg = "";
    if (type === 'polite') { msg = `Hi ${c.name}, hope you're well! Just a quick reminder of an outstanding balance of £${arrData.total.toFixed(2)} for your window clean. Let me know if you need the bank details again! 💧`; }
    if (type === 'firm') { msg = `Hi ${c.name}, this is a reminder that your account is now overdue by £${arrData.total.toFixed(2)}. Please arrange payment as soon as possible to avoid interruption to your service. Thank you, Hydro Pro.`; }
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; const separator = isIOS ? '&' : '?';
    window.location.href = `sms:${p}${separator}body=${encodeURIComponent(msg)}`;
};

window.cmdGenerateInvoice = (id) => {
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c) return; const arrData = window.getArrearsData(c); const printArea = document.getElementById('print-area');
    printArea.innerHTML = `<div style="max-width: 800px; margin: 0 auto; font-family: sans-serif; color: black; padding: 20px;"><h1 style="color: #007aff; margin-bottom: 5px;">INVOICE</h1><p style="margin-top: 0; color: #666; font-size: 14px;"><strong>From:</strong> Hydro Pro Window Cleaning<br><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB')}</p><hr style="border: 1px solid #eee; margin: 20px 0;"><p style="font-size: 16px;"><strong>To:</strong><br>${escapeHTML(c.name)}<br>${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}<br>${escapeHTML(c.postcode)}</p><table style="width: 100%; text-align: left; border-collapse: collapse; margin-top: 30px;"><tr style="border-bottom: 2px solid #000;"><th style="padding: 10px 0;">Description</th><th style="padding: 10px 0; text-align: right;">Amount</th></tr><tr><td style="padding: 15px 0; border-bottom: 1px solid #eee;">Window Cleaning Service</td><td style="padding: 15px 0; border-bottom: 1px solid #eee; text-align: right;">£${parseFloat(c.price).toFixed(2)}</td></tr></table>${arrData.isOwed ? `<p style="text-align: right; font-size: 22px; margin-top: 30px; color: #ff453a;"><strong>Total Outstanding: £${arrData.total.toFixed(2)}</strong></p>` : `<p style="text-align: right; font-size: 22px; margin-top: 30px; color: #34C759;"><strong>PAID IN FULL</strong></p>`}<hr style="border: 1px solid #eee; margin-top: 50px;"><p style="font-size: 14px; color: #666; text-align: center;"><strong>Payment Details:</strong><br>${db.bank.name} | Acc: ${db.bank.acc}</p></div>`;
    window.print();
};

let currentUploadCustId = null;
window.triggerPhotoUpload = (id) => { triggerHaptic(); currentUploadCustId = id; document.getElementById('cameraInput').click(); };

window.handlePhotoUpload = (e) => {
    const file = e.target.files[0]; if(!file || !currentUploadCustId) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const MAX_WIDTH = 800; let width = img.width; let height = img.height;
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            canvas.width = width; canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7); 
            
            const c = db.customers.find(x => x.id === currentUploadCustId);
            if(c) {
                if(!c.photos) c.photos = [];
                c.photos.push({ id: Date.now(), data: dataUrl, date: new Date().toLocaleDateString('en-GB') });
                saveData(); showToast("Evidence Saved 📸", "success");
                window.showCustomerBriefing(c.id); 
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

// ✨ FIXED: Now correctly displays £0.00 for new customers instead of "Fully Paid" ✨
const generateArrearsHtml = (arrData, cId, context, phone) => { 
    if (!arrData.isOwed) return `<div class="CMD-alert-success" style="cursor:default;">✅ BALANCE: £0.00</div>`;
    let listHtml = arrData.breakdown.map(b => `<li>£${b.amt.toFixed(2)} - ${escapeHTML(b.month)}</li>`).join('');
    
    return `
        <div class="CMD-alert-danger" style="cursor:default;">
            <div class="CMD-alert-danger-title">⚠️ TOTAL OUTSTANDING: £${arrData.total.toFixed(2)}</div>
            <ul class="CMD-arrears-list">${listHtml}</ul>
            <div style="margin-top: 15px; font-size: 11px; font-weight: 900; opacity: 0.8; text-transform: uppercase;">👆 Tap below to settle or chase</div>
            
            <div style="display:flex; gap:10px; margin-top:15px;">
                <button class="ADM-save-btn" style="margin:0; height:45px!important; font-size:13px; background:rgba(0,0,0,0.2); box-shadow:none;" onclick="cmdSettlePaid('${cId}', '${context}')">💰 SETTLE ACCOUNT</button>
            </div>
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button class="ADM-save-btn" style="margin:0; height:40px!important; font-size:12px; background:white; color:var(--danger); box-shadow:none;" onclick="cmdChaseWA('${cId}', 'polite')">💬 POLITE CHASE</button>
                <button class="ADM-save-btn" style="margin:0; height:40px!important; font-size:12px; background:black; color:white; box-shadow:none;" onclick="cmdChaseWA('${cId}', 'firm')">🚨 FIRM CHASE</button>
            </div>
        </div>`;
};

const generateHistoryHtml = (id, phone) => { 
    const history = db.history.filter(h => h.custId === id).slice(-3).reverse();
    if (history.length === 0) return `<div class="empty-state" style="padding: 10px;"><div class="empty-text" style="font-size:14px;">No Payment History</div></div>`;
    return history.map(h => `<div class="CMD-history-row" style="align-items:center;"><div><span>${escapeHTML(h.date)}</span> <span style="opacity:0.5; font-size:10px; margin-left:5px;">${h.method === 'Bank' ? '🏦' : '💵'}</span></div><div style="display:flex; gap:10px; align-items:center;"><span style="color:var(--success);">£${parseFloat(h.amt).toFixed(2)}</span><button class="quick-action-btn" style="width:28px; height:28px; font-size:12px; margin-left:0;" onclick="cmdReceiptWA('${escapeHTML(phone)}', '${h.amt}', '${escapeHTML(h.date)}')">🧾</button></div></div>`).join('');
};

const generatePhotoHtml = (c) => {
    if (!c.photos || c.photos.length === 0) return '';
    const imgTags = c.photos.map(p => `<img src="${p.data}" class="CMD-photo-thumb" onclick="window.open('${p.data}')">`).join('');
    return `<h3 class="CMD-history-hdr">Evidence Photos</h3><div class="CMD-photo-gallery">${imgTags}</div>`;
};

// ✨ RESTORED: closeBriefing logic that allows the 'X' button to work! ✨
window.closeBriefing = () => { document.getElementById('briefingModal').classList.add('hidden'); };

window.showJobBriefing = (id) => {
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c) return;
    const container = document.getElementById('briefingData'); const arrData = window.getArrearsData(c);
    const mapQuery = encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`); const navUrl = `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;
    const notesHtml = c.notes ? `<div class="CMD-notes-box">📝 ${escapeHTML(c.notes)}</div>` : '';

    container.innerHTML = `
        <div class="CMD-header"><h2>${escapeHTML(c.name)}</h2><button class="CMD-header-edit-btn" onclick="openAddCustomerModal('${c.id}')">✏️</button><div class="CMD-header-sub">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</div></div>
        ${notesHtml}
        ${generateArrearsHtml(arrData, c.id, 'job', c.phone)}
        <div class="CMD-action-grid">
            <button class="CMD-action-btn clean" onclick="cmdToggleClean('${c.id}')"><span style="font-size:24px;">🧼</span> <br>${c.cleaned ? 'UNDO CLEAN' : 'MARK CLEAN'}</button>
            <button class="CMD-action-btn route" onclick="window.open('${navUrl}', '_blank')"><span style="font-size:24px;">📍</span> <br>NAVIGATE</button>
            <button class="CMD-action-btn call" onclick="window.location.href='tel:${escapeHTML(c.phone)}'"><span style="font-size:24px;">📞</span> <br>CALL</button>
            <button class="CMD-action-btn skip" onclick="cmdToggleSkip('${c.id}')"><span style="font-size:24px;">⏭️</span> <br>${c.skipped ? 'UNSKIP' : 'SKIP JOB'}</button>
            <button class="CMD-action-btn" style="background:rgba(0,0,0,0.05);" onclick="triggerPhotoUpload('${c.id}')"><span style="font-size:24px;">📷</span> <br>LOG EVIDENCE</button>
            <button class="CMD-action-btn invoice" onclick="cmdGenerateInvoice('${c.id}')"><span style="font-size:24px;">📄</span> <br>INVOICE</button>
            <button class="CMD-action-btn whatsapp" onclick="cmdReceiptWA('${escapeHTML(c.phone)}', '${c.price}', '${new Date().toLocaleDateString('en-GB')}')"><span style="font-size:24px;">💬</span> <br>WA REC</button>
            <button class="CMD-action-btn sms" onclick="cmdReceiptSMS('${escapeHTML(c.phone)}', '${c.price}', '${new Date().toLocaleDateString('en-GB')}')"><span style="font-size:24px;">📱</span> <br>SMS REC</button>
            <button class="CMD-action-btn ai-btn ai-glow-btn" onclick="triggerAI('reply', '${c.id}')"><span style="font-size:24px;">✨</span> <br>SMART REPLY</button>
        </div>
        ${generatePhotoHtml(c)}
        <h3 class="CMD-history-hdr">Rolling History (Tap 🧾 for receipt)</h3><div class="CMD-history-box">${generateHistoryHtml(c.id, c.phone)}</div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

window.showCustomerBriefing = (id) => { 
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c) return;
    const container = document.getElementById('briefingData'); const arrData = window.getArrearsData(c);
    const notesHtml = c.notes ? `<div class="CMD-notes-box">📝 ${escapeHTML(c.notes)}</div>` : '';

    container.innerHTML = `
        <div class="CMD-header"><h2>${escapeHTML(c.name)}</h2><button class="CMD-header-edit-btn" onclick="openAddCustomerModal('${c.id}')">✏️</button><div class="CMD-header-sub">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)} <br>${escapeHTML(c.postcode || '')}</div></div>
        <div class="CMD-details-box"><div class="CMD-detail-row"><span>📞 Phone</span><span>${escapeHTML(c.phone) || 'N/A'}</span></div><div class="CMD-detail-row"><span>💰 Price</span><span>£${parseFloat(c.price).toFixed(2)}</span></div><div class="CMD-detail-row"><span>📅 Week</span><span>Week ${escapeHTML(c.week)}</span></div><div class="CMD-detail-row"><span>📆 Day</span><span>${escapeHTML(c.day)}</span></div><div class="CMD-detail-row"><span>🔄 Cycle</span><span>${escapeHTML(c.freq || 4)} Weekly</span></div></div>
        ${notesHtml}
        ${generateArrearsHtml(arrData, c.id, 'cust', c.phone)}
        <div style="display:flex; gap:10px; margin-bottom:20px;">
            <button class="ADM-save-btn" style="margin-top:0; height: 50px!important; font-size: 12px; background: rgba(0,0,0,0.05); color: var(--text); box-shadow: none; flex:1;" onclick="triggerPhotoUpload('${c.id}')">📷 LOG EVIDENCE</button>
            <button class="ADM-save-btn" style="margin-top:0; height: 50px!important; font-size: 12px; background: transparent; border: 2px solid var(--accent); color: var(--accent); box-shadow: none; flex:1;" onclick="cmdGenerateInvoice('${c.id}')">📄 PDF INVOICE</button>
        </div>
        ${generatePhotoHtml(c)}
        <h3 class="CMD-history-hdr">Rolling History (Tap 🧾 for receipt)</h3><div class="CMD-history-box">${generateHistoryHtml(c.id, c.phone)}</div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

const getFinancialYearDates = (yearStr) => {
    const startYear = parseInt(yearStr);
    return { start: new Date(`${startYear}-04-06`), end: new Date(`${startYear + 1}-04-05`) };
};

const parseGBDate = (dateStr) => {
    const parts = dateStr.split('/');
    if(parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    return new Date(); 
};

window.cmdGenerateTaxPDF = () => {
    triggerHaptic();
    const yearStr = document.getElementById('taxYearSelect').value;
    const { start, end } = getFinancialYearDates(yearStr);
    
    let totalIncome = 0; let expData = { Fuel:0, Equipment:0, Food:0, Marketing:0, Other:0 };
    
    db.history.forEach(h => {
        const d = parseGBDate(h.date);
        if(d >= start && d <= end) totalIncome += parseFloat(h.amt);
    });
    
    let totalSpend = 0;
    db.expenses.forEach(e => {
        const d = parseGBDate(e.date);
        if(d >= start && d <= end) {
            const amt = parseFloat(e.amt); totalSpend += amt;
            if(expData[e.cat] !== undefined) expData[e.cat] += amt; else expData.Other += amt;
        }
    });

    const printArea = document.getElementById('print-area');
    printArea.innerHTML = `
        <div style="max-width: 800px; margin: 0 auto; font-family: sans-serif; color: black; padding: 20px;">
            <h1 style="color: #007aff; margin-bottom: 5px;">ANNUAL TAX REPORT</h1>
            <p style="margin-top: 0; color: #666; font-size: 14px;"><strong>Tax Year:</strong> 6 April ${start.getFullYear()} - 5 April ${end.getFullYear()}</p>
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <h2 style="margin-bottom:10px;">Income</h2>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding-bottom:5px;"><span>Gross Turnover</span><strong>£${totalIncome.toFixed(2)}</strong></div>
            <h2 style="margin-top:30px; margin-bottom:10px;">Allowable Expenses</h2>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:5px 0;"><span>Fuel / Motoring</span><span>£${expData.Fuel.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:5px 0;"><span>Equipment / Materials</span><span>£${expData.Equipment.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:5px 0;"><span>Advertising / Marketing</span><span>£${expData.Marketing.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:5px 0;"><span>Subsistence (Food)</span><span>£${expData.Food.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between; border-bottom:2px solid #000; padding:5px 0;"><span>Other</span><span>£${expData.Other.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between; padding:10px 0;"><strong>Total Expenses</strong><strong style="color:#ff453a;">-£${totalSpend.toFixed(2)}</strong></div>
            <hr style="border: 1px solid #eee; margin: 30px 0;">
            <p style="text-align: right; font-size: 26px; color: #34C759;"><strong>Net Profit: £${(totalIncome - totalSpend).toFixed(2)}</strong></p>
            <p style="font-size: 12px; color: #999; text-align: center; margin-top:50px;">Generated by Ultimate Hydro Pro.</p>
        </div>
    `;
    window.print();
};

window.cmdGenerateMTD = () => {
    triggerHaptic();
    const yearStr = document.getElementById('taxYearSelect').value;
    const qStr = document.getElementById('taxQuarterSelect').value;
    const startYear = parseInt(yearStr);
    
    let start, end;
    if(qStr === 'Q1') { start = new Date(`${startYear}-04-06`); end = new Date(`${startYear}-07-05`); }
    if(qStr === 'Q2') { start = new Date(`${startYear}-07-06`); end = new Date(`${startYear}-10-05`); }
    if(qStr === 'Q3') { start = new Date(`${startYear}-10-06`); end = new Date(`${startYear+1}-01-05`); }
    if(qStr === 'Q4') { start = new Date(`${startYear+1}-01-06`); end = new Date(`${startYear+1}-04-05`); }

    let csv = "Date,Reference,Description,Amount,Category\n";
    db.history.forEach(h => {
        const d = parseGBDate(h.date);
        if(d >= start && d <= end) csv += `${h.date},INC-${h.custId},Sales Income,${h.amt},Sales\n`;
    });
    db.expenses.forEach(e => {
        const d = parseGBDate(e.date);
        if(d >= start && d <= end) csv += `${e.date},EXP-${e.id},${escapeHTML(e.desc)},-${e.amt},${escapeHTML(e.cat)}\n`;
    });

    triggerDownload(csv, `HydroPro_MTD_${yearStr}_${qStr}.csv`);
};

window.openExpenseModal = () => { triggerHaptic(); document.getElementById('mExpDesc').value = ''; document.getElementById('mExpAmt').value = ''; document.getElementById('mExpCat').value = 'Fuel'; document.getElementById('expenseModal').classList.remove('hidden'); };
window.closeExpenseModal = () => { document.getElementById('expenseModal').classList.add('hidden'); };

window.addFinanceExpense = () => { 
    triggerHaptic(); const desc = document.getElementById('mExpDesc').value.trim(); const amt = parseFloat(document.getElementById('mExpAmt').value); const cat = document.getElementById('mExpCat').value;
    if(!desc || isNaN(amt) || amt <= 0) return showToast("Description and Amount required", "error");
    db.expenses.push({ id: Date.now(), desc, amt, cat, date: new Date().toLocaleDateString('en-GB') }); saveData(); closeExpenseModal();
    openTab('finances-root', 'nav-fin-btn'); showToast("Expense Logged", "success");
};

const arc3DPlugin = {
    id: 'arc3DPlugin',
    beforeDatasetDraw: (chart, args, options) => {
        if(typeof chart === 'undefined' || !chart.ctx) return;
        const ctx = chart.ctx; ctx.save(); ctx.shadowColor = document.body.classList.contains('dark-mode') ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.2)'; ctx.shadowBlur = 15; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 10;
    },
    afterDatasetDraw: (chart, args, options) => { if(typeof chart !== 'undefined' && chart.ctx) chart.ctx.restore(); }
};

window.renderFinances = () => {
    const blackCard = document.getElementById('FIN-black-card'); const bentoBox = document.getElementById('FIN-bento-box'); const ledger = document.getElementById('FIN-ledger-list'); 
    if(!blackCard || !bentoBox || !ledger) return;
    
    let income = 0, spend = 0, expected = 0, totalArrears = 0, forecasted = 0; 
    db.customers.forEach(c => {
        income += (parseFloat(c.paidThisMonth) || 0); expected += (parseFloat(c.price) || 0);
        if (!c.cleaned && !c.skipped) forecasted += (parseFloat(c.price) || 0);
        const arrData = window.getArrearsData(c); if(arrData.isOwed) totalArrears += arrData.total; 
    });
    db.expenses.forEach(e => spend += (parseFloat(e.amt) || 0));
    const progressPct = expected > 0 ? Math.min((income / expected) * 100, 100) : 0;

    let cashTotal = 0; let bankTotal = 0; let currentMonthStr = new Date().toLocaleDateString('en-GB').substring(3);
    db.history.forEach(h => { if (h.date && h.date.includes(currentMonthStr)) { if (h.method === 'Bank') bankTotal += parseFloat(h.amt); else cashTotal += parseFloat(h.amt); } });
    const netProfit = income - spend;

    blackCard.innerHTML = `<div class="fbc-title">Net Profit</div><div class="fbc-balance">£${netProfit.toFixed(2)}</div><div class="fbc-split-row"><div class="fbc-split-item"><span class="fbc-split-label">💵 Cash in Hand</span><span class="fbc-split-val">£${cashTotal.toFixed(2)}</span></div><div class="fbc-split-item" style="text-align: right; align-items: flex-end;"><span class="fbc-split-label">Banked 🏦</span><span class="fbc-split-val">£${bankTotal.toFixed(2)}</span></div></div>`;
    bentoBox.innerHTML = `<div class="fin-bento-card"><div class="fbc-icon-wrap fbc-green">📈</div><div><div class="fin-bento-lbl">Income</div><div class="fin-bento-val">£${income.toFixed(2)}</div></div></div><div class="fin-bento-card"><div class="fbc-icon-wrap fbc-red">📉</div><div><div class="fin-bento-lbl">Spent</div><div class="fin-bento-val">£${spend.toFixed(2)}</div></div></div><div class="fin-bento-card"><div class="fbc-icon-wrap fbc-orange">⚠️</div><div><div class="fin-bento-lbl">Arrears</div><div class="fin-bento-val">£${totalArrears.toFixed(2)}</div></div></div><div class="fin-bento-card"><div class="fbc-icon-wrap fbc-blue">🎯</div><div><div class="fin-bento-lbl">Collected</div><div class="fin-bento-val">${Math.round(progressPct)}%</div></div></div>`;
    
    const ctx = document.getElementById('financeChartCanvas');
    if (ctx && typeof Chart !== 'undefined') {
        if (financeChartInstance) financeChartInstance.destroy(); 
        let labels = [`Collected: £${income.toFixed(2)}`, `Debt: £${totalArrears.toFixed(2)}`, `Forecasted: £${forecasted.toFixed(2)}`]; let chartData = [income, totalArrears, forecasted]; let colors = ['#34C759', '#ff453a', '#007aff']; let isDarkMode = document.body.classList.contains('dark-mode');
        if (income > 0 || totalArrears > 0 || forecasted > 0) {
            financeChartInstance = new Chart(ctx, { 
                type: 'doughnut', data: { labels: labels, datasets: [{ data: chartData, backgroundColor: colors, borderWidth: 4, borderColor: isDarkMode ? '#1c1c1e' : '#ffffff', borderRadius: 15, hoverOffset: 6, spacing: 5 }] }, 
                options: { responsive: true, maintainAspectRatio: false, cutout: '75%', layout: { padding: 10 }, plugins: { legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true, pointStyle: 'circle', color: isDarkMode ? '#fff' : '#000', font: { family: '"Plus Jakarta Sans", sans-serif', weight: 'bold', size: 13 } } }, tooltip: { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)', titleColor: isDarkMode ? '#000' : '#fff', bodyColor: isDarkMode ? '#000' : '#fff', padding: 12, cornerRadius: 12, displayColors: false, callbacks: { label: function(context) { return ' ' + context.label; } } } } } 
            });
        }
    }
    
    if (db.expenses.length === 0) { ledger.innerHTML = `<div class="empty-state" style="padding-top:20px;"><span class="empty-icon">🧾</span><div class="empty-text">No Expenses Yet</div><div class="empty-sub">Your ledger is completely clean.</div></div>`; 
    } else { 
        let ledgerHtml = '';
        [...db.expenses].reverse().forEach(item => {
            let catIcon = "🏢"; if(item.cat === 'Fuel') catIcon = "⛽"; if(item.cat === 'Equipment') catIcon = "🧽"; if(item.cat === 'Food') catIcon = "🍔"; if(item.cat === 'Marketing') catIcon = "📣"; 
            ledgerHtml += `<div class="ledger-item"><div class="ledger-left"><div class="ledger-icon">${catIcon}</div><div class="ledger-details"><span class="ledger-desc">${escapeHTML(item.desc)}</span><span class="ledger-date">${escapeHTML(item.date)}</span></div></div><div class="ledger-amt">-£${parseFloat(item.amt).toFixed(2)}</div></div>`;
        }); 
        ledger.innerHTML = ledgerHtml; 
    }
};

// ✨ RESTORED: Missing function for Setting Payment Method ✨
window.setPayMethod = (method) => {
    currentPayMethod = method;
    document.getElementById('btnPayCash').classList.remove('active');
    document.getElementById('btnPayBank').classList.remove('active');
    if (method === 'Cash') document.getElementById('btnPayCash').classList.add('active');
    if (method === 'Bank') document.getElementById('btnPayBank').classList.add('active');
};

// ✨ RESTORED: Missing function for the Tomorrow Reminder feature ✨
window.openTomorrowModal = () => {
    triggerHaptic();
    const list = document.getElementById('tomorrow-list');
    list.innerHTML = '';
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let todayIdx = days.indexOf(workingDay);
    let tmrwIdx = (todayIdx + 1) % 7;
    let tmrwDay = days[tmrwIdx];
    let tmrwWeek = curWeek;
    if (tmrwIdx === 1 && todayIdx === 0) { tmrwWeek = curWeek >= 5 ? 1 : curWeek + 1; }
    
    document.getElementById('tomorrow-title-sub').innerText = `Wk ${tmrwWeek} - ${tmrwDay}`;
    
    let tmrwJobs = db.customers.filter(c => String(c.week).trim() === String(tmrwWeek).trim() && String(c.day).trim() === String(tmrwDay).trim() && !c.skipped);
    
    if (tmrwJobs.length === 0) {
        list.innerHTML = '<div style="padding:20px; text-align:center; opacity:0.5; font-weight:800;">No jobs scheduled for tomorrow.</div>';
    } else {
        tmrwJobs.forEach(c => {
            let p = (c.phone || '').replace(/\D/g, '');
            let isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; 
            let sep = isIOS ? '&' : '?';
            let msg = `Hi ${c.name}, just a quick reminder from Hydro Pro that your window clean is due tomorrow! Please leave any side gates unlocked. Thank you! 💧`;
            let smsLink = p ? `sms:${p}${sep}body=${encodeURIComponent(msg)}` : '#';
            let waLink = p ? `https://wa.me/${p.startsWith('0') ? '44' + p.substring(1) : p}?text=${encodeURIComponent(msg)}` : '#';
            
            list.innerHTML += `
                <div style="background:var(--ios-grey); padding:15px; border-radius:15px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="flex:1;"><strong>${escapeHTML(c.name)}</strong><br><small>${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</small></div>
                    <div style="display:flex; gap:10px;">
                        <button class="quick-action-btn" style="margin:0; background:rgba(52, 199, 89, 0.2); color:var(--success);" onclick="window.open('${waLink}', '_blank')">💬</button>
                        <button class="quick-action-btn" style="margin:0; background:rgba(0, 122, 255, 0.2); color:var(--accent);" onclick="window.location.href='${smsLink}'">📱</button>
                    </div>
                </div>
            `;
        });
    }
    document.getElementById('tomorrowModal').classList.remove('hidden');
};
window.closeTomorrowModal = () => { document.getElementById('tomorrowModal').classList.add('hidden'); };

const getIcon = (code) => { const map = { '01d':'☀️','01n':'🌙','02d':'⛅','02n':'☁️','03d':'☁️','03n':'☁️','04d':'☁️','04n':'☁️','09d':'🌧️','09n':'🌧️','10d':'🌧️','10n':'🌧️','11d':'🌦️','11n':'🌧️','13d':'🌨️','13n':'🌨️','50d':'💨','50n':'💨' }; return map[code] || '🌤️'; };
async function initWeather() { 
    const wDash = document.getElementById('WTH-dashboard');
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (pos) => { 
            try { 
                const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${W_API_KEY}&units=metric`); 
                const data = await res.json(); const temp = `${Math.round(data.main.temp)}°C`; const currentIcon = getIcon(data.weather[0].icon); const currentDesc = data.weather[0].description;
                const hwIcon = document.getElementById('hw-icon'); const hwTemp = document.getElementById('hw-temp'); const hwDesc = document.getElementById('hw-desc');
                if(hwIcon) hwIcon.innerText = currentIcon; if(hwTemp) hwTemp.innerText = temp; if(hwDesc) hwDesc.innerText = currentDesc;
                const fRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${W_API_KEY}&units=metric`); const fData = await fRes.json();
                const dailyData = fData.list.filter(item => item.dt_txt.includes('12:00:00')).slice(0, 5);
                let forecastHtml = dailyData.map(day => { const dateObj = new Date(day.dt * 1000); const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(); return `<div class="WTH-card"><span class="WTH-day">${dayName}</span><span class="WTH-icon">${getIcon(day.weather[0].icon)}</span><span class="WTH-temps">${Math.round(day.main.temp)}°C</span></div>`; }).join('');
                if(wDash) { wDash.innerHTML = `<div class="WTH-hero"><div class="WTH-icon" style="font-size: 50px;">${currentIcon}</div><div class="WTH-hero-temp">${temp}</div><div class="WTH-hero-desc">${currentDesc}</div><div style="font-size: 14px; font-weight: 900; color: var(--text); opacity: 0.5; margin-top: 15px; letter-spacing: 1px; text-transform: uppercase;">📍 ${escapeHTML(data.name)}</div></div><h3 class="ADM-hdr" style="margin: 25px 0 10px;">5-Day Forecast</h3>${forecastHtml}`; }
            } catch (e) { if (wDash) wDash.innerHTML = `<div class="empty-state"><span class="empty-icon">📡</span><div class="empty-text">Weather Offline</div><div class="empty-sub">Check your connection to pull the radar.</div></div>`; } 
        });
    }
}
