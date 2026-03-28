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

// ✨ UPGRADED: Dual-Vault IndexedDB (v2) for memory safety ✨
const idb = {
    db: null,
    init: () => new Promise((resolve, reject) => {
        const req = indexedDB.open('HydroPro_V5_DB', 2); 
        req.onupgradeneeded = e => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('appData')) database.createObjectStore('appData');
            if (!database.objectStoreNames.contains('photos')) database.createObjectStore('photos', { keyPath: 'id' });
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
    savePhoto: (photoObj) => new Promise(resolve => {
        const req = idb.db.transaction('photos', 'readwrite').objectStore('photos').put(photoObj);
        req.onsuccess = () => resolve();
    }),
    getPhotos: (custId) => new Promise(resolve => {
        const tx = idb.db.transaction('photos', 'readonly');
        const req = tx.objectStore('photos').getAll();
        req.onsuccess = () => {
            const all = req.result || [];
            resolve(all.filter(p => String(p.custId) === String(custId)));
        };
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

// ✨ FIXED: Syntax-safe HTML Escaping ✨
const escapeHTML = (str) => {
    if (!str && str !== 0) return '';
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

// ✨ NEW: The Auto-Cycle Engine ✨
const runCycleEngine = () => {
    const DAY_MS = 86400000;
    let updated = false;
    db.customers.forEach(c => {
        if (!c.cycleStartDate) {
            c.cycleStartDate = Date.now();
            updated = true;
        }
        const freq = parseInt(c.freq) || 4;
        const cycleLengthMS = freq * 7 * DAY_MS;
        if (Date.now() - c.cycleStartDate >= cycleLengthMS) {
            let price = c.cleaned ? (parseFloat(c.price) || 0) : 0;
            let paid = parseFloat(c.paidThisMonth) || 0;
            if (paid < price) {
                if (!c.pastArrears) c.pastArrears = [];
                let monthName = new Date(c.cycleStartDate).toLocaleString('en-GB', { month: 'short', year: '2-digit' });
                c.pastArrears.push({ month: monthName, amt: price - paid });
            }
            c.cleaned = false; c.skipped = false; c.paidThisMonth = 0; c.cycleStartDate = Date.now();
            updated = true;
        }
    });
    if (updated) idb.set('master_db', db);
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
            ptrIndicator.classList.remove('visible'); triggerHaptic(); window.showToast("Fetching Radar...", "normal"); initWeather();
        }
        wthStartY = 0;
    });
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Ultimate Hydro Pro v5.1 Booting...");
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
        runCycleEngine();
        let photosMigrated = false;
        for (let c of db.customers) {
            if (c.photos && c.photos.length > 0) {
                for (let p of c.photos) { await idb.savePhoto({ id: p.id || Date.now() + Math.random(), custId: c.id, data: p.data, date: p.date }); }
                delete c.photos; photosMigrated = true;
            }
        }
        if (photosMigrated) await idb.set('master_db', db);
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

    window.renderAllSafe(); initWeather(); initPTR();

    const weekView = document.getElementById('week-view-root');
    if(weekView) {
        weekView.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
        weekView.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; handleSwipe(); }, {passive: true});
    }
});

window.runDeepScanRecovery = async () => {
    triggerHaptic(); window.showToast("Scanning device memory...", "normal");
    setTimeout(async () => {
        let foundDb = null;
        for (let i = 0; i < localStorage.length; i++) {
            let key = localStorage.key(i);
            if (key.includes('Hydro') || key.includes('DB') || key.includes('Gold')) {
                try {
                    let parsed = JSON.parse(localStorage.getItem(key));
                    if (parsed && parsed.customers && parsed.customers.length > (foundDb ? foundDb.customers.length : 0)) { foundDb = parsed; }
                } catch(e) { } 
            }
        }
        if (foundDb && foundDb.customers.length > 0) {
            db = foundDb; await idb.set('master_db', db); window.renderAllSafe(); window.showToast(`Recovered ${db.customers.length} customers! 🛟`, "success");
        } else { window.showToast("No ghost data found in memory.", "error"); }
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

window.setThemeMode = (isDark) => { triggerHaptic(); applyTheme(isDark); localStorage.setItem('HP_Theme', isDark); if(document.getElementById('finances-root').classList.contains('active')) window.renderFinances(); };
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
    window.scrollTo(0,0); window.renderAllSafe();
};

window.renderAllSafe = () => {
    try {
        const home = document.getElementById('home-root'); if(home && home.classList.contains('active')) window.renderHome();
        const master = document.getElementById('master-root'); if(master && master.classList.contains('active')) window.renderMaster();
        const finances = document.getElementById('finances-root'); if(finances && finances.classList.contains('active')) window.renderFinances();
        const week = document.getElementById('week-view-root'); if(week && week.classList.contains('active')) window.renderWeek();
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

window.openAITeaserModal = () => { triggerHaptic(); document.getElementById('aiTeaserModal').classList.remove('hidden'); };
window.closeAITeaserModal = () => { document.getElementById('aiTeaserModal').classList.add('hidden'); };
window.saveModalAIKey = () => {
    triggerHaptic(); const key = document.getElementById('aiKeyInputModal').value.trim();
    if(key) { localStorage.setItem('HP_AI_Key', key); document.getElementById('sAIKey').value = key; window.showToast("AI Engine Connected! ✨", "success"); window.closeAITeaserModal(); }
};
window.saveSettingsAIKey = () => {
    triggerHaptic(); const key = document.getElementById('sAIKey').value.trim();
    if(key) { localStorage.setItem('HP_AI_Key', key); window.showToast("AI Engine Secured! ✨", "success"); } else { localStorage.removeItem('HP_AI_Key'); window.showToast("AI Engine Disabled.", "normal"); }
};
window.triggerAI = (context, id = null) => { triggerHaptic(); if(!localStorage.getItem('HP_AI_Key')) { window.openAITeaserModal(); } else { window.showToast("Listening... (Awaiting Config)", "normal"); } };

window.openAddCustomerModal = (id = null) => { 
    triggerHaptic(); editingCustomerId = id;
    const titleEl = document.getElementById('customerModalTitle'); const deleteBtn = document.getElementById('deleteCustomerBtn');
    if (id) {
        const c = db.customers.find(x => x.id === id); if(!c) return;
        titleEl.innerText = "Edit Customer"; deleteBtn.classList.remove('hidden'); 
        document.getElementById('cName').value = c.name || ''; document.getElementById('cHouseNum').value = c.houseNum || '';
        document.getElementById('cStreet').value = c.street || ''; document.getElementById('cPostcode').value = c.postcode || '';
        document.getElementById('cPhone').value = c.phone || ''; document.getElementById('cPrice').value = c.price || '';
        document.getElementById('cNotes').value = c.notes || ''; document.getElementById('cFreq').value = c.freq || '4'; 
        document.getElementById('cWeek').value = c.week || '1'; document.getElementById('cDay').value = c.day || 'Mon';
    } else {
        titleEl.innerText = "Add Customer"; deleteBtn.classList.add('hidden'); 
        document.getElementById('cName').value = ''; document.getElementById('cHouseNum').value = ''; document.getElementById('cStreet').value = '';
        document.getElementById('cPostcode').value = ''; document.getElementById('cPhone').value = ''; document.getElementById('cPrice').value = '';
        document.getElementById('cNotes').value = ''; document.getElementById('cFreq').value = '4'; 
        document.getElementById('cWeek').value = '1'; document.getElementById('cDay').value = 'Mon';
    }
    document.getElementById('addCustomerModal').classList.remove('hidden'); 
};
window.closeAddCustomerModal = () => { editingCustomerId = null; document.getElementById('addCustomerModal').classList.add('hidden'); };

window.saveCustomer = () => {
    triggerHaptic(); const name = document.getElementById('cName').value.trim(); if(!name) { window.showToast("Customer Name is required", "error"); return; }
    const details = { name, houseNum: document.getElementById('cHouseNum').value.trim(), street: document.getElementById('cStreet').value.trim(), postcode: document.getElementById('cPostcode').value.trim().toUpperCase(), phone: document.getElementById('cPhone').value.trim(), price: parseFloat(document.getElementById('cPrice').value) || 0, notes: document.getElementById('cNotes').value.trim(), freq: parseInt(document.getElementById('cFreq').value) || 4, week: document.getElementById('cWeek').value, day: document.getElementById('cDay').value };
    if (editingCustomerId) { const cIndex = db.customers.findIndex(x => x.id === editingCustomerId); if (cIndex > -1) { db.customers[cIndex] = { ...db.customers[cIndex], ...details }; window.showToast("Updated", "success"); } }
    else { db.customers.push({ id: Date.now().toString(), order: Date.now(), cycleStartDate: Date.now(), ...details, cleaned: false, skipped: false, paidThisMonth: 0, pastArrears: [] }); window.showToast("Added", "success"); }
    curWeek = parseInt(details.week); workingDay = details.day; localStorage.setItem('HP_curWeek', curWeek); localStorage.setItem('HP_workingDay', workingDay);
    window.saveData(); window.closeAddCustomerModal(); window.renderAllSafe(); 
};

window.cmdDeleteCustomer = () => {
    if (!editingCustomerId) return;
    const c = db.customers.find(x => x.id === editingCustomerId); if (!c) return;
    window.showConfirm("Delete Customer?", `Are you sure you want to permanently remove ${escapeHTML(c.name)}?`, () => {
        db.customers = db.customers.filter(x => x.id !== editingCustomerId); window.saveData(); window.showToast("Deleted.", "normal"); window.closeAddCustomerModal(); window.renderAllSafe();
    });
};
window.saveBank = () => { triggerHaptic(); db.bank.name = document.getElementById('bName').value; db.bank.acc = document.getElementById('bAcc').value; window.saveData(); window.showToast("Bank Details Secured 🔒", "success"); };

window.showConfirm = (title, text, actionCallback) => { triggerHaptic(); document.getElementById('confirmTitle').innerText = escapeHTML(title); document.getElementById('confirmText').innerText = escapeHTML(text); confirmCallback = actionCallback; document.getElementById('confirmModal').classList.remove('hidden'); };
window.closeConfirmModal = () => { document.getElementById('confirmModal').classList.add('hidden'); confirmCallback = null; };
document.getElementById('confirmActionBtn').addEventListener('click', () => { if(confirmCallback) confirmCallback(); window.closeConfirmModal(); });

window.cmdCycleMonth = () => { window.showToast("Cycle Engine is running automatically.", "normal"); };
window.cmdNuclear = () => { window.showConfirm("FACTORY RESET?", "This will permanently delete ALL data.", async () => { await idb.clear(); localStorage.removeItem(DB_KEY); location.reload();
