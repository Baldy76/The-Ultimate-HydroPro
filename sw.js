"use strict";

const DB_KEY = 'HydroPro_Gold_V57'; 
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
let confirmCallback = null; 
let showArrearsOnly = false;
let editingCustomerId = null;
let currentPayMethod = 'Cash'; 

// 🛡️ The Dual-Vault DB
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

// 🛡️ Safe HTML Escaping (Hardcoded to prevent parsing errors)
window.escapeHTML = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&' + 'amp;')
        .replace(/</g, '&' + 'lt;')
        .replace(/>/g, '&' + 'gt;')
        .replace(/"/g, '&' + 'quot;')
        .replace(/'/g, '&' + '#39;'); 
};

window.closeAllModals = () => {
    document.querySelectorAll('.modal-overlay').forEach(modal => modal.classList.add('hidden'));
    confirmCallback = null;
    editingCustomerId = null;
};

window.getArrearsData = (c) => {
    const currentMonthStr = new Date().toLocaleString('en-GB', { month: 'short' });
    let pastLog = c.pastArrears || [];
    let thisMonthCharge = c.cleaned ? (parseFloat(c.price) || 0) : 0;
    let currentOwed = thisMonthCharge - (parseFloat(c.paidThisMonth) || 0);
    let breakdown = pastLog.map(a => ({ month: a.month, amt: parseFloat(a.amt) || 0 }));
    if (currentOwed > 0.01) breakdown.push({ month: currentMonthStr, amt: currentOwed });
    const totalOwed = breakdown.reduce((sum, item) => sum + item.amt, 0);
    return { isOwed: totalOwed > 0.01, total: totalOwed, monthsString: breakdown.map(b => b.month).join(', '), breakdown: breakdown };
};

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
            
            c.cleaned = false;
            c.skipped = false;
            c.paidThisMonth = 0;
            c.cycleStartDate = Date.now();
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
    console.log("Ultimate Hydro Pro v5.6 Booting...");
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
                for (let p of c.photos) {
                    await idb.savePhoto({ id: p.id || Date.now() + Math.random(), custId: c.id, data: p.data, date: p.date });
                }
                delete c.photos; 
                photosMigrated = true;
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
                    if (parsed && parsed.customers && parsed.customers.length > (foundDb ? foundDb.customers.length : 0)) foundDb = parsed;
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
        document.querySelectorAll('.nav-item, .home-fab').forEach(btn => btn.classList.remove('active'));
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
    document.getElementById('home-greeting').innerText = greeting;

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
    document.getElementById('aiTeaserModal').classList.remove('hidden');
};
window.closeAITeaserModal = () => { window.closeAllModals(); };
window.saveModalAIKey = () => {
    triggerHaptic(); const key = document.getElementById('aiKeyInputModal').value.trim();
    if(key) {
        localStorage.setItem('HP_AI_Key', key);
        const sAiKey = document.getElementById('sAIKey'); if(sAiKey) sAiKey.value = key;
        window.showToast("AI Engine Connected! ✨", "success"); window.closeAllModals();
    } else { window.showToast("Please enter an API key", "error"); }
};
window.saveSettingsAIKey = () => {
    triggerHaptic(); const key = document.getElementById('sAIKey').value.trim();
    if(key) { localStorage.setItem('HP_AI_Key', key); window.showToast("AI Engine Secured! ✨", "success"); }
    else { localStorage.removeItem('HP_AI_Key'); window.showToast("AI Engine Disabled.", "normal"); }
};
window.triggerAI = (context, id = null) => {
    triggerHaptic(); const key = localStorage.getItem('HP_AI_Key');
    if(!key) { window.openAITeaserModal(); } 
    else {
        if(context === 'voice') window.showToast("Listening... (Awaiting API)", "normal");
        if(context === 'receipt') window.showToast("Scanning receipt... (Awaiting Vision API)", "normal");
        if(context === 'reply') window.showToast("Drafting reply... (Awaiting Text API)", "normal");
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
window.closeAddCustomerModal = () => { window.closeAllModals(); };

window.saveCustomer = () => {
    triggerHaptic();
    const name = document.getElementById('cName').value.trim();
    if(!name) { window.showToast("Customer Name is required", "error"); return; }
    
    const rawPrice = document.getElementById('cPrice').value.trim();
    const parsedPrice = parseFloat(rawPrice); 
    
    const newDetails = {
        name, houseNum: document.getElementById('cHouseNum').value.trim(), street: document.getElementById('cStreet').value.trim(), 
        postcode: document.getElementById('cPostcode').value.trim().toUpperCase(), phone: document.getElementById('cPhone').value.trim(), 
        price: isNaN(parsedPrice) ? 0 : parsedPrice, notes: document.getElementById('cNotes').value.trim(), 
        freq: parseInt(document.getElementById('cFreq').value) || 4, week: document.getElementById('cWeek').value, day: document.getElementById('cDay').value 
    };

    if (editingCustomerId) {
        const cIndex = db.customers.findIndex(x => x.id === editingCustomerId);
        if (cIndex > -1) { db.customers[cIndex] = { ...db.customers[cIndex], ...newDetails }; window.showToast(`${window.escapeHTML(name)} updated`, "success"); }
    } else {
        db.customers.push({ id: Date.now().toString(), order: Date.now(), cycleStartDate: Date.now(), ...newDetails, cleaned: false, skipped: false, paidThisMonth: 0, pastArrears: [] });
        window.showToast(`${window.escapeHTML(name)} added to database`, "success"); 
    }

    curWeek = parseInt(newDetails.week); workingDay = newDetails.day;
    localStorage.setItem('HP_curWeek', curWeek); localStorage.setItem('HP_workingDay', workingDay);
    document.querySelectorAll('.segment').forEach(b => { if(b.id && b.id.startsWith('wk-btn-')) b.classList.remove('active'); }); 
    const wkBtn = document.getElementById(`wk-btn-${curWeek}`); if(wkBtn) wkBtn.classList.add('active');
    document.querySelectorAll('.WEE-day-btn').forEach(b => b.classList.remove('active')); 
    const dayBtn = document.getElementById(`day-${workingDay}`); if(dayBtn) dayBtn.classList.add('active');

    window.saveData(); window.closeAllModals(); window.renderAllSafe(); 
};

window.cmdDeleteCustomer = () => {
    if (!editingCustomerId) return;
    const c = db.customers.find(x => x.id === editingCustomerId); if (!c) return;
    window.showConfirm("Delete Customer?", `Are you sure you want to permanently remove ${window.escapeHTML(c.name)}?`, () => {
        db.customers = db.customers.filter(x => x.id !== editingCustomerId); window.saveData(); window.showToast("Deleted.", "normal"); window.closeAllModals(); window.renderAllSafe();
    });
};
window.saveBank = () => { triggerHaptic(); db.bank.name = document.getElementById('bName').value; db.bank.acc = document.getElementById('bAcc').value; window.saveData(); window.showToast("Bank Details Secured 🔒", "success"); };

window.showConfirm = (title, text, actionCallback) => { triggerHaptic(); document.getElementById('confirmTitle').innerText = window.escapeHTML(title); document.getElementById('confirmText').innerText = window.escapeHTML(text); confirmCallback = actionCallback; document.getElementById('confirmModal').classList.remove('hidden'); };

window.cmdCycleMonth = () => { window.showToast("Automated Engine is managing cycles.", "normal"); };
window.cmdNuclear = () => { window.showConfirm("FACTORY RESET?", "This will permanently delete all customer data, finances, and settings.", async () => { await idb.clear(); localStorage.removeItem(DB_KEY); location.reload(); }); };

window.exportToQuickBooks = () => { triggerHaptic(); let csv = "Date,Description,Amount,Type,Category\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},Income: ${window.escapeHTML(c.name)},${c.paidThisMonth},Income,Service\n`; }); db.expenses.forEach(e => { csv += `${e.date},${window.escapeHTML(e.desc)},${e.amt},Expense,${window.escapeHTML(e.cat) || 'Other'}\n`; }); triggerDownload(csv, "HydroPro_QuickBooks.csv"); };
window.exportToXero = () => { triggerHaptic(); let csv = "Date,Description,Reference,Amount,AccountCode\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},Window Cleaning - ${window.escapeHTML(c.name)},${c.id},${c.paidThisMonth},200\n`; }); db.expenses.forEach(e => { csv += `${e.date},${window.escapeHTML(e.desc)},${window.escapeHTML(e.cat)},-${e.amt},400\n`; }); triggerDownload(csv, "HydroPro_Xero.csv"); };
window.exportToSage = () => { triggerHaptic(); let csv = "Date,Reference,Details,Net Amount,Tax Amount\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},CUST-${c.id},Window Cleaning,${c.paidThisMonth},0.00\n`; }); db.expenses.forEach(e => { csv += `${e.date},EXP-${e.id},${window.escapeHTML(e.desc)},-${e.amt},0.00\n`; }); triggerDownload(csv, "HydroPro_Sage.csv"); };
window.exportToFreeAgent = () => { triggerHaptic(); let csv = "Date,Amount,Description\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},${c.paidThisMonth},Income: ${window.escapeHTML(c.name)}\n`; }); db.expenses.forEach(e => { csv += `${e.date},-${e.amt},Expense: ${window.escapeHTML(e.desc)}\n`; }); triggerDownload(csv, "HydroPro_FreeAgent.csv"); };

const triggerDownload = (csvContent, filename) => { const blob = new Blob([csvContent], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); window.showToast(`${filename} Generated!`, "success"); };
window.exportData = () => { triggerHaptic(); const blob = new Blob([JSON.stringify(db)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "HydroPro_Backup.json"; link.click(); };
window.importData = (event) => { const reader = new FileReader(); reader.onload = async (e) => { try { const imported = JSON.parse(e.target.result); db.customers = imported.customers || []; db.expenses = imported.expenses || []; db.history = imported.history || []; db.bank = imported.bank || { name: '', acc: '' }; await idb.set('master_db', db); window.showToast("Data Restored Successfully", "success"); setTimeout(() => location.reload(), 1500); } catch (err) { window.showToast("Invalid Format File", "error"); } }; reader.readAsText(event.target.files[0]); };

window.toggleArrearsFilter = () => { triggerHaptic(); showArrearsOnly = !showArrearsOnly; const btn = document.getElementById('arrearsFilterBtn'); if(showArrearsOnly) { btn.classList.add('active'); } else { btn.classList.remove('active'); } window.renderMaster(); };

window.renderMaster = () => { 
    const list = document.getElementById('CST-list-container'); if(!list) return; list.innerHTML = '';
    const search = (document.getElementById('mainSearch')?.value || "").toLowerCase(); let renderedCount = 0;
    const searchStr = search.replace(/\s+/g, '');
    
    db.customers.forEach(c => {
        const arrData = window.getArrearsData(c); if (showArrearsOnly && !arrData.isOwed) return;
        const phoneStr = (c.phone || "").replace(/\s+/g, ''); const postStr = (c.postcode || "").toLowerCase().replace(/\s+/g, '');
        if(c.name.toLowerCase().includes(search) || (c.street||"").toLowerCase().includes(search) || phoneStr.includes(searchStr) || postStr.includes(searchStr)) {
            renderedCount++;
            
            let arrearsBadge = '';
            if (arrData.isOwed) {
                arrearsBadge = `<span class="CST-badge badge-unpaid">OWES £${arrData.total.toFixed(2)}</span>`;
            } else if (c.cleaned) {
                arrearsBadge = `<span class="CST-badge badge-paid">PAID</span>`;
            }
            
            const div = document.createElement('div'); div.className = 'CST-card-item'; div.onclick = () => window.showCustomerBriefing(c.id);
            div.innerHTML = `<div class="CST-card-top"><div><strong style="font-size:20px;">${window.escapeHTML(c.name)}</strong><br><small style="color:var(--accent); font-weight:800;">${window.escapeHTML(c.houseNum)} ${window.escapeHTML(c.street)}</small></div><div style="font-weight:950; font-size:22px;">£${(parseFloat(c.price)||0).toFixed(2)}</div></div><div class="CST-card-badges">${arrearsBadge}</div>`;
            list.appendChild(div);
        }
    });
    if (renderedCount === 0) { list.innerHTML = `<div class="empty-state"><span class="empty-icon">👻</span><div class="empty-text">No Customers Found</div><button class="ADM-save-btn" style="width: 220px; font-size: 14px; height: 50px!important; margin-top: 20px; box-shadow: 0 5px 15px rgba(0,122,255,0.2);" onclick="window.openAddCustomerModal()">➕ ADD CUSTOMER</button></div>`; }
};

window.setWorkingWeek = (num) => { triggerHaptic(); curWeek = num; localStorage.setItem('HP_curWeek', curWeek); document.querySelectorAll('.segment').forEach(b => { if(b.id && b.id.startsWith('wk-btn-')) b.classList.remove('active'); }); const wkBtn = document.getElementById(`wk-btn-${num}`); if(wkBtn) wkBtn.classList.add('active'); window.renderWeek(); };
window.setWorkingDay = (day, btn) => { triggerHaptic(); workingDay = day; localStorage.setItem('HP_workingDay', workingDay); document.querySelectorAll('.WEE-day-btn').forEach(b => b.classList.remove('active')); if(btn) btn.classList.add('active'); window.renderWeek(); };
window.viewWeek = (num) => { window.setWorkingWeek(num); };

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
        if (isSwiping) { if (diff > 55) { window.cmdToggleClean(cId); } else if (diff < -55) { window.cmdSettlePaid(cId, 'job'); } } setTimeout(() => { isSwiping = false; }, 100); startX = 0; currentX = 0;
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
        newOrderEls.forEach((el, index) => { const customer = db.customers.find(c => c.id === el.dataset.id); if(customer) customer.order = index; }); window.saveData();
    });
};

window.renderWeek = () => { 
    const list = document.getElementById('WEE-list-container'); if(!list) return; list.innerHTML = '';
    
    let customersToday = db.customers.filter(c => String(c.week).trim() === String(curWeek).trim() && String(c.day).trim() === String(workingDay).trim()).sort((a, b) => { if (a.skipped === b.skipped) return (a.order || 0) - (b.order || 0); return a.skipped ? 1 : -1; });
    const progressDash = document.getElementById('WEE-progress-dashboard');
    if(customersToday.length === 0) { progressDash.innerHTML = ''; list.innerHTML = `<div class="empty-state"><span class="empty-icon">🏖️</span><div class="empty-text">Zero Jobs Today</div><div class="empty-sub">Enjoy the day off, or add a job!</div><button class="ADM-save-btn" style="width: 220px; font-size: 14px; height: 50px!important; margin-top: 20px; box-shadow: 0 5px 15px rgba(0,122,255,0.2);" onclick="window.openAddCustomerModal()">➕ ADD CUSTOMER</button></div>`; return; }

    let completedCount = customersToday.filter(c => c.cleaned || c.skipped).length; let totalCount = customersToday.length; let pct = totalCount === 0 ? 0 : (completedCount / totalCount) * 100; let dailyValue = customersToday.filter(c => c.cleaned).reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0);
    progressDash.innerHTML = `<div class="WEE-progress-wrap"><div class="WEE-progress-fill" style="width: ${pct}%;"></div></div><div class="WEE-progress-text">${completedCount} of ${totalCount} Done • £${dailyValue.toFixed(2)} Cleaned Today</div>`;

    customersToday.forEach(c => {
        const arrData = window.getArrearsData(c);
        const cleanBadge = c.cleaned ? `<span class="CST-badge badge-clean">✅ CLEANED</span>` : '';
        
        let arrearsBadge = '';
        if (arrData.isOwed) {
            arrearsBadge = `<span class="CST-badge badge-unpaid">❌ OWES £${arrData.total.toFixed(2)}</span>`;
        } else if (c.cleaned) {
            arrearsBadge = `<span class="CST-badge badge-paid">✅ PAID</span>`;
        }
        
        const skipBadge = c.skipped ? `<span class="CST-badge badge-unpaid" style="background: rgba(255, 149, 0, 0.15); color: #cc7700;">⏭️ SKIPPED</span>` : '';
        
        const wrap = document.createElement('div'); wrap.className = 'swipe-wrapper'; wrap.dataset.id = c.id;
        const bg = document.createElement('div'); bg.className = 'swipe-bg'; bg.innerHTML = `<div class="action-left">✅</div><div class="action-right">💰</div>`;
        const fg = document.createElement('div'); fg.className = `swipe-fg CST-card-item ${c.skipped ? 'skipped-card' : ''}`;
        
        fg.innerHTML = `<div style="flex:1;"><strong style="font-size:20px; display:block;">${window.escapeHTML(c.name)}</strong><small style="color:var(--accent); font-weight:800; display:block;">${window.escapeHTML(c.houseNum)} ${window.escapeHTML(c.street)}</small><div class="CST-card-badges">${cleanBadge} ${arrearsBadge} ${skipBadge}</div></div><div style="display:flex; align-items:center; gap: 8px;"><span class="price-text" style="font-weight:950; font-size:22px;">£${(parseFloat(c.price)||0).toFixed(2)}</span><button class="quick-action-btn" onclick="window.cmdQuickRoute('${c.id}', event)">📍</button><button class="quick-action-btn" onclick="window.cmdQuickCall('${window.escapeHTML(c.phone)}', event)">📞</button><div class="drag-handle">≡</div></div>`;
        
        wrap.appendChild(bg); wrap.appendChild(fg); list.appendChild(wrap); attachSwipeGestures(wrap, fg, c.id); attachDragDrop(wrap, list);
    });
};

window.cmdQuickCall = (phone, e) => { 
    if(e) e.stopPropagation(); 
    triggerHaptic(); 
    if(!phone || phone==='undefined') return window.showToast("No phone number saved.", "error"); 
    window.location.href = `tel:${window.escapeHTML(phone)}`; 
};

// ✨ FIXED: Multi-stop routing accurately using the Official Google Maps Directions Link
window.routeMyDay = () => {
    triggerHaptic();
    let jobs = db.customers.filter(c => String(c.week).trim() === String(curWeek).trim() && String(c.day).trim() === String(workingDay).trim() && !c.skipped && !c.cleaned).sort((a,b) => (a.order||0) - (b.order||0)).slice(0, 10); 
    if(jobs.length === 0) return window.showToast("No uncleaned jobs to route!", "error");
    
    let dest = encodeURIComponent(`${jobs[jobs.length-1].houseNum} ${jobs[jobs.length-1].street}, ${jobs[jobs.length-1].postcode || ''}`);
    let waypoints = jobs.slice(0, -1).map(c => encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`)).join('|');
    
    let url = `https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=${dest}`;
    if (waypoints) url += `&waypoints=${waypoints}`;
    
    window.open(url, '_blank');
};

// ✨ FIXED: Single-stop routing accurately using the Official Google Maps Directions Link
window.cmdQuickRoute = (id, e) => { 
    if(e) e.stopPropagation(); 
    triggerHaptic(); 
    const c = db.customers.find(x => x.id === id); 
    if(!c) return; 
    const dest = encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`); 
    window.open(`https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=${dest}`, '_blank'); 
};

window.cmdToggleClean = (id) => { 
    const c = db.customers.find(x => x.id === id); 
    c.cleaned = !c.cleaned; 
    window.saveData(); 
    window.renderAllSafe(); 
    window.closeAllModals(); 
    window.showToast(c.cleaned ? "Job Cleaned 💧" : "Clean Reverted", "success"); 
};

window.cmdToggleSkip = (id) => { 
    triggerHaptic(); 
    const c = db.customers.find(x => x.id === id); 
    c.skipped = !c.skipped; 
    if(c.skipped) c.cleaned = false; 
    window.saveData(); 
    window.renderAllSafe(); 
    window.closeAllModals(); 
    window.showToast(c.skipped ? "Job Skipped ⏭️" : "Skip Removed", "normal"); 
};

window.cmdReceiptWA = (phone, amt, date) => { triggerHaptic(); if(!phone || phone === 'undefined') return window.showToast("No phone number saved.", "error"); let p = phone.replace(/\D/g, ''); if(p.startsWith('0')) p = '44' + p.substring(1); let msg = `Receipt from Hydro Pro 💧\n\nReceived: £${parseFloat(amt).toFixed(2)}\nDate: ${date}\n\nThank you for your business!`; window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank'); };
window.cmdReceiptSMS = (phone, amt, date) => { triggerHaptic(); if(!phone || phone === 'undefined') return window.showToast("No phone number saved.", "error"); let p = phone.replace(/\D/g, ''); let msg = `Receipt from Hydro Pro 💧\n\nReceived: £${parseFloat(amt).toFixed(2)}\nDate: ${date}\n\nThank you for your business!`; const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; const separator = isIOS ? '&' : '?'; window.location.href = `sms:${p}${separator}body=${encodeURIComponent(msg)}`; };

window.cmdChaseWA = (id, type) => {
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c || !c.phone) return window.showToast("No phone number saved.", "error");
    const arrData = window.getArrearsData(c); let p = c.phone.replace(/\D/g, ''); if(p.startsWith('0')) p = '44' + p.substring(1);
    let msg = "";
    if (type === 'polite') { msg = `Hi ${c.name}, hope you're well! Just a quick reminder of an outstanding balance of £${arrData.total.toFixed(2)} for your window clean. Let me know if you need the bank details again! 💧`; }
    if (type === 'firm') { msg = `Hi ${c.name}, this is a reminder that your account is now overdue by £${arrData.total.toFixed(2)}. Please arrange payment as soon as possible to avoid interruption to your service. Thank you, Hydro Pro.`; }
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.cmdChaseSMS = (id, type) => {
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c || !c.phone) return window.showToast("No phone number saved.", "error");
    const arrData = window.getArrearsData(c); let p = c.phone.replace(/\D/g, '');
    let msg = "";
    if (type === 'polite') { msg = `Hi ${c.name}, hope you're well! Just a quick reminder of an outstanding balance of £${arrData.total.toFixed(2)} for your window clean. Let me know if you need the bank details again! 💧`; }
    if (type === 'firm') { msg = `Hi ${c.name}, this is a reminder that your account is now overdue by £${arrData.total.toFixed(2)}. Please arrange payment as soon as possible to avoid interruption to your service. Thank you, Hydro Pro.`; }
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; const separator = isIOS ? '&' : '?';
    window.location.href = `sms:${p}${separator}body=${encodeURIComponent(msg)}`;
};

window.cmdGenerateInvoice = (id) => {
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c) return; const arrData = window.getArrearsData(c); const printArea = document.getElementById('print-area');
    printArea.innerHTML = `<div style="max-width: 800px; margin: 0 auto; font-family: sans-serif; color: black; padding: 20px;"><h1 style="color: #007aff; margin-bottom: 5px;">INVOICE</h1><p style="margin-top: 0; color: #666; font-size: 14px;"><strong>From:</strong> Hydro Pro Window Cleaning<br><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB')}</p><hr style="border: 1px solid #eee; margin: 20px 0;"><p style="font-size: 16px;"><strong>To:</strong><br>${window.escapeHTML(c.name)}<br>${window.escapeHTML(c.houseNum)} ${window.escapeHTML(c.street)}<br>${window.escapeHTML(c.postcode)}</p><table style="width: 100%; text-align: left; border-collapse: collapse; margin-top: 30px;"><tr style="border-bottom: 2px solid #000;"><th style="padding: 10px 0;">Description</th><th style="padding: 10px 0; text-align: right;">Amount</th></tr><tr><td style="padding: 15px 0; border-bottom: 1px solid #eee;">Window Cleaning Service</td><td style="padding: 15px 0; border-bottom: 1px solid #eee; text-align: right;">£${parseFloat(c.price).toFixed(2)}</td></tr></table>${arrData.isOwed ? `<p style="text-align: right; font-size: 22px; margin-top: 30px; color: #ff453a;"><strong>Total Outstanding: £${arrData.total.toFixed(2)}</strong></p>` : `<p style="text-align: right; font-size: 22px; margin-top: 30px; color: #34C759;"><strong>PAID IN FULL</strong></p>`}<hr style="border: 1px solid #eee; margin-top: 50px;"><p style="font-size: 14px; color: #666; text-align: center;"><strong>Payment Details:</strong><br>${window.escapeHTML(db.bank.name)} | Acc: ${window.escapeHTML(db.bank.acc)}</p></div>`;
    window.print();
};

let currentUploadCustId = null;
window.triggerPhotoUpload = (id) => { triggerHaptic(); currentUploadCustId = id; document.getElementById('cameraInput').click(); };

window.handlePhotoUpload = (e) => {
    const file = e.target.files[0]; if(!file || !currentUploadCustId) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const MAX_WIDTH = 800; let width = img.width; let height = img.height;
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            canvas.width = width; canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7); 
            
            const photoObj = { id: Date.now(), custId: currentUploadCustId, data: dataUrl, date: new Date().toLocaleDateString('en-GB') };
            await idb.savePhoto(photoObj);
            window.showToast("Evidence Saved to Vault 📸", "success");
            window.showCustomerBriefing(currentUploadCustId); 
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

const generateArrearsHtml = (arrData, cId, context, phone) => { 
    if (!arrData.isOwed) return `<div class="CMD-alert-success" style="cursor:default;">✅ BALANCE: £0.00</div>`;
    let listHtml = arrData.breakdown.map(b => `<li>£${b.amt.toFixed(2)} - ${window.escapeHTML(b.month)}</li>`).join('');
    
    return `
        <div class="CMD-alert-danger" style="cursor:default;">
            <div class="CMD-alert-danger-title">⚠️ TOTAL OUTSTANDING: £${arrData.total.toFixed(2)}</div>
            <ul class="CMD-arrears-list">${listHtml}</ul>
            <div style="margin-top: 15px; font-size: 11px; font-weight: 900; opacity: 0.8; text-transform: uppercase;">👆 Tap below to settle or chase</div>
            
            <div style="display:flex; gap:10px; margin-top:15px;">
                <button class="ADM-save-btn" style="margin:0; height:45px!important; font-size:13px; background:rgba(0,0,0,0.2); box-shadow:none;" onclick="window.cmdSettlePaid('${cId}', '${context}')">💰 SETTLE ACCOUNT</button>
            </div>
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button class="ADM-save-btn" style="margin:0; height:40px!important; font-size:12px; background:white; color:var(--danger); box-shadow:none;" onclick="window.cmdChaseWA('${cId}', 'polite')">💬 POLITE CHASE</button>
                <button class="ADM-save-btn" style="margin:0; height:40px!important; font-size:12px; background:black; color:white; box-shadow:none;" onclick="window.cmdChaseWA('${cId}', 'firm')">🚨 FIRM CHASE</button>
            </div>
        </div>`;
};

const generateHistoryHtml = (id, phone) => { 
    const history = db.history.filter(h => h.custId === id).slice(-3).reverse();
    if (history.length === 0) return `<div class="empty-state" style="padding: 10px;"><div class="empty-text" style="font-size:14px;">No Payment History</div></div>`;
    return history.map(h => `<div class="CMD-history-row" style="align-items:center;"><div><span>${window.escapeHTML(h.date)}</span> <span style="opacity:0.5; font-size:10px; margin-left:5px;">${h.method === 'Bank' ? '🏦' : '💵'}</span></div><div style="display:flex; gap:10px; align-items:center;"><span style="color:var(--success);">£${parseFloat(h.amt).toFixed(2)}</span><button class="quick-action-btn" style="width:28px; height:28px; font-size:12px; margin-left:0;" onclick="window.cmdReceiptWA('${window.escapeHTML(phone)}', '${h.amt}', '${window.escapeHTML(h.date)}')">🧾</button></div></div>`).join('');
};

window.cmdSettlePaid = (id, context) => { 
    currentPayId = id; 
    currentPayContext = context; 
    const c = db.customers.find(x => x.id === id); 
    const arr = window.getArrearsData(c); 
    document.getElementById('pay-name').innerText = c.name; 
    document.getElementById('pay-arrears-box').innerText = `TOTAL OUTSTANDING: £${arr.total.toFixed(2)}`; 
    window.closeAllModals(); 
    document.getElementById('paymentModal').classList.remove('hidden'); 
};

window.processPayment = (type) => { 
    const c = db.customers.find(x => x.id === currentPayId);
    let amt = (type === 'full') ? window.getArrearsData(c).total : parseFloat(document.getElementById('pay-custom-amt').value);
    if(isNaN(amt) || amt <= 0) return window.showToast("Enter a valid amount", "error");
    c.paidThisMonth += amt;
    db.history.push({ custId: currentPayId, amt, date: new Date().toLocaleDateString('en-GB'), method: currentPayMethod });
    window.saveData(); 
    window.renderAllSafe(); 
    window.closeAllModals(); 
    window.showToast(`£${amt} Collected!`, "success");
};

window.showJobBriefing = async (id) => {
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c) return;
    const container = document.getElementById('briefingData'); const arrData = window.getArrearsData(c);
    
    const dest = encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`); 
    const navUrl = `https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=${dest}`;
    
    const notesHtml = c.notes ? `<div class="CMD-notes-box">📝 ${window.escapeHTML(c.notes)}</div>` : '';

    container.innerHTML = `
        <div class="CMD-header"><h2>${window.escapeHTML(c.name)}</h2><button class="CMD-header-edit-btn" onclick="window.openAddCustomerModal('${c.id}')">✏️</button><div class="CMD-header-sub">${window.escapeHTML(c.houseNum)} ${window.escapeHTML(c.street)}</div></div>
        ${notesHtml}
        ${generateArrearsHtml(arrData, c.id, 'job', c.phone)}
        <div class="CMD-action-grid">
            <button class="CMD-action-btn clean" onclick="window.cmdToggleClean('${c.id}')"><span style="font-size:24px;">🧼</span> <br>${c.cleaned ? 'UNDO CLEAN' : 'MARK CLEAN'}</button>
            <button class="CMD-action-btn route" onclick="window.open('${navUrl}', '_blank')"><span style="font-size:24px;">📍</span> <br>NAVIGATE</button>
            <button class="CMD-action-btn call" onclick="window.location.href='tel:${window.escapeHTML(c.phone)}'"><span style="font-size:24px;">📞</span> <br>CALL</button>
            <button class="CMD-action-btn skip" onclick="window.cmdToggleSkip('${c.id}')"><span style="font-size:24px;">⏭️</span> <br>${c.skipped ? 'UNSKIP' : 'SKIP JOB'}</button>
            <button class="CMD-action-btn" style="background:rgba(0,0,0,0.05);" onclick="window.triggerPhotoUpload('${c.id}')"><span style="font-size:24px;">📷</span> <br>LOG EVIDENCE</button>
            <button class="CMD-action-btn invoice" onclick="window.cmdGenerateInvoice('${c.id}')"><span style="font-size:24px;">📄</span> <br>INVOICE</button>
            <button class="CMD-action-btn whatsapp" onclick="window.cmdReceiptWA('${window.escapeHTML(c.phone)}', '${c.price}', '${new Date().toLocaleDateString('en-GB')}')"><span style="font-size:24px;">💬</span> <br>WA REC</button>
            <button class="CMD-action-btn sms" onclick="window.cmdReceiptSMS('${window.escapeHTML(c.phone)}', '${c.price}', '${new Date().toLocaleDateString('en-GB')}')"><span style="font-size:24px;">📱</span> <br>SMS REC</button>
            <button class="CMD-action-btn ai-btn ai-glow-btn" onclick="window.triggerAI('reply', '${c.id}')"><span style="font-size:24px;">✨</span> <br>SMART REPLY</button>
        </div>
        <div id="modal-photo-gallery"></div>
        <h3 class="CMD-history-hdr">Rolling History (Tap 🧾 for receipt)</h3><div class="CMD-history-box">${generateHistoryHtml(c.id, c.phone)}</div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');

    const photos = await idb.getPhotos(c.id);
    const photoContainer = document.getElementById('modal-photo-gallery');
    if(photos.length > 0) {
        photoContainer.innerHTML = `<h3 class="CMD-history-hdr">Evidence Photos</h3><div class="CMD-photo-gallery">${photos.map(p => `<img src="${p.data}" class="CMD-photo-thumb" onclick="window.open('${p.data}')">`).join('')}</div>`;
    }
};

window.showCustomerBriefing = async (id) => { 
    triggerHaptic(); const c = db.customers.find(x => x.id === id); if(!c) return;
    const container = document.getElementById('briefingData'); const arrData = window.getArrearsData(c);
    const notesHtml = c.notes ? `<div class="CMD-notes-box">📝 ${window.escapeHTML(c.notes)}</div>` : '';

    container.innerHTML = `
        <div class="CMD-header"><h2>${window.escapeHTML(c.name)}</h2><button class="CMD-header-edit-btn" onclick="window.openAddCustomerModal('${c.id}')">✏️</button><div class="CMD-header-sub">${window.escapeHTML(c.houseNum)} ${window.escapeHTML(c.street)} <br>${window.escapeHTML(c.postcode || '')}</div></div>
        <div class="CMD-details-box"><div class="CMD-detail-row"><span>📞 Phone</span><span>${window.escapeHTML(c.phone) || 'N/A'}</span></div><div class="CMD-detail-row"><span>💰 Price</span><span>£${parseFloat(c.price).toFixed(2)}</span></div><div class="CMD-detail-row"><span>📅 Week</span><span>Week ${window.escapeHTML(c.week)}</span></div><div class="CMD-detail-row"><span>📆 Day</span><span>${window.escapeHTML(c.day)}</span></div><div class="CMD-detail-row"><span>🔄 Cycle</span><span>${window.escapeHTML(c.freq || 4)} Weekly</span></div></div>
        ${notesHtml}
        ${generateArrearsHtml(arrData, c.id, 'cust', c.phone)}
        <div style="display:flex; gap:10px; margin-bottom:20px;">
            <button class="ADM-save-btn" style="margin-top:0; height: 50px!important; font-size: 12px; background: rgba(0,0,0,0.05); color: var(--text); box-shadow: none; flex:1;" onclick="window.triggerPhotoUpload('${c.id}')">📷 LOG EVIDENCE</button>
            <button class="ADM-save-btn" style="margin-top:0; height: 50px!important; font-size: 12px; background: transparent; border: 2px solid var(--accent); color: var(--accent); box-shadow: none; flex:1;" onclick="window.cmdGenerateInvoice('${c.id}')">📄 PDF INVOICE</button>
        </div>
        <div id="modal-photo-gallery"></div>
        <h3 class="CMD-history-hdr">Rolling History (Tap 🧾 for receipt)</h3><div class="CMD-history-box">${generateHistoryHtml(c.id, c.phone)}</div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');

    const photos = await idb.getPhotos(c.id);
    const photoContainer = document.getElementById('modal-photo-gallery');
    if(photos.length > 0) {
        photoContainer.innerHTML = `<h3 class="CMD-history-hdr">Evidence Photos</h3><div class="CMD-photo-gallery">${photos.map(p => `<img src="${p.data}" class="CMD-photo-thumb" onclick="window.open('${p.data}')">`).join('')}</div>`;
    }
};

const getFinancialYearDates = (yearStr) => {
    const startYear = parseInt(yearStr);
    return { start: new Date(`${startYear}-04-06`), end: new Date(`${startYear + 1}-04-05`) };
};

const parseGBDate = (dateStr) => {
    const parts = dateStr.split('/');
