"use strict";

const DB_KEY = 'HydroPro_Gold_V36'; 
const W_API_KEY = "4c00e61833ea94d3c4a1bff9d2c32969"; 

let db = { customers: [], expenses: [], history: [], bank: { name: '', acc: '' } };
let curWeek = parseInt(localStorage.getItem('HP_curWeek')) || 1; 
let workingDay = localStorage.getItem('HP_workingDay') || 'Mon';

let financeChartInstance = null; 
let currentPayId = null;
let confirmCallback = null; 
let showArrearsOnly = false;
let editingCustomerId = null;

const idb = {
    db: null,
    init: () => new Promise((resolve, reject) => {
        const req = indexedDB.open('HydroPro_V3_DB', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('appData');
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

// SYNTAX-SAFE ESCAPING
const escapeHTML = (str) => {
    if (!str) return '';
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

window.getArrearsData = (c) => {
    const currentMonthStr = new Date().toLocaleString('en-GB', { month: 'short' });
    let pastLog = c.pastArrears || [];
    let thisMonthCharge = c.cleaned ? (parseFloat(c.price) || 0) : 0;
    let currentOwed = thisMonthCharge - (parseFloat(c.paidThisMonth) || 0);
    let breakdown = pastLog.map(a => ({ month: a.month, amt: parseFloat(a.amt) }));
    if (currentOwed > 0.01) breakdown.push({ month: currentMonthStr, amt: currentOwed });
    const totalOwed = breakdown.reduce((sum, item) => sum + item.amt, 0);
    return { isOwed: breakdown.length > 0, total: totalOwed, breakdown: breakdown };
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await idb.init(); 
        let savedData = await idb.get('master_db');
        if (savedData) { db = savedData; }
        else {
            // Check legacy local storage on boot just in case
            const legacyData = localStorage.getItem(DB_KEY);
            if (legacyData) { db = JSON.parse(legacyData); await idb.set('master_db', db); }
        }

        applyTheme(localStorage.getItem('HP_Theme') === 'true');
        
        const currentHour = new Date().getHours();
        let greeting = "Good Morning.";
        if (currentHour >= 12 && currentHour < 17) greeting = "Good Afternoon.";
        else if (currentHour >= 17) greeting = "Good Evening.";
        if(document.getElementById('home-greeting')) document.getElementById('home-greeting').innerText = greeting;

        const bNameEl = document.getElementById('bName'); const bAccEl = document.getElementById('bAcc');
        if(bNameEl && db.bank.name) bNameEl.value = db.bank.name; 
        if(bAccEl && db.bank.acc) bAccEl.value = db.bank.acc;

        renderAllSafe(); initWeather();
    } catch(err) { console.error("Boot Error:", err); }
});

// ✨ NEW: THE DEEP SCAN RECOVERY ENGINE ✨
window.runDeepScanRecovery = async () => {
    triggerHaptic();
    showToast("Scanning device memory...", "normal");
    let foundDb = null;
    
    // Scan every single key in the phone's local storage for old data
    for (let i = 0; i < localStorage.length; i++) {
        let key = localStorage.key(i);
        if (key.includes('Hydro') || key.includes('DB') || key.includes('Gold')) {
            try {
                let parsed = JSON.parse(localStorage.getItem(key));
                // Find the save with the most customers
                if (parsed && parsed.customers && parsed.customers.length > (foundDb ? foundDb.customers.length : 0)) {
                    foundDb = parsed;
                }
            } catch(e) { } // Ignore non-JSON keys
        }
    }
    
    if (foundDb && foundDb.customers.length > 0) {
        db = foundDb;
        await idb.set('master_db', db); // Save it to the new active database
        renderAllSafe();
        showToast(`Recovered ${db.customers.length} customers! 🛟`, "success");
    } else {
        showToast("No ghost data found. Memory is wiped.", "error");
    }
};

function applyTheme(isDark) { document.body.classList.toggle('dark-mode', isDark); }
window.setThemeMode = (isDark) => { triggerHaptic(); applyTheme(isDark); localStorage.setItem('HP_Theme', isDark); renderAllSafe(); };
window.saveData = () => idb.set('master_db', db);

window.openTab = (id, btnId = null) => {
    triggerHaptic();
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const target = document.getElementById(id);
    if(target) { target.classList.add('active'); document.getElementById('dynamic-header-title').innerText = target.getAttribute('data-title'); }
    
    if (btnId) {
        document.querySelectorAll('.nav-item, .home-fab').forEach(b => b.classList.remove('active'));
        const activeB = document.getElementById(btnId); if(activeB) activeB.classList.add('active');
    }
    renderAllSafe();
};

window.renderAllSafe = () => {
    if(document.getElementById('home-root').classList.contains('active')) renderHome();
    if(document.getElementById('master-root').classList.contains('active')) renderMaster();
    if(document.getElementById('finances-root').classList.contains('active')) renderFinances();
    if(document.getElementById('week-view-root').classList.contains('active')) renderWeek();
};

window.renderHome = () => {
    document.getElementById('home-date').innerText = new Date().toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
    
    // Strict String Check to ensure missing jobs appear
    let jobsToday = db.customers.filter(c => String(c.week).trim() === String(curWeek).trim() && String(c.day).trim() === String(workingDay).trim() && !c.skipped);
    document.getElementById('home-jobs-value').innerText = `£${jobsToday.reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0).toFixed(2)}`;
    document.getElementById('home-jobs-count').innerText = `${jobsToday.length} Jobs Scheduled (Wk ${curWeek} ${workingDay})`;
    
    let totalArrears = 0;
    db.customers.forEach(c => { const arr = window.getArrearsData(c); if(arr.isOwed) totalArrears += arr.total; });
    document.getElementById('home-arrears').innerText = `£${totalArrears.toFixed(2)}`;
    
    let cashInHand = 0;
    let currentMonth = new Date().toLocaleString('en-GB', { month: 'short' });
    db.history.forEach(h => { if(h.date.includes(currentMonth)) cashInHand += parseFloat(h.amt); });
    document.getElementById('home-cash').innerText = `£${cashInHand.toFixed(2)}`;
};

window.openAddCustomerModal = (id = null) => {
    editingCustomerId = id;
    const titleEl = document.getElementById('customerModalTitle');
    const deleteBtn = document.getElementById('deleteCustomerBtn');
    if (id) {
        const c = db.customers.find(x => x.id === id);
        titleEl.innerText = "Edit Customer";
        deleteBtn.classList.remove('hidden');
        document.getElementById('cName').value = c.name;
        document.getElementById('cHouseNum').value = c.houseNum || '';
        document.getElementById('cStreet').value = c.street || '';
        document.getElementById('cPhone').value = c.phone || '';
        document.getElementById('cPrice').value = c.price;
        document.getElementById('cWeek').value = c.week;
        document.getElementById('cDay').value = c.day;
    } else {
        titleEl.innerText = "Add Customer";
        deleteBtn.classList.add('hidden');
        document.getElementById('cName').value = '';
        document.getElementById('cHouseNum').value = '';
        document.getElementById('cStreet').value = '';
        document.getElementById('cPhone').value = '';
        document.getElementById('cPrice').value = '';
    }
    document.getElementById('addCustomerModal').classList.remove('hidden');
};

window.closeAddCustomerModal = () => document.getElementById('addCustomerModal').classList.add('hidden');

window.saveCustomer = () => {
    const name = document.getElementById('cName').value.trim();
    if(!name) return showToast("Name is required", "error");
    
    const details = {
        name, houseNum: document.getElementById('cHouseNum').value, street: document.getElementById('cStreet').value,
        phone: document.getElementById('cPhone').value, price: parseFloat(document.getElementById('cPrice').value) || 0,
        week: document.getElementById('cWeek').value, day: document.getElementById('cDay').value
    };

    if (editingCustomerId) {
        const i = db.customers.findIndex(x => x.id === editingCustomerId);
        db.customers[i] = { ...db.customers[i], ...details };
        showToast("Updated", "success");
    } else {
        db.customers.push({ id: Date.now().toString(), ...details, cleaned: false, skipped: false, paidThisMonth: 0, pastArrears: [], photos: [] });
        showToast("Saved", "success");
    }
    
    curWeek = parseInt(details.week); workingDay = details.day;
    localStorage.setItem('HP_curWeek', curWeek);
    localStorage.setItem('HP_workingDay', workingDay);

    saveData(); closeAddCustomerModal(); renderAllSafe();
};

window.renderMaster = () => {
    const list = document.getElementById('CST-list-container'); list.innerHTML = '';
    const search = document.getElementById('mainSearch').value.toLowerCase();
    db.customers.forEach(c => {
        if (c.name.toLowerCase().includes(search) || (c.street || '').toLowerCase().includes(search)) {
            const div = document.createElement('div'); div.className = 'CST-card-item';
            div.onclick = () => showCustomerBriefing(c.id);
            div.innerHTML = `<div><strong>${escapeHTML(c.name)}</strong><br><small>${escapeHTML(c.street)}</small></div><div style="font-weight:900;">£${parseFloat(c.price).toFixed(2)}</div>`;
            list.appendChild(div);
        }
    });
};

window.renderWeek = () => {
    const list = document.getElementById('WEE-list-container'); list.innerHTML = '';
    // Strict String Check solves the missing customer bug
    let jobs = db.customers.filter(c => String(c.week).trim() === String(curWeek).trim() && String(c.day).trim() === String(workingDay).trim());
    
    if(jobs.length === 0) {
        list.innerHTML = '<div class="empty-state">🏖️ Zero Jobs Today</div>';
        return;
    }
    
    jobs.forEach(c => {
        const wrap = document.createElement('div'); wrap.className = 'swipe-wrapper';
        wrap.innerHTML = `<div class="swipe-fg CST-card-item" onclick="showJobBriefing('${c.id}')"><div><strong>${escapeHTML(c.name)}</strong><br><small>${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</small></div><div style="font-weight:950; font-size:18px;">£${parseFloat(c.price).toFixed(2)}</div></div>`;
        list.appendChild(wrap);
    });
};

window.showJobBriefing = (id) => {
    const c = db.customers.find(x => x.id === id);
    const arr = window.getArrearsData(c);
    document.getElementById('briefingData').innerHTML = `
        <div class="CMD-header"><h2>${escapeHTML(c.name)}</h2></div>
        <div class="CMD-alert-danger" style="margin: 15px 0;">TOTAL OWED: £${arr.total.toFixed(2)}</div>
        <div class="CMD-action-grid" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
            <button class="CMD-action-btn" onclick="cmdToggleClean('${c.id}')">🧼<br>${c.cleaned ? 'UNDO' : 'CLEAN'}</button>
            <button class="CMD-action-btn" onclick="cmdSettlePaid('${c.id}')">💰<br>PAY</button>
            <button class="CMD-action-btn whatsapp" onclick="cmdReceiptWA('${escapeHTML(c.phone)}', '', '${new Date().toLocaleDateString('en-GB')}')">💬<br>WA</button>
            <button class="CMD-action-btn ai-btn ai-glow-btn" onclick="triggerAI('reply')">✨<br>REPLY</button>
            <button class="CMD-action-btn" onclick="openAddCustomerModal('${c.id}')">✏️<br>EDIT</button>
            <button class="CMD-action-btn" style="background:#eee;" onclick="closeBriefing()">❌<br>CLOSE</button>
        </div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

window.showCustomerBriefing = (id) => {
    const c = db.customers.find(x => x.id === id);
    const arr = window.getArrearsData(c);
    document.getElementById('briefingData').innerHTML = `
        <div class="CMD-header"><h2>${escapeHTML(c.name)}</h2></div>
        <div class="CMD-details-box" style="background:var(--ios-grey); padding:15px; border-radius:15px; margin:15px 0;">
            <p><strong>Phone:</strong> ${c.phone || 'N/A'}</p>
            <p><strong>Schedule:</strong> Week ${c.week} - ${c.day}</p>
            <p><strong>Arrears:</strong> £${arr.total.toFixed(2)}</p>
        </div>
        <button class="ADM-save-btn" style="background:var(--accent);" onclick="cmdSettlePaid('${c.id}')">COLLECT MONEY</button>
        <button class="ADM-save-btn" style="margin-top:10px; background:var(--ios-grey); color:black;" onclick="openAddCustomerModal('${c.id}')">EDIT DETAILS</button>
        <button class="ADM-save-btn" style="margin-top:10px; background:transparent; border:2px dashed var(--danger); color:var(--danger);" onclick="closeBriefing()">CLOSE</button>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

window.closeBriefing = () => document.getElementById('briefingModal').classList.add('hidden');
window.cmdToggleClean = (id) => { const c = db.customers.find(x => x.id === id); c.cleaned = !c.cleaned; idb.set('master_db', db); renderAllSafe(); closeBriefing(); };
window.cmdSettlePaid = (id) => { currentPayId = id; const c = db.customers.find(x => x.id === id); document.getElementById('pay-name').innerText = c.name; document.getElementById('paymentModal').classList.remove('hidden'); closeBriefing(); };
window.closePaymentModal = () => document.getElementById('paymentModal').classList.add('hidden');
window.processPayment = (type) => { 
    const c = db.customers.find(x => x.id === currentPayId);
    let amt = (type==='full') ? window.getArrearsData(c).total : parseFloat(document.getElementById('pay-custom-amt').value);
    if(amt > 0) { c.paidThisMonth += amt; db.history.push({ custId: currentPayId, amt, date: new Date().toLocaleDateString('en-GB') }); idb.set('master_db', db); renderAllSafe(); closePaymentModal(); }
};

window.renderFinances = () => {
    let inc = 0, exp = 0;
    db.history.forEach(h => inc += parseFloat(h.amt));
    db.expenses.forEach(e => exp += parseFloat(e.amt));
    document.getElementById('FIN-black-card').innerHTML = `<div class="fbc-title">Net Profit</div><div class="fbc-balance">£${(inc-exp).toFixed(2)}</div>`;
    document.getElementById('FIN-bento-box').innerHTML = `<div class="fin-bento-card">Income: £${inc.toFixed(2)}</div><div class="fin-bento-card">Spent: £${exp.toFixed(2)}</div>`;
};

window.openExpenseModal = () => document.getElementById('expenseModal').classList.remove('hidden');
window.closeExpenseModal = () => document.getElementById('expenseModal').classList.add('hidden');
window.addFinanceExpense = () => {
    const desc = document.getElementById('mExpDesc').value;
    const amt = parseFloat(document.getElementById('mExpAmt').value);
    const cat = document.getElementById('mExpCat').value;
    if(!desc || isNaN(amt)) return;
    db.expenses.push({ id: Date.now(), desc, amt, cat, date: new Date().toLocaleDateString('en-GB') });
    saveData(); closeExpenseModal(); renderFinances();
};

window.setWorkingWeek = (w) => { curWeek = w; localStorage.setItem('HP_curWeek', w); document.querySelectorAll('.segment').forEach(x => x.classList.remove('active')); document.getElementById(`wk-btn-${w}`).classList.add('active'); renderWeek(); };
window.setWorkingDay = (d, b) => { workingDay = d; localStorage.setItem('HP_workingDay', d); document.querySelectorAll('.WEE-day-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderWeek(); };
window.triggerAI = (t) => { if(!localStorage.getItem('HP_AI_Key')) document.getElementById('aiTeaserModal').classList.remove('hidden'); else showToast("AI Engine Active"); };
window.closeAITeaserModal = () => document.getElementById('aiTeaserModal').classList.add('hidden');
window.saveSettingsAIKey = () => { localStorage.setItem('HP_AI_Key', document.getElementById('sAIKey').value); showToast("AI Key Saved", "success"); };
window.exportData = () => { const blob = new Blob([JSON.stringify(db)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "HydroPro_Backup.json"; link.click(); };
window.importData = (event) => { const reader = new FileReader(); reader.onload = async (e) => { try { const imported = JSON.parse(e.target.result); db = imported; await idb.set('master_db', db); showToast("Restored Successfully", "success"); setTimeout(() => location.reload(), 1500); } catch (err) { showToast("Invalid File", "error"); } }; reader.readAsText(event.target.files[0]); };

async function initWeather() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
                const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${W_API_KEY}&units=metric`);
                const data = await res.json();
                if(document.getElementById('hw-temp')) {
                    document.getElementById('hw-temp').innerText = `${Math.round(data.main.temp)}°C`;
                    document.getElementById('hw-desc').innerText = data.weather[0].description;
                }
            } catch(e) {}
        });
    }
}
