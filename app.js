"use strict";

const DB_KEY = 'HydroPro_Gold_V36'; 
const W_API_KEY = "4c00e61833ea94d3c4a1bff9d2c32969"; 

let db = { customers: [], expenses: [], history: [], bank: { name: '', acc: '' } };
let curWeek = 1; 
let workingDay = 'Mon';
let financeChartInstance = null; 

let currentPayId = null;
let currentPayContext = null;
let currentPayTotal = 0;

let confirmCallback = null; 

const triggerHaptic = () => {
    if (navigator.vibrate) navigator.vibrate(40);
};

window.showToast = (msg, type = 'normal') => {
    triggerHaptic();
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
};

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error('PWA Reg Failed:', err));
    });
}

// THE ACTUAL, VALID JS STRING REPLACEMENT FOR ESCAPING HTML
const escapeHTML = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'); 
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

document.addEventListener('DOMContentLoaded', () => {
    try {
        const saved = localStorage.getItem(DB_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            db.customers = parsed.customers || [];
            db.expenses = parsed.expenses || [];
            db.history = parsed.history || [];
            db.bank = parsed.bank || { name: '', acc: '' };
        }
    } catch(err) { console.error("Database Boot Error."); }

    applyTheme(localStorage.getItem('HP_Theme') === 'true');
    const bNameEl = document.getElementById('bName'); const bAccEl = document.getElementById('bAcc');
    if(bNameEl) bNameEl.value = db.bank.name; if(bAccEl) bAccEl.value = db.bank.acc;

    renderAllSafe(); initWeather();
});

function applyTheme(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    
    const meta = document.getElementById('theme-meta');
    if(meta) meta.content = isDark ? "#000" : "#f2f2f7";

    const btnLight = document.getElementById('btnLight');
    const btnDark = document.getElementById('btnDark');
    if (btnLight && btnDark) {
        if (isDark) { btnLight.classList.remove('active'); btnDark.classList.add('active'); } 
        else { btnLight.classList.add('active'); btnDark.classList.remove('active'); }
    }
}

window.setThemeMode = (isDark) => {
    triggerHaptic();
    applyTheme(isDark);
    localStorage.setItem('HP_Theme', isDark);
    if(document.getElementById('finances-root').classList.contains('active')) renderFinances();
};

window.saveData = () => localStorage.setItem(DB_KEY, JSON.stringify(db));

window.openTab = (id, btnEl = null) => {
    triggerHaptic();
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const target = document.getElementById(id);
    if(target) {
        target.classList.add('active');
        const titleText = target.getAttribute('data-title');
        if(titleText) document.getElementById('dynamic-header-title').innerText = titleText;
    }
    
    if (btnEl) {
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
        btnEl.classList.add('active');
    }
    window.scrollTo(0,0);
    renderAllSafe();
};

window.renderAllSafe = () => {
    try {
        if(document.getElementById('master-root').classList.contains('active')) renderMaster();
        if(document.getElementById('finances-root').classList.contains('active')) renderFinances();
        if(document.getElementById('week-view-root').classList.contains('active')) renderWeek();
    } catch (err) { console.error("Render Error:", err); }
};

window.openAddCustomerModal = () => { triggerHaptic(); document.getElementById('addCustomerModal').classList.remove('hidden'); };
window.closeAddCustomerModal = () => document.getElementById('addCustomerModal').classList.add('hidden');

window.saveCustomer = () => {
    triggerHaptic();
    const name = document.getElementById('cName').value.trim();
    if(!name) {
        showToast("Customer Name is required", "error"); 
        return;
    }
    
    db.customers.push({ 
        id: Date.now().toString(), 
        name, 
        houseNum: document.getElementById('cHouseNum').value.trim(), 
        street: document.getElementById('cStreet').value.trim(), 
        postcode: document.getElementById('cPostcode').value.trim(), 
        phone: document.getElementById('cPhone').value.trim(), 
        price: parseFloat(document.getElementById('cPrice').value) || 0, 
        notes: document.getElementById('cNotes').value.trim(), 
        cleaned: false, 
        paidThisMonth: 0, 
        pastArrears: [], 
        week: document.getElementById('cWeek').value, 
        day: document.getElementById('cDay').value 
    });
    saveData(); 
    showToast(`${name} added to database`, "success"); 
    
    document.getElementById('cName').value = '';
    document.getElementById('cHouseNum').value = '';
    document.getElementById('cStreet').value = '';
    document.getElementById('cPostcode').value = '';
    document.getElementById('cPhone').value = '';
    document.getElementById('cPrice').value = '';
    document.getElementById('cNotes').value = '';
    document.getElementById('cWeek').value = '1';
    document.getElementById('cDay').value = 'Mon';
    
    closeAddCustomerModal();
    renderAllSafe(); 
};

window.saveBank = () => { 
    triggerHaptic();
    db.bank.name = document.getElementById('bName').value; 
    db.bank.acc = document.getElementById('bAcc').value; 
    saveData(); 
    showToast("Bank Details Secured 🔒", "success"); 
};

const showConfirm = (title, text, actionCallback) => {
    triggerHaptic();
    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmText').innerText = text;
    confirmCallback = actionCallback;
    document.getElementById('confirmModal').classList.remove('hidden');
};

window.closeConfirmModal = () => {
    document.getElementById('confirmModal').classList.add('hidden');
    confirmCallback = null;
};

document.getElementById('confirmActionBtn').addEventListener('click', () => {
    if(confirmCallback) confirmCallback();
    closeConfirmModal();
});

window.cmdCycleMonth = () => {
    showConfirm("Start New Month?", "This will reset all cleans to false and roll unpaid balances into arrears.", () => {
        const cycleMonth = new Date().toLocaleString('en-GB', { month: 'short', year: '2-digit' });
        db.customers.forEach(c => { 
            const paid = parseFloat(c.paidThisMonth) || 0; 
            const price = c.cleaned ? (parseFloat(c.price) || 0) : 0; 
            if (paid < price) { 
                if (!c.pastArrears) c.pastArrears = []; 
                c.pastArrears.push({ month: cycleMonth, amt: price - paid }); 
            } 
            c.cleaned = false; c.paidThisMonth = 0; 
        }); 
        db.expenses = []; saveData(); location.reload();
    });
};

window.cmdNuclear = () => {
    showConfirm("FACTORY RESET?", "This will permanently delete all customer data, finances, and settings.", () => {
        localStorage.removeItem(DB_KEY); location.reload();
    });
};

window.exportToQuickBooks = () => { triggerHaptic(); let csv = "Date,Description,Amount,Type,Category\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},Income: ${escapeHTML(c.name)},${c.paidThisMonth},Income,Service\n`; }); db.expenses.forEach(e => { csv += `${e.date},${escapeHTML(e.desc)},${e.amt},Expense,${escapeHTML(e.cat) || 'Other'}\n`; }); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "HydroPro_QuickBooks.csv"; link.click(); };
window.exportData = () => { triggerHaptic(); const blob = new Blob([JSON.stringify(db)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "HydroPro_Backup.json"; link.click(); };
window.importData = (event) => { const reader = new FileReader(); reader.onload = (e) => { try { const imported = JSON.parse(e.target.result); db.customers = imported.customers || []; db.expenses = imported.expenses || []; db.history = imported.history || []; db.bank = imported.bank || { name: '', acc: '' }; saveData(); showToast("Data Restored Successfully", "success"); setTimeout(() => location.reload(), 1500); } catch (err) { showToast("Invalid Format File", "error"); } }; reader.readAsText(event.target.files[0]); };

window.renderMaster = () => { 
    const list = document.getElementById('CST-list-container'); if(!list) return; list.innerHTML = '';
    const search = (document.getElementById('mainSearch')?.value || "").toLowerCase();
    let renderedCount = 0;
    db.customers.forEach(c => {
        if(c.name.toLowerCase().includes(search) || (c.street||"").toLowerCase().includes(search)) {
            renderedCount++;
            const arrData = window.getArrearsData(c);
            const arrearsBadge = arrData.isOwed ? `<span class="CST-badge badge-unpaid">OWES £${arrData.total.toFixed(2)}</span>` : `<span class="CST-badge badge-paid">PAID</span>`;
            const div = document.createElement('div'); div.className = 'CST-card-item'; div.onclick = () => showCustomerBriefing(c.id);
            div.innerHTML = `<div class="CST-card-top"><div><strong style="font-size:20px;">${escapeHTML(c.name)}</strong><br><small style="color:var(--accent); font-weight:800;">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</small></div><div style="font-weight:950; font-size:22px;">£${(parseFloat(c.price)||0).toFixed(2)}</div></div><div class="CST-card-badges">${arrearsBadge}</div>`;
            list.appendChild(div);
        }
    });
    if (renderedCount === 0) list.innerHTML = `<div class="empty-state"><span class="empty-icon">👻</span><div class="empty-text">No Customers Found</div></div>`;
};

window.viewWeek = (num) => { triggerHaptic(); curWeek = num; openTab('week-view-root'); renderWeek(); };
window.setWorkingDay = (day, btn) => { triggerHaptic(); workingDay = day; document.querySelectorAll('.WEE-day-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); renderWeek(); };

window.renderWeek = () => { 
    const list = document.getElementById('WEE-list-container'); if(!list) return; list.innerHTML = '';
    let customersToday = db.customers.filter(c => c.week == curWeek && c.day == workingDay);
    if(customersToday.length === 0) return list.innerHTML = `<div
