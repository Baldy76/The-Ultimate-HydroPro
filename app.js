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

let confirmCallback = null; // Stores the function to run if user confirms a dangerous action

// --- NEW: HAPTIC ENGINE ---
const triggerHaptic = () => {
    if (navigator.vibrate) navigator.vibrate(40);
};

// --- NEW: TOAST NOTIFICATIONS ---
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

const escapeHTML = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '''); 
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
    
    // Updates the meta tag so iOS status bar color matches
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
        // --- NEW: Dynamic Header Text Update ---
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
        showToast("Customer Name is required", "error"); // Replaced alert()
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
    showToast(`${name} added to database`, "success"); // Success Toast
    
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


// --- NEW: CUSTOM CONFIRM LOGIC ---
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
    if(customersToday.length === 0) return list.innerHTML = `<div class="empty-state"><span class="empty-icon">🏖️</span><div class="empty-text">Zero Jobs Today</div><div class="empty-sub">Enjoy the day off!</div></div>`;

    customersToday.forEach(c => {
        const arrData = window.getArrearsData(c);
        const cleanBadge = c.cleaned ? `<span class="CST-badge badge-clean">✅ CLEANED</span>` : '';
        const arrearsBadge = arrData.isOwed ? `<span class="CST-badge badge-unpaid">❌ OWES £${arrData.total.toFixed(2)}</span>` : `<span class="CST-badge badge-paid">✅ PAID</span>`;
        const div = document.createElement('div'); div.className = 'CST-card-item'; div.onclick = () => showJobBriefing(c.id);
        div.innerHTML = `<div class="CST-card-top"><div><strong style="font-size:20px;">${escapeHTML(c.name)}</strong><br><small style="color:var(--accent); font-weight:800;">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</small></div><div style="font-weight:950; font-size:22px;">£${(parseFloat(c.price)||0).toFixed(2)}</div></div><div class="CST-card-badges">${cleanBadge} ${arrearsBadge}</div>`;
        list.appendChild(div);
    });
};

window.routeMyDay = () => {
    triggerHaptic();
    let todaysJobs = db.customers.filter(c => c.week == curWeek && c.day == workingDay);
    if(todaysJobs.length === 0) return showToast("No jobs to route today!", "error");
    if(todaysJobs.length > 10) showToast("Routing limited to first 10 stops.", "normal");
    
    let stops = todaysJobs.slice(0, 10).map(c => encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`));
    let destination = stops.pop(); let waypoints = stops.join('|'); 
    
    let url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    if(waypoints) url += `&waypoints=${waypoints}`;
    window.open(url, '_blank');
};

window.cmdWhatsApp = (id) => {
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); if(!c.phone) return showToast("No phone number saved.", "error");
    let phone = c.phone.replace(/\D/g, ''); if(phone.startsWith('0')) phone = '44' + phone.substring(1); 
    const arrData = window.getArrearsData(c);
    let msg = `Hi ${c.name}! Just letting you know your windows are all sparkling clean again. ✨ `;
    if(arrData.isOwed) { msg += `Your total is £${arrData.total.toFixed(2)}. `; if (db.bank.name && db.bank.acc) { msg += `Whenever you get a sec, you can ping that over via bank transfer to ${db.bank.name} (Acc: ${db.bank.acc}). Thanks a million! 💧`; } else { msg += `Let me know what payment method works best for you. Thanks a million! 💧`; } } else { msg += `You're all paid up, so nothing owed today. Have a brilliant rest of your week! ☀️`; }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.cmdSMS = (id) => {
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); if(!c.phone) return showToast("No phone number saved.", "error");
    let phone = c.phone.replace(/\D/g, ''); const arrData = window.getArrearsData(c);
    let msg = `Hi ${c.name}! Just letting you know your windows are all sparkling clean again. ✨ `;
    if(arrData.isOwed) { msg += `Your total is £${arrData.total.toFixed(2)}. `; if (db.bank.name && db.bank.acc) { msg += `Whenever you get a sec, you can ping that over via bank transfer to ${db.bank.name} (Acc: ${db.bank.acc}). Thanks a million! 💧`; } else { msg += `Let me know what payment method works best for you. Thanks a million! 💧`; } } else { msg += `You're all paid up, so nothing owed today. Have a brilliant rest of your week! ☀️`; }
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const separator = isIOS ? '&' : '?';
    window.open(`sms:${phone}${separator}body=${encodeURIComponent(msg)}`, '_blank');
};

const generateHistoryHtml = (id) => { 
    const history = db.history.filter(h => h.custId === id).slice(-3).reverse();
    if (history.length === 0) return `<div class="empty-state" style="padding: 10px;"><div class="empty-text" style="font-size:14px;">No Payment History</div></div>`;
    return history.map(h => `<div class="CMD-history-row"><span>${escapeHTML(h.date)}</span><span>£${parseFloat(h.amt).toFixed(2)}</span></div>`).join('');
};

const generateArrearsHtml = (arrData, cId, context) => { 
    if (!arrData.isOwed) return `<div class="CMD-alert-success">✅ FULLY PAID UP</div>`;
    let listHtml = arrData.breakdown.map(b => `<li>£${b.amt.toFixed(2)} - ${escapeHTML(b.month)}</li>`).join('');
    
    return `<div class="CMD-alert-danger" onclick="cmdSettlePaid('${cId}', '${context}')" style="cursor:pointer; transition: 0.2s;">
                <div class="CMD-alert-danger-title">⚠️ TOTAL OUTSTANDING: £${arrData.total.toFixed(2)}</div>
                <ul class="CMD-arrears-list">${listHtml}</ul>
                <div style="margin-top: 15px; font-size: 11px; font-weight: 900; opacity: 0.8; text-transform: uppercase;">👆 Tap to settle account</div>
            </div>`;
};

window.showJobBriefing = (id) => {
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); if(!c) return;
    const container = document.getElementById('briefingData');
    const arrData = window.getArrearsData(c);
    const mapQuery = encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`);
    const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${mapQuery}`;
    
    const notesHtml = c.notes ? `<div class="CMD-notes-box">📝 ${escapeHTML(c.notes)}</div>` : '';

    container.innerHTML = `
        <div class="CMD-header"><h2>${escapeHTML(c.name)}</h2><div class="CMD-header-sub">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</div></div>
        ${notesHtml}
        ${generateArrearsHtml(arrData, c.id, 'job')}
        <div class="CMD-action-grid">
            <button class="CMD-action-btn clean" onclick="cmdToggleClean('${c.id}')"><span style="font-size:24px;">🧼</span> <br>${c.cleaned ? 'UNDO CLEAN' : 'MARK CLEAN'}</button>
            <button class="CMD-action-btn pay" onclick="cmdSettlePaid('${c.id}', 'job')"><span style="font-size:24px;">💰</span> <br>COLLECT £</button>
            <button class="CMD-action-btn route" onclick="window.open('${navUrl}', '_blank')"><span style="font-size:24px;">📍</span> <br>NAVIGATE</button>
            <button class="CMD-action-btn call" onclick="window.location.href='tel:${escapeHTML(c.phone)}'"><span style="font-size:24px;">📞</span> <br>CALL</button>
            <button class="CMD-action-btn whatsapp" onclick="cmdWhatsApp('${c.id}')"><span style="font-size:24px;">💬</span> <br>WA REC</button>
            <button class="CMD-action-btn sms" onclick="cmdSMS('${c.id}')"><span style="font-size:24px;">📱</span> <br>SMS REC</button>
        </div>
        <h3 class="CMD-history-hdr">Rolling History</h3><div class="CMD-history-box">${generateHistoryHtml(c.id)}</div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

window.showCustomerBriefing = (id) => { 
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); if(!c) return;
    const container = document.getElementById('briefingData');
    const arrData = window.getArrearsData(c);
    
    const notesHtml = c.notes ? `<div class="CMD-notes-box">📝 ${escapeHTML(c.notes)}</div>` : '';

    container.innerHTML = `
        <div class="CMD-header"><h2>${escapeHTML(c.name)}</h2><div class="CMD-header-sub">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)} <br>${escapeHTML(c.postcode || '')}</div></div>
        <div class="CMD-details-box">
            <div class="CMD-detail-row"><span>📞 Phone</span><span>${escapeHTML(c.phone) || 'N/A'}</span></div>
            <div class="CMD-detail-row"><span>💰 Price</span><span>£${parseFloat(c.price).toFixed(2)}</span></div>
            <div class="CMD-detail-row"><span>📅 Week</span><span>Week ${escapeHTML(c.week)}</span></div>
            <div class="CMD-detail-row"><span>📆 Day</span><span>${escapeHTML(c.day)}</span></div>
        </div>
        ${notesHtml}
        ${generateArrearsHtml(arrData, c.id, 'cust')}
        <h3 class="CMD-history-hdr">Rolling History</h3><div class="CMD-history-box">${generateHistoryHtml(c.id)}</div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

window.closeBriefing = () => document.getElementById('briefingModal').classList.add('hidden');

window.cmdToggleClean = (id) => { 
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); 
    c.cleaned = !c.cleaned; 
    window.saveData(); window.renderAllSafe(); window.showJobBriefing(id); 
    showToast(c.cleaned ? "Marked as Cleaned ✅" : "Clean Undone", "success");
};

window.cmdSettlePaid = (id, context) => { 
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); 
    const arrData = window.getArrearsData(c);
    
    currentPayId = id;
    currentPayContext = context;
    currentPayTotal = arrData.total;

    document.getElementById('pay-name').innerText = c.name;
    
    const arrearsBox = document.getElementById('pay-arrears-box');
    if(arrData.isOwed) {
        let listHtml = arrData.breakdown.map(b => `<li>£${b.amt.toFixed(2)} - ${escapeHTML(b.month)}</li>`).join('');
        arrearsBox.innerHTML = `<div class="CMD-alert-danger-title" style="margin-bottom: 5px;">⚠️ BREAKDOWN</div><ul class="CMD-arrears-list">${listHtml}</ul>`;
        arrearsBox.style.display = 'block';
    } else {
        arrearsBox.style.display = 'none';
    }

    document.getElementById('pay-full-btn').innerText = `PAY IN FULL (£${arrData.total.toFixed(2)})`;
    document.getElementById('pay-custom-amt').value = '';

    document.getElementById('briefingModal').classList.add('hidden');
    document.getElementById('paymentModal').classList.remove('hidden');
};

window.closePaymentModal = () => {
    document.getElementById('paymentModal').classList.add('hidden');
    currentPayId = null;
};

window.processPayment = (type) => {
    triggerHaptic();
    if(!currentPayId) return;
    const c = db.customers.find(x => x.id === currentPayId);

    let amtPaid = 0;
    if(type === 'full') {
        amtPaid = currentPayTotal;
    } else {
        amtPaid = parseFloat(document.getElementById('pay-custom-amt').value);
    }

    if (isNaN(amtPaid) || amtPaid <= 0) return showToast("Please enter a valid amount.", "error");

    c.paidThisMonth = (parseFloat(c.paidThisMonth) || 0) + amtPaid; 
    let thisMonthCharge = c.cleaned ? (parseFloat(c.price) || 0) : 0;
    let overpay = c.paidThisMonth - thisMonthCharge;
    
    if(overpay > 0.01 && c.pastArrears && c.pastArrears.length > 0) {
        let remaining = overpay;
        for(let i=0; i<c.pastArrears.length; i++) {
            if(remaining >= c.pastArrears[i].amt) { remaining -= c.pastArrears[i].amt; c.pastArrears[i].amt = 0; } 
            else { c.pastArrears[i].amt -= remaining; remaining = 0; break; }
        }
        c.pastArrears = c.pastArrears.filter(a => a.amt > 0.01);
    }
    
    if(!db.history) db.history = []; db.history.push({ custId: currentPayId, amt: amtPaid, date: new Date().toLocaleDateString('en-GB') }); 
    
    window.saveData(); 
    window.renderAllSafe(); 
    closePaymentModal();
    
    showToast(`Payment of £${amtPaid.toFixed(2)} secured 💰`, "success");
    
    if (currentPayContext === 'job') window.showJobBriefing(currentPayId); else window.showCustomerBriefing(currentPayId);
};


window.addFinanceExpense = () => { 
    triggerHaptic();
    const desc = document.getElementById('fExpDesc').value.trim(); const amt = parseFloat(document.getElementById('fExpAmt').value); const cat = document.getElementById('fExpCat').value;
    if(!desc || isNaN(amt) || amt <= 0) return showToast("Description and Amount required", "error");
    db.expenses.push({ id: Date.now(), desc, amt, cat, date: new Date().toLocaleDateString('en-GB') });
    saveData(); document.getElementById('fExpDesc').value = ''; document.getElementById('fExpAmt').value = ''; renderFinances();
    showToast("Expense Logged", "success");
};

const arc3DPlugin = {
    id: 'arc3DPlugin',
    beforeDatasetDraw: (chart, args, options) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.shadowColor = document.body.classList.contains('dark-mode') ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 10;
    },
    afterDatasetDraw: (chart, args, options) => {
        chart.ctx.restore();
    }
};

window.renderFinances = () => {
    const dash = document.getElementById('FIN-dashboard'); const ledger = document.getElementById('FIN-ledger'); if(!dash || !ledger) return;
    
    let income = 0, spend = 0, expected = 0, totalArrears = 0, forecasted = 0; 
    let arrearsListHtml = '';

    db.customers.forEach(c => {
        income += (parseFloat(c.paidThisMonth) || 0); 
        expected += (parseFloat(c.price) || 0);
        
        if (!c.cleaned) forecasted += (parseFloat(c.price) || 0);

        const arrData = window.getArrearsData(c);
        if(arrData.isOwed) { 
            totalArrears += arrData.total; 
            arrearsListHtml += `<div class="CMD-detail-row"><span>${escapeHTML(c.name)} <small style="opacity:0.7;">${escapeHTML(arrData.monthsString)}</small></span><span>£${arrData.total.toFixed(2)}</span></div>`; 
        }
    });

    db.expenses.forEach(e => spend += (parseFloat(e.amt) || 0));
    const progressPct = expected > 0 ? Math.min((income / expected) * 100, 100) : 0;

    let arrearsSection = ''; 
    if (totalArrears > 0) { arrearsSection = `<div class="FIN-arrears-card"><div style="font-size:20px; margin-bottom:15px;">⚠️ OUTSTANDING: £${totalArrears.toFixed(2)}</div><div style="text-align:left; background:rgba(0,0,0,0.15); padding:15px; border-radius:20px; max-height:150px; overflow-y:auto;">${arrearsListHtml}</div></div>`; }
    
    let htmlBuilder = `<div class="FIN-hero-iron"><small style="opacity:0.5; font-weight:900;">NET PROFIT</small><div>£${(income - spend).toFixed(2)}</div></div>`;
    htmlBuilder += arrearsSection;
    htmlBuilder += `<div style="padding: 0 25px; margin-bottom: 5px; font-weight: 950; font-size: 14px; color: var(--accent); display: flex; justify-content: space-between;"><span>COLLECTION PROGRESS</span><span>${Math.round(progressPct)}%</span></div>`;
    htmlBuilder += `<div class="FIN-progress-wrap"><div class="FIN-progress-fill" style="width: ${progressPct}%;"></div></div>`;
    
    htmlBuilder += `
        <div class="FIN-bubble-row">
            <div class="FIN-bubble income">
                <div class="bubble-icon">📈</div>
                <div class="bubble-info">
                    <small>INCOME</small>
                    <strong>£${income.toFixed(2)}</strong>
                </div>
            </div>
            <div class="FIN-bubble spent">
                <div class="bubble-icon">📉</div>
                <div class="bubble-info">
                    <small>SPENT</small>
                    <strong>£${spend.toFixed(2)}</strong>
                </div>
            </div>
        </div>`;
    
    dash.innerHTML = htmlBuilder;
    
    const ctx = document.getElementById('financeChartCanvas');
    if (ctx && typeof Chart !== 'undefined') {
        if (financeChartInstance) financeChartInstance.destroy(); 
        
        let labels = [
            `Collected: £${income.toFixed(2)}`, 
            `Debt: £${totalArrears.toFixed(2)}`, 
            `Forecasted: £${forecasted.toFixed(2)}`
        ]; 
        let chartData = [income, totalArrears, forecasted]; 
        let colors = ['#34C759', '#ff453a', '#007aff'];
        let isDarkMode = document.body.classList.contains('dark-mode');
        
        if (income > 0 || totalArrears > 0 || forecasted > 0) {
            financeChartInstance = new Chart(ctx, { 
                type: 'doughnut', 
                plugins: [arc3DPlugin], 
                data: { 
                    labels: labels, 
                    datasets: [{ 
                        data: chartData, 
                        backgroundColor: colors, 
                        borderWidth: 4, 
                        borderColor: isDarkMode ? '#1c1c1e' : '#ffffff', 
                        borderRadius: 15, 
                        hoverOffset: 6,
                        spacing: 5 
                    }] 
                }, 
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    cutout: '75%', 
                    layout: { padding: 10 },
                    plugins: { 
                        legend: { 
                            position: 'bottom', 
                            labels: { 
                                padding: 15, 
                                usePointStyle: true, 
                                pointStyle: 'circle',
                                color: isDarkMode ? '#fff' : '#000', 
                                font: { family: '"Plus Jakarta Sans", sans-serif', weight: 'bold', size: 13 } 
                            } 
                        },
                        tooltip: {
                            backgroundColor: isDarkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)',
                            titleColor: isDarkMode ? '#000' : '#fff',
                            bodyColor: isDarkMode ? '#000' : '#fff',
                            padding: 12,
                            cornerRadius: 12,
                            displayColors: false,
                            callbacks: {
                                label: function(context) {
                                    return ' ' + context.label;
                                }
                            }
                        }
                    } 
                } 
            });
        }
    }
    
    let statementHtml = ''; 
    if (db.expenses.length === 0) { 
        statementHtml = `<div class="empty-state"><span class="empty-icon">🧾</span><div class="empty-text">No Expenses Yet</div><div class="empty-sub">Your ledger is completely clean.</div></div>`; 
    } else { 
        let tableRows = '';
        let reversedExpenses = [...db.expenses].reverse();
        
        reversedExpenses.forEach(item => {
            let catIcon = "🏢"; 
            if(item.cat === 'Fuel') catIcon = "⛽"; 
            if(item.cat === 'Equipment') catIcon = "🧽"; 
            if(item.cat === 'Food') catIcon = "🍔"; 
            if(item.cat === 'Marketing') catIcon = "📣"; 
            
            tableRows += `
                <tr>
                    <td style="width: 40px; font-size: 24px; text-align: center; padding-left: 0;">${catIcon}</td>
                    <td>
                        <div style="display:flex; flex-direction:column;">
                            <span style="color:var(--text);">${escapeHTML(item.desc)}</span>
                            <small style="opacity:0.5; font-size:11px;">${escapeHTML(item.date)}</small>
                        </div>
                    </td>
                    <td style="text-align: right; color: var(--danger); padding-right: 0;">-£${parseFloat(item.amt).toFixed(2)}</td>
                </tr>`; 
        }); 
        
        statementHtml = `
            <div class="FIN-ledger-card">
                <div class="FIN-ledger-wrapper">
                    <table class="FIN-ledger-table">
                        <thead>
                            <tr>
                                <th style="padding-left: 0;">Cat</th>
                                <th>Details</th>
                                <th style="text-align: right; padding-right: 0;">Amt</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
                <div class="FIN-ledger-total">
                    <span>TOTAL EXPENSES</span>
                    <span>-£${spend.toFixed(2)}</span>
                </div>
            </div>
        `; 
    }
    ledger.innerHTML = statementHtml;
};

const getIcon = (code) => {
    const map = { '01d':'☀️','01n':'🌙','02d':'⛅','02n':'☁️','03d':'☁️','03n':'☁️','04d':'☁️','04n':'☁️','09d':'🌧️','09n':'🌧️','10d':'🌧️','10n':'🌧️','11d':'🌦️','11n':'🌧️','13d':'🌨️','13n':'🌨️','50d':'💨','50n':'💨' };
    return map[code] || '🌤️';
};

async function initWeather() { 
    const wDash = document.getElementById('WTH-dashboard');
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (pos) => { 
            try { 
                const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${W_API_KEY}&units=metric`); 
                const data = await res.json(); 
                const temp = `${Math.round(data.main.temp)}°C`; 
                const currentIcon = getIcon(data.weather[0].icon);
                const currentDesc = data.weather[0].description;
                
                const fRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${W_API_KEY}&units=metric`);
                const fData = await fRes.json();
                
                const dailyData = fData.list.filter(item => item.dt_txt.includes('12:00:00')).slice(0, 5);
                
                let forecastHtml = dailyData.map(day => {
                    const dateObj = new Date(day.dt * 1000);
                    const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
                    return `<div class="WTH-card">
                                <span class="WTH-day">${dayName}</span>
                                <span class="WTH-icon">${getIcon(day.weather[0].icon)}</span>
                                <span class="WTH-temps">${Math.round(day.main.temp)}°C</span>
                            </div>`;
                }).join('');

                if(wDash) {
                    wDash.innerHTML = `
                        <div class="WTH-hero">
                            <div class="WTH-icon" style="font-size: 50px;">${currentIcon}</div>
                            <div class="WTH-hero-temp">${temp}</div>
                            <div class="WTH-hero-desc">${currentDesc}</div>
                            <div style="font-size: 14px; font-weight: 900; color: var(--text); opacity: 0.5; margin-top: 15px; letter-spacing: 1px; text-transform: uppercase;">📍 ${escapeHTML(data.name)}</div>
                        </div>
                        <h3 class="ADM-hdr" style="margin: 25px 0 10px;">5-Day Forecast</h3>
                        ${forecastHtml}
                    `;
                }

            } catch (e) { 
                if (wDash) wDash.innerHTML = `<div class="empty-state"><span class="empty-icon">📡</span><div class="empty-text">Weather Offline</div><div class="empty-sub">Check your connection to pull the radar.</div></div>`;
            } 
        });
    }
}