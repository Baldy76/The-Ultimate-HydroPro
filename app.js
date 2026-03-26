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

// ✨ BUG FIX: Sanitized HTML Escaping (Impossible to freeze)
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
    return { isOwed: breakdown.length > 0, total: totalOwed, breakdown: breakdown };
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await idb.init(); 
        let savedData = await idb.get('master_db');
        if (savedData) { db = savedData; }

        applyTheme(localStorage.getItem('HP_Theme') === 'true');
        renderAllSafe(); initWeather();
    } catch(err) { console.error("Boot Error:", err); }
});

function applyTheme(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
}

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
    
    // ✨ BUG FIX: SMART GREETING ENGINE
    const hr = new Date().getHours();
    let greet = "Good Morning.";
    if(hr >= 12 && hr < 17) greet = "Good Afternoon.";
    if(hr >= 17) greet = "Good Evening.";
    document.getElementById('home-greeting').innerText = greet;

    let todaysJobs = db.customers.filter(c => String(c.week) === String(curWeek) && c.day === workingDay && !c.skipped);
    document.getElementById('home-jobs-value').innerText = `£${todaysJobs.reduce((s, c) => s + (parseFloat(c.price) || 0), 0).toFixed(2)}`;
    document.getElementById('home-jobs-count').innerText = `${todaysJobs.length} Jobs Today (Wk ${curWeek} ${workingDay})`;
    
    let totalArr = 0; db.customers.forEach(c => { const a = window.getArrearsData(c); if(a.isOwed) totalArr += a.total; });
    document.getElementById('home-arrears').innerText = `£${totalArr.toFixed(2)}`;

    let cash = 0; const m = new Date().toLocaleString('en-GB', { month: 'short' });
    db.history.forEach(h => { if(h.date.includes(m)) cash += parseFloat(h.amt); });
    document.getElementById('home-cash').innerText = `£${cash.toFixed(2)}`;
};

window.openAddCustomerModal = (id = null) => {
    editingCustomerId = id;
    if(id) {
        const c = db.customers.find(x => x.id === id);
        document.getElementById('cName').value = c.name;
        document.getElementById('cHouseNum').value = c.houseNum || '';
        document.getElementById('cStreet').value = c.street || '';
        document.getElementById('cPrice').value = c.price;
        document.getElementById('cWeek').value = c.week;
        document.getElementById('cDay').value = c.day;
        document.getElementById('deleteCustomerBtn').classList.remove('hidden');
    } else {
        document.getElementById('cName').value = '';
        document.getElementById('deleteCustomerBtn').classList.add('hidden');
    }
    document.getElementById('addCustomerModal').classList.remove('hidden');
};

window.closeAddCustomerModal = () => document.getElementById('addCustomerModal').classList.add('hidden');

window.saveCustomer = () => {
    const name = document.getElementById('cName').value.trim();
    if(!name) return showToast("Name required", "error");
    const details = {
        name, houseNum: document.getElementById('cHouseNum').value,
        street: document.getElementById('cStreet').value,
        price: parseFloat(document.getElementById('cPrice').value) || 0,
        week: document.getElementById('cWeek').value,
        day: document.getElementById('cDay').value
    };
    if (editingCustomerId) {
        const i = db.customers.findIndex(x => x.id === editingCustomerId);
        db.customers[i] = { ...db.customers[i], ...details };
    } else {
        db.customers.push({ id: Date.now().toString(), ...details, cleaned: false, skipped: false, paidThisMonth: 0, pastArrears: [] });
    }
    idb.set('master_db', db); closeAddCustomerModal(); renderAllSafe();
};

window.renderMaster = () => {
    const list = document.getElementById('CST-list-container'); list.innerHTML = '';
    const search = document.getElementById('mainSearch').value.toLowerCase();
    db.customers.forEach(c => {
        if(c.name.toLowerCase().includes(search) || (c.street||'').toLowerCase().includes(search)) {
            const div = document.createElement('div'); div.className = 'CST-card-item';
            div.onclick = () => showCustomerBriefing(c.id);
            div.innerHTML = `<strong>${escapeHTML(c.name)}</strong><br><small>${escapeHTML(c.street)}</small>`;
            list.appendChild(div);
        }
    });
};

window.renderWeek = () => {
    const list = document.getElementById('WEE-list-container'); list.innerHTML = '';
    // ✨ BUG FIX: Loose string comparison to ensure cards show up reliably
    let jobs = db.customers.filter(c => String(c.week) === String(curWeek) && c.day === workingDay);
    if(jobs.length === 0) { list.innerHTML = '<div class="empty-state">No Jobs Today</div>'; return; }
    jobs.forEach(c => {
        const wrap = document.createElement('div'); wrap.className = 'swipe-wrapper';
        wrap.innerHTML = `<div class="swipe-fg CST-card-item" onclick="showJobBriefing('${c.id}')"><strong>${escapeHTML(c.name)}</strong><span>£${parseFloat(c.price).toFixed(2)}</span></div>`;
        list.appendChild(wrap);
    });
};

window.showJobBriefing = (id) => {
    const c = db.customers.find(x => x.id === id);
    const arr = window.getArrearsData(c);
    document.getElementById('briefingData').innerHTML = `
        <h2>${escapeHTML(c.name)}</h2>
        <div class="CMD-alert-danger">OWES: £${arr.total.toFixed(2)}</div>
        <div class="CMD-action-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:15px;">
            <button class="ADM-save-btn" style="margin:0; background:var(--success);" onclick="cmdToggleClean('${c.id}')">${c.cleaned ? 'UNDO' : 'CLEAN'}</button>
            <button class="ADM-save-btn" style="margin:0;" onclick="cmdSettlePaid('${c.id}')">PAY</button>
            <button class="ADM-save-btn" style="margin:0; background:#eee; color:black;" onclick="openAddCustomerModal('${c.id}')">EDIT</button>
            <button class="ADM-save-btn" style="margin:0; background:#eee; color:black;" onclick="closeBriefing()">CLOSE</button>
        </div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

window.showCustomerBriefing = (id) => {
    const c = db.customers.find(x => x.id === id);
    document.getElementById('briefingData').innerHTML = `
        <h2>${escapeHTML(c.name)}</h2>
        <button class="ADM-save-btn" onclick="cmdSettlePaid('${c.id}')">MONEY</button>
        <button class="ADM-save-btn" style="background:#eee; color:black; margin-top:10px;" onclick="openAddCustomerModal('${c.id}')">EDIT</button>
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

window.setWorkingWeek = (w) => { curWeek = w; localStorage.setItem('HP_curWeek', w); renderWeek(); };
window.setWorkingDay = (d, b) => { workingDay = d; localStorage.setItem('HP_workingDay', d); document.querySelectorAll('.WEE-day-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderWeek(); };
window.triggerAI = (t) => { if(!localStorage.getItem('HP_AI_Key')) document.getElementById('aiTeaserModal').classList.remove('hidden'); else showToast("AI Engine Active"); };
window.closeAITeaserModal = () => document.getElementById('aiTeaserModal').classList.add('hidden');
window.saveSettingsAIKey = () => { localStorage.setItem('HP_AI_Key', document.getElementById('sAIKey').value); showToast("AI Saved"); };

async function initWeather() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
                const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${W_API_KEY}&units=metric`);
                const data = await res.json();
                document.getElementById('hw-temp').innerText = `${Math.round(data.main.temp)}°C`;
                document.getElementById('hw-desc').innerText = data.weather[0].description;
            } catch(e) {}
        });
    }
}
