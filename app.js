"use strict";

const DB_KEY = 'HydroPro_Gold_V36'; 
const W_API_KEY = "4c00e61833ea94d3c4a1bff9d2c32969"; 

let db = { customers: [], expenses: [], history: [], bank: { name: '', acc: '' } };
let curWeek = parseInt(localStorage.getItem('HP_curWeek')) || 1; 
let workingDay = localStorage.getItem('HP_workingDay') || "Mon";

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

// ✨ FIXED: Standardized Entity Replacement ✨
const escapeHTML = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

window.getArrearsData = (c) => {
    const curMonth = new Date().toLocaleString('en-GB', { month: 'short' });
    let past = c.pastArrears || [];
    let owedNow = c.cleaned ? ((parseFloat(c.price) || 0) - (parseFloat(c.paidThisMonth) || 0)) : 0;
    let brk = past.map(a => ({ month: a.month, amt: parseFloat(a.amt) }));
    if (owedNow > 0.01) brk.push({ month: curMonth, amt: owedNow });
    return { isOwed: brk.length > 0, total: brk.reduce((s, i) => s + i.amt, 0), breakdown: brk };
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await idb.init(); 
        let saved = await idb.get('master_db');
        if (saved) { db = saved; }
        
        const currentHour = new Date().getHours();
        let greet = "Good Morning.";
        if (currentHour >= 12 && currentHour < 17) greet = "Good Afternoon.";
        else if (currentHour >= 17) greet = "Good Evening.";
        if(document.getElementById('home-greeting')) document.getElementById('home-greeting').innerText = greet;

        renderAllSafe(); initWeather();
    } catch(err) { console.error(err); }
});

window.saveData = () => idb.set('master_db', db);

window.openTab = (id, btnId = null) => {
    triggerHaptic();
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    const titleText = document.getElementById(id).getAttribute('data-title');
    document.getElementById('dynamic-header-title').innerText = titleText;
    
    if (btnId) {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.home-fab').forEach(b => b.classList.remove('active'));
        document.getElementById(btnId).classList.add('active');
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
    let jobs = db.customers.filter(c => String(c.week) === String(curWeek) && c.day === workingDay && !c.skipped);
    document.getElementById('home-jobs-value').innerText = `£${jobs.reduce((s, c) => s + (parseFloat(c.price) || 0), 0).toFixed(2)}`;
    document.getElementById('home-jobs-count').innerText = `${jobs.length} Jobs Today (Wk ${curWeek} ${workingDay})`;
};

window.openAddCustomerModal = (id = null) => {
    editingCustomerId = id;
    if (id) {
        const c = db.customers.find(x => x.id === id);
        document.getElementById('cName').value = c.name;
        document.getElementById('cPrice').value = c.price;
        document.getElementById('cWeek').value = c.week;
        document.getElementById('cDay').value = c.day;
    } else {
        document.getElementById('cName').value = '';
        document.getElementById('cPrice').value = '';
    }
    document.getElementById('addCustomerModal').classList.remove('hidden');
};
window.closeAddCustomerModal = () => document.getElementById('addCustomerModal').classList.add('hidden');

window.saveCustomer = () => {
    const name = document.getElementById('cName').value.trim();
    const price = parseFloat(document.getElementById('cPrice').value) || 0;
    const week = document.getElementById('cWeek').value;
    const day = document.getElementById('cDay').value;
    
    if(!name) return showToast("Name required", "error");
    
    if (editingCustomerId) {
        const i = db.customers.findIndex(x => x.id === editingCustomerId);
        db.customers[i] = { ...db.customers[i], name, price, week, day };
    } else {
        db.customers.push({ id: Date.now().toString(), name, price, week, day, cleaned: false, skipped: false, paidThisMonth: 0, pastArrears: [] });
    }
    
    curWeek = parseInt(week); workingDay = day;
    localStorage.setItem('HP_curWeek', curWeek);
    localStorage.setItem('HP_workingDay', workingDay);
    
    saveData(); closeAddCustomerModal(); renderAllSafe();
};

window.renderMaster = () => {
    const list = document.getElementById('CST-list-container'); list.innerHTML = '';
    const search = document.getElementById('mainSearch').value.toLowerCase();
    db.customers.forEach(c => {
        if (c.name.toLowerCase().includes(search)) {
            const div = document.createElement('div'); div.className = 'CST-card-item';
            div.onclick = () => showCustomerBriefing(c.id);
            div.innerHTML = `<strong>${escapeHTML(c.name)}</strong><br>£${parseFloat(c.price).toFixed(2)}`;
            list.appendChild(div);
        }
    });
};

window.renderWeek = () => {
    const list = document.getElementById('WEE-list-container'); list.innerHTML = '';
    let jobs = db.customers.filter(c => String(c.week) === String(curWeek) && c.day === workingDay);
    if(jobs.length === 0) { list.innerHTML = '<div class="empty-state">No Jobs</div>'; return; }
    
    jobs.forEach(c => {
        const div = document.createElement('div'); div.className = 'swipe-wrapper';
        div.innerHTML = `<div class="swipe-fg CST-card-item" onclick="showJobBriefing('${c.id}')"><strong>${escapeHTML(c.name)}</strong><span>£${parseFloat(c.price).toFixed(2)}</span></div>`;
        list.appendChild(div);
    });
};

window.showJobBriefing = (id) => {
    const c = db.customers.find(x => x.id === id);
    const arr = window.getArrearsData(c);
    document.getElementById('briefingData').innerHTML = `
        <h2>${escapeHTML(c.name)}</h2>
        <div class="CMD-alert-danger">OWED: £${arr.total.toFixed(2)}</div>
        <div class="CMD-action-grid">
            <button class="CMD-action-btn" onclick="cmdToggleClean('${c.id}')">🧼 CLEAN</button>
            <button class="CMD-action-btn" onclick="cmdSettlePaid('${c.id}', 'job')">💰 PAY</button>
            <button class="CMD-action-btn" onclick="openAddCustomerModal('${c.id}')">✏️ EDIT</button>
        </div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

window.showCustomerBriefing = (id) => {
    const c = db.customers.find(x => x.id === id);
    document.getElementById('briefingData').innerHTML = `
        <h2>${escapeHTML(c.name)}</h2>
        <button class="ADM-save-btn" onclick="cmdSettlePaid('${c.id}', 'cust')">💰 MANAGE ACCOUNT</button>
        <button class="ADM-save-btn" onclick="openAddCustomerModal('${c.id}')">✏️ EDIT DETAILS</button>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

window.closeBriefing = () => document.getElementById('briefingModal').classList.add('hidden');

window.cmdToggleClean = (id) => {
    const c = db.customers.find(x => x.id === id); c.cleaned = !c.cleaned;
    saveData(); renderAllSafe(); closeBriefing();
};

window.cmdSettlePaid = (id, ctx) => {
    currentPayId = id; currentPayContext = ctx;
    const c = db.customers.find(x => x.id === id);
    const arr = window.getArrearsData(c);
    document.getElementById('pay-name').innerText = c.name;
    document.getElementById('pay-arrears-box').innerText = `Total Owed: £${arr.total.toFixed(2)}`;
    document.getElementById('paymentModal').classList.remove('hidden');
    closeBriefing();
};
window.closePaymentModal = () => document.getElementById('paymentModal').classList.add('hidden');

window.processPayment = (type) => {
    const c = db.customers.find(x => x.id === currentPayId);
    let amt = (type === 'full') ? window.getArrearsData(c).total : parseFloat(document.getElementById('pay-custom-amt').value);
    if(isNaN(amt)) return;
    c.paidThisMonth += amt;
    db.history.push({ custId: currentPayId, amt, date: new Date().toLocaleDateString('en-GB') });
    saveData(); renderAllSafe(); closePaymentModal();
};

window.openExpenseModal = () => document.getElementById('expenseModal').classList.remove('hidden');
window.closeExpenseModal = () => document.getElementById('expenseModal').classList.add('hidden');

window.addFinanceExpense = () => {
    const desc = document.getElementById('mExpDesc').value;
    const amt = parseFloat(document.getElementById('mExpAmt').value);
    if(!desc || isNaN(amt)) return;
    db.expenses.push({ desc, amt, date: new Date().toLocaleDateString('en-GB') });
    saveData(); closeExpenseModal(); renderFinances();
};

window.renderFinances = () => {
    const inc = db.history.reduce((s, h) => s + parseFloat(h.amt), 0);
    const exp = db.expenses.reduce((s, e) => s + parseFloat(e.amt), 0);
    document.getElementById('FIN-black-card').innerHTML = `<h3>Net Profit</h3><h1>£${(inc - exp).toFixed(2)}</h1>`;
    document.getElementById('FIN-bento-box').innerHTML = `<div class="fin-bento-card">Income: £${inc.toFixed(2)}</div><div class="fin-bento-card">Spent: £${exp.toFixed(2)}</div>`;
};

window.setWorkingWeek = (w) => { curWeek = w; renderWeek(); };
window.setWorkingDay = (d, b) => { workingDay = d; document.querySelectorAll('.WEE-day-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderWeek(); };

window.triggerAI = (type) => {
    if(!localStorage.getItem('HP_AI_Key')) document.getElementById('aiTeaserModal').classList.remove('hidden');
    else showToast("AI Engine v3.4 Pending...");
};
window.closeAITeaserModal = () => document.getElementById('aiTeaserModal').classList.add('hidden');
window.saveModalAIKey = () => { localStorage.setItem('HP_AI_Key', document.getElementById('aiKeyInputModal').value); closeAITeaserModal(); };
window.saveSettingsAIKey = () => { localStorage.setItem('HP_AI_Key', document.getElementById('sAIKey').value); showToast("Key Saved"); };

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
