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

const escapeHTML = (str) => {
    if (!str) return '';
    return String(str).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, '"').replace(/'/g, "'"); 
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

let wthStartY = 0;
let wthContainer = null;
let ptrIndicator = null;

const initPTR = () => {
    wthContainer = document.getElementById('weather-root');
    ptrIndicator = document.getElementById('ptr-indicator');
    if(!wthContainer || !ptrIndicator) return;
    wthContainer.addEventListener('touchstart', e => { if (wthContainer.scrollTop === 0) wthStartY = e.touches[0].clientY; }, {passive: true});
    wthContainer.addEventListener('touchmove', e => {
        if (wthContainer.scrollTop === 0 && wthStartY > 0) {
            let currentY = e.touches[0].clientY;
            let diff = currentY - wthStartY;
            if (diff > 20) ptrIndicator.classList.add('visible');
        }
    }, {passive: true});
    wthContainer.addEventListener('touchend', e => {
        if (ptrIndicator.classList.contains('visible')) {
            ptrIndicator.classList.remove('visible');
            triggerHaptic(); showToast("Fetching Radar...", "normal"); initWeather();
        }
        wthStartY = 0;
    });
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Ultimate Hydro Pro v2.2 Booting...");
    
    try {
        await idb.init(); 
        let savedData = await idb.get('master_db');
        if (!savedData) {
            const legacyData = localStorage.getItem(DB_KEY);
            if (legacyData) {
                savedData = JSON.parse(legacyData);
                await idb.set('master_db', savedData);
            }
        }
        if (savedData) {
            db.customers = savedData.customers || [];
            db.expenses = savedData.expenses || [];
            db.history = savedData.history || [];
            db.bank = savedData.bank || { name: '', acc: '' };
        }
    } catch(err) { console.error("Boot Error:", err); }

    applyTheme(localStorage.getItem('HP_Theme') === 'true');
    const bNameEl = document.getElementById('bName'); const bAccEl = document.getElementById('bAcc');
    if(bNameEl) bNameEl.value = db.bank.name; if(bAccEl) bAccEl.value = db.bank.acc;

    document.querySelectorAll('.WEE-day-btn').forEach(b => b.classList.remove('active'));
    const activeDayBtn = document.getElementById(`day-${workingDay}`);
    if(activeDayBtn) activeDayBtn.classList.add('active');
    
    document.querySelectorAll('.segment').forEach(b => { if(b.id && b.id.startsWith('wk-btn-')) b.classList.remove('active'); });
    const activeWkBtn = document.getElementById(`wk-btn-${curWeek}`);
    if(activeWkBtn) activeWkBtn.classList.add('active');

    renderAllSafe(); initWeather(); initPTR();

    const weekView = document.getElementById('week-view-root');
    if(weekView) {
        weekView.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
        weekView.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; handleSwipe(); }, {passive: true});
    }
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
    triggerHaptic(); applyTheme(isDark); localStorage.setItem('HP_Theme', isDark);
    if(document.getElementById('finances-root').classList.contains('active')) renderFinances();
};

window.saveData = () => { idb.set('master_db', db); };

window.openTab = (id, btnId = null) => {
    triggerHaptic();
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const target = document.getElementById(id);
    if(target) {
        target.classList.add('active');
        const titleText = target.getAttribute('data-title');
        if(titleText) document.getElementById('dynamic-header-title').innerText = titleText;
    }
    
    if (btnId) {
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.home-fab').forEach(btn => btn.classList.remove('active'));
        const btnEl = document.getElementById(btnId);
        if(btnEl) btnEl.classList.add('active');
    }
    window.scrollTo(0,0);
    renderAllSafe();
};

window.renderAllSafe = () => {
    try {
        const home = document.getElementById('home-root');
        if(home && home.classList.contains('active')) renderHome();
        
        const master = document.getElementById('master-root');
        if(master && master.classList.contains('active')) renderMaster();
        
        const finances = document.getElementById('finances-root');
        if(finances && finances.classList.contains('active')) renderFinances();
        
        const week = document.getElementById('week-view-root');
        if(week && week.classList.contains('active')) renderWeek();
    } catch (err) { console.error("Render Error:", err); }
};

window.renderHome = () => {
    const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
    document.getElementById('home-date').innerText = new Date().toLocaleDateString('en-GB', dateOptions).toUpperCase();

    let todaysJobs = db.customers.filter(c => c.week == curWeek && c.day == workingDay && !c.skipped);
    let routeValue = todaysJobs.reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0);
    document.getElementById('home-jobs-count').innerText = `${todaysJobs.length} Jobs Scheduled (Wk ${curWeek} ${workingDay})`;
    document.getElementById('home-jobs-value').innerText = `£${routeValue.toFixed(2)}`;

    let totalArrears = 0;
    db.customers.forEach(c => {
        const arrData = window.getArrearsData(c);
        if(arrData.isOwed) totalArrears += arrData.total;
    });
    
    let cashTotal = 0;
    let currentMonthStr = new Date().toLocaleDateString('en-GB').substring(3);
    db.history.forEach(h => {
        if (h.date && h.date.includes(currentMonthStr) && h.method !== 'Bank') {
            cashTotal += parseFloat(h.amt);
        }
    });

    document.getElementById('home-arrears').innerText = `£${totalArrears.toFixed(2)}`;
    document.getElementById('home-cash').innerText = `£${cashTotal.toFixed(2)}`;
};

window.openAddCustomerModal = (id = null) => { 
    triggerHaptic(); editingCustomerId = id;
    const titleEl = document.getElementById('customerModalTitle');
    const saveBtn = document.getElementById('saveCustomerBtn');
    const deleteBtn = document.getElementById('deleteCustomerBtn');

    if (id) {
        const c = db.customers.find(x => x.id === id); if(!c) return;
        titleEl.innerText = "Edit Customer"; saveBtn.innerText = "UPDATE"; deleteBtn.classList.remove('hidden'); 
        document.getElementById('cName').value = c.name || '';
        document.getElementById('cHouseNum').value = c.houseNum || '';
        document.getElementById('cStreet').value = c.street || '';
        document.getElementById('cPostcode').value = c.postcode || '';
        document.getElementById('cPhone').value = c.phone || '';
        document.getElementById('cPrice').value = c.price || '';
        document.getElementById('cNotes').value = c.notes || '';
        document.getElementById('cWeek').value = c.week || '1';
        document.getElementById('cDay').value = c.day || 'Mon';
        document.getElementById('briefingModal').classList.add('hidden');
    } else {
        titleEl.innerText = "Add Customer"; saveBtn.innerText = "SAVE"; deleteBtn.classList.add('hidden'); 
        document.getElementById('cName').value = '';
        document.getElementById('cHouseNum').value = '';
        document.getElementById('cStreet').value = '';
        document.getElementById('cPostcode').value = '';
        document.getElementById('cPhone').value = '';
        document.getElementById('cPrice').value = '';
        document.getElementById('cNotes').value = '';
        document.getElementById('cWeek').value = '1';
        document.getElementById('cDay').value = 'Mon';
    }
    document.getElementById('addCustomerModal').classList.remove('hidden'); 
};

window.closeAddCustomerModal = () => { editingCustomerId = null; document.getElementById('addCustomerModal').classList.add('hidden'); };

window.saveCustomer = () => {
    triggerHaptic();
    const name = document.getElementById('cName').value.trim();
    if(!name) { showToast("Customer Name is required", "error"); return; }
    
    const newDetails = {
        name, houseNum: document.getElementById('cHouseNum').value.trim(), 
        street: document.getElementById('cStreet').value.trim(), postcode: document.getElementById('cPostcode').value.trim(), 
        phone: document.getElementById('cPhone').value.trim(), price: parseFloat(document.getElementById('cPrice').value) || 0, 
        notes: document.getElementById('cNotes').value.trim(), week: document.getElementById('cWeek').value, 
        day: document.getElementById('cDay').value 
    };

    if (editingCustomerId) {
        const cIndex = db.customers.findIndex(x => x.id === editingCustomerId);
        if (cIndex > -1) { db.customers[cIndex] = { ...db.customers[cIndex], ...newDetails }; showToast(`${name} updated`, "success"); }
    } else {
        db.customers.push({ id: Date.now().toString(), order: Date.now(), ...newDetails, cleaned: false, skipped: false, paidThisMonth: 0, pastArrears: [] });
        showToast(`${name} added to database`, "success"); 
    }
    saveData(); closeAddCustomerModal(); renderAllSafe(); 
};

window.cmdDeleteCustomer = () => {
    if (!editingCustomerId) return;
    const c = db.customers.find(x => x.id === editingCustomerId); if (!c) return;
    showConfirm("Delete Customer?", `Are you sure you want to permanently remove ${c.name} from the route?`, () => {
        db.customers = db.customers.filter(x => x.id !== editingCustomerId);
        saveData(); showToast(`${c.name} deleted.`, "normal"); closeAddCustomerModal(); renderAllSafe();
    });
};

window.saveBank = () => { triggerHaptic(); db.bank.name = document.getElementById('bName').value; db.bank.acc = document.getElementById('bAcc').value; saveData(); showToast("Bank Details Secured 🔒", "success"); };

const showConfirm = (title, text, actionCallback) => {
    triggerHaptic();
    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmText').innerText = text;
    confirmCallback = actionCallback;
    document.getElementById('confirmModal').classList.remove('hidden');
};

window.closeConfirmModal = () => { document.getElementById('confirmModal').classList.add('hidden'); confirmCallback = null; };

document.getElementById('confirmActionBtn').addEventListener('click', () => { if(confirmCallback) confirmCallback(); closeConfirmModal(); });

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
            c.cleaned = false; c.skipped = false; c.paidThisMonth = 0; 
        }); 
        db.expenses = []; saveData(); location.reload();
    });
};

window.cmdNuclear = () => {
    showConfirm("FACTORY RESET?", "This will permanently delete all customer data, finances, and settings.", async () => {
        await idb.clear(); localStorage.removeItem(DB_KEY); location.reload();
    });
};

window.exportToQuickBooks = () => { triggerHaptic(); let csv = "Date,Description,Amount,Type,Category\n"; const today = new Date().toLocaleDateString('en-GB'); db.customers.forEach(c => { if(parseFloat(c.paidThisMonth) > 0) csv += `${today},Income: ${escapeHTML(c.name)},${c.paidThisMonth},Income,Service\n`; }); db.expenses.forEach(e => { csv += `${e.date},${escapeHTML(e.desc)},${e.amt},Expense,${escapeHTML(e.cat) || 'Other'}\n`; }); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "HydroPro_QuickBooks.csv"; link.click(); };
window.exportData = () => { triggerHaptic(); const blob = new Blob([JSON.stringify(db)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "HydroPro_Backup.json"; link.click(); };
window.importData = (event) => { const reader = new FileReader(); reader.onload = async (e) => { try { const imported = JSON.parse(e.target.result); db.customers = imported.customers || []; db.expenses = imported.expenses || []; db.history = imported.history || []; db.bank = imported.bank || { name: '', acc: '' }; await idb.set('master_db', db); showToast("Data Restored Successfully", "success"); setTimeout(() => location.reload(), 1500); } catch (err) { showToast("Invalid Format File", "error"); } }; reader.readAsText(event.target.files[0]); };

window.toggleArrearsFilter = () => {
    triggerHaptic(); showArrearsOnly = !showArrearsOnly;
    const btn = document.getElementById('arrearsFilterBtn');
    if(showArrearsOnly) { btn.classList.add('active'); } else { btn.classList.remove('active'); }
    renderMaster();
};

window.renderMaster = () => { 
    const list = document.getElementById('CST-list-container'); if(!list) return; list.innerHTML = '';
    const search = (document.getElementById('mainSearch')?.value || "").toLowerCase();
    let renderedCount = 0;
    
    db.customers.forEach(c => {
        const arrData = window.getArrearsData(c);
        if (showArrearsOnly && !arrData.isOwed) return;

        if(c.name.toLowerCase().includes(search) || (c.street||"").toLowerCase().includes(search)) {
            renderedCount++;
            const arrearsBadge = arrData.isOwed ? `<span class="CST-badge badge-unpaid">OWES £${arrData.total.toFixed(2)}</span>` : `<span class="CST-badge badge-paid">PAID</span>`;
            const div = document.createElement('div'); div.className = 'CST-card-item'; div.onclick = () => showCustomerBriefing(c.id);
            div.innerHTML = `<div class="CST-card-top"><div><strong style="font-size:20px;">${escapeHTML(c.name)}</strong><br><small style="color:var(--accent); font-weight:800;">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</small></div><div style="font-weight:950; font-size:22px;">£${(parseFloat(c.price)||0).toFixed(2)}</div></div><div class="CST-card-badges">${arrearsBadge}</div>`;
            list.appendChild(div);
        }
    });
    
    if (renderedCount === 0) {
        list.innerHTML = `<div class="empty-state"><span class="empty-icon">👻</span><div class="empty-text">No Customers Found</div><button class="ADM-save-btn" style="width: 220px; font-size: 14px; height: 50px!important; margin-top: 20px; box-shadow: 0 5px 15px rgba(0,122,255,0.2);" onclick="openAddCustomerModal()">➕ ADD CUSTOMER</button></div>`;
    }
};

window.setWorkingWeek = (num) => { 
    triggerHaptic(); 
    curWeek = num; 
    localStorage.setItem('HP_curWeek', curWeek);
    document.querySelectorAll('.segment').forEach(b => { if(b.id && b.id.startsWith('wk-btn-')) b.classList.remove('active'); });
    const wkBtn = document.getElementById(`wk-btn-${num}`);
    if(wkBtn) wkBtn.classList.add('active');
    renderWeek(); 
};

window.setWorkingDay = (day, btn) => { 
    triggerHaptic(); 
    workingDay = day; 
    localStorage.setItem('HP_workingDay', workingDay);
    document.querySelectorAll('.WEE-day-btn').forEach(b => b.classList.remove('active')); 
    if(btn) btn.classList.add('active'); 
    renderWeek(); 
};

window.viewWeek = (num) => { setWorkingWeek(num); };

const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let touchStartX = 0; let touchEndX = 0;
const handleSwipe = () => {
    const swipeDistance = touchStartX - touchEndX;
    if (Math.abs(swipeDistance) > 60) {
        let currentIndex = daysOfWeek.indexOf(workingDay);
        if (swipeDistance > 0 && currentIndex < 6) currentIndex++;
        else if (swipeDistance < 0 && currentIndex > 0) currentIndex--;
        const btns = document.querySelectorAll('.WEE-day-btn');
        if(btns[currentIndex]) btns[currentIndex].click(); 
    }
};

const attachSwipeGestures = (wrap, fg, cId) => {
    let startX = 0; let currentX = 0; let isSwiping = false;
    fg.addEventListener('touchstart', e => {
        if(e.target.closest('.drag-handle') || e.target.closest('.quick-action-btn')) return; 
        startX = e.touches[0].clientX; fg.classList.add('swiping');
    }, {passive: true});

    fg.addEventListener('touchmove', e => {
        if(e.target.closest('.drag-handle') || e.target.closest('.quick-action-btn')) return;
        currentX = e.touches[0].clientX; let diff = currentX - startX;
        if (Math.abs(diff) > 10) isSwiping = true;
        if (diff > 75) diff = 75 + (diff - 75) * 0.2;
        if (diff < -75) diff = -75 + (diff + 75) * 0.2;
        fg.style.transform = `translate3d(${diff}px, 0, 0)`;
    }, {passive: true});

    fg.addEventListener('touchend', e => {
        if(e.target.closest('.drag-handle') || e.target.closest('.quick-action-btn')) return;
        let diff = currentX - startX; fg.classList.remove('swiping'); fg.style.transform = `translate3d(0, 0, 0)`;
        if (isSwiping) {
            if (diff > 55) { cmdToggleClean(cId); } else if (diff < -55) { cmdSettlePaid(cId, 'job'); }
        }
        setTimeout(() => { isSwiping = false; }, 100); startX = 0; currentX = 0;
    });

    fg.addEventListener('click', e => { if(!isSwiping && !e.target.closest('.drag-handle') && !e.target.closest('.quick-action-btn')) { showJobBriefing(cId); } });
};

const attachDragDrop = (wrap, listContainer) => {
    const handle = wrap.querySelector('.drag-handle');
    let isDragging = false;
    handle.addEventListener('touchstart', e => { isDragging = true; triggerHaptic(); wrap.classList.add('dragging'); }, {passive: true});
    handle.addEventListener('touchmove', e => {
        if (!isDragging) return; e.preventDefault(); 
        const touchY = e.touches[0].clientY;
        const siblings = [...listContainer.querySelectorAll('.swipe-wrapper:not(.dragging)')];
        let nextSibling = siblings.find(sib => { const rect = sib.getBoundingClientRect(); return touchY <= rect.top + rect.height / 2; });
        if (nextSibling) { listContainer.insertBefore(wrap, nextSibling); } else { listContainer.appendChild(wrap); }
    }, {passive: false});
    handle.addEventListener('touchend', e => {
        if (!isDragging) return; isDragging = false; wrap.classList.remove('dragging'); triggerHaptic();
        const newOrderEls = [...listContainer.querySelectorAll('.swipe-wrapper')];
        newOrderEls.forEach((el, index) => { const customer = db.customers.find(c => c.id === el.dataset.id); if(customer) customer.order = index; });
        saveData();
    });
};

window.cmdQuickCall = (phone, e) => {
    e.stopPropagation(); triggerHaptic();
    if(!phone) return showToast("No phone number saved.", "error");
    window.location.href = `tel:${escapeHTML(phone)}`;
};

window.cmdQuickRoute = (id, e) => {
    e.stopPropagation(); triggerHaptic();
    const c = db.customers.find(x => x.id === id); if(!c) return;
    const mapQuery = encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${mapQuery}`, '_blank');
};

window.cmdToggleSkip = (id) => {
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); c.skipped = !c.skipped; if(c.skipped) c.cleaned = false; 
    saveData(); renderAllSafe(); closeBriefing();
    showToast(c.skipped ? "Job Skipped ⏭️" : "Skip Removed", "normal");
};

window.cmdReceiptWA = (phone, amt, date) => {
    triggerHaptic();
    if(!phone || phone === 'undefined') return showToast("No phone number saved.", "error");
    let p = phone.replace(/\D/g, ''); if(p.startsWith('0')) p = '44' + p.substring(1);
    let msg = `Receipt from Hydro Pro 💧\n\nReceived: £${parseFloat(amt).toFixed(2)}\nDate: ${date}\n\nThank you for your business!`;
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.cmdReceiptSMS = (phone, amt, date) => {
    triggerHaptic();
    if(!phone || phone === 'undefined') return showToast("No phone number saved.", "error");
    let p = phone.replace(/\D/g, ''); 
    let msg = `Receipt from Hydro Pro 💧\n\nReceived: £${parseFloat(amt).toFixed(2)}\nDate: ${date}\n\nThank you for your business!`;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const separator = isIOS ? '&' : '?';
    window.open(`sms:${p}${separator}body=${encodeURIComponent(msg)}`, '_blank');
};

window.renderWeek = () => { 
    const list = document.getElementById('WEE-list-container'); if(!list) return; list.innerHTML = '';
    
    let customersToday = db.customers
        .filter(c => c.week == curWeek && c.day == workingDay)
        .sort((a, b) => {
            if (a.skipped === b.skipped) return (a.order || 0) - (b.order || 0);
            return a.skipped ? 1 : -1;
        });

    const progressDash = document.getElementById('WEE-progress-dashboard');
    if(customersToday.length === 0) {
        progressDash.innerHTML = '';
        list.innerHTML = `<div class="empty-state"><span class="empty-icon">🏖️</span><div class="empty-text">Zero Jobs Today</div><div class="empty-sub">Enjoy the day off, or add a job!</div><button class="ADM-save-btn" style="width: 220px; font-size: 14px; height: 50px!important; margin-top: 20px; box-shadow: 0 5px 15px rgba(0,122,255,0.2);" onclick="openAddCustomerModal()">➕ ADD CUSTOMER</button></div>`;
        return;
    }

    let completedCount = customersToday.filter(c => c.cleaned || c.skipped).length;
    let totalCount = customersToday.length;
    let pct = totalCount === 0 ? 0 : (completedCount / totalCount) * 100;
    let dailyValue = customersToday.filter(c => c.cleaned).reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0);

    progressDash.innerHTML = `<div class="WEE-progress-wrap"><div class="WEE-progress-fill" style="width: ${pct}%;"></div></div><div class="WEE-progress-text">${completedCount} of ${totalCount} Done • £${dailyValue.toFixed(2)} Cleaned Today</div>`;

    customersToday.forEach(c => {
        const arrData = window.getArrearsData(c);
        const cleanBadge = c.cleaned ? `<span class="CST-badge badge-clean">✅ CLEANED</span>` : '';
        const arrearsBadge = arrData.isOwed ? `<span class="CST-badge badge-unpaid">❌ OWES £${arrData.total.toFixed(2)}</span>` : `<span class="CST-badge badge-paid">✅ PAID</span>`;
        const skipBadge = c.skipped ? `<span class="CST-badge badge-unpaid" style="background: rgba(255, 149, 0, 0.15); color: #cc7700;">⏭️ SKIPPED</span>` : '';
        
        const wrap = document.createElement('div'); wrap.className = 'swipe-wrapper'; wrap.dataset.id = c.id;
        const bg = document.createElement('div'); bg.className = 'swipe-bg'; bg.innerHTML = `<div class="action-left">✅</div><div class="action-right">💰</div>`;
        const fg = document.createElement('div'); fg.className = `swipe-fg CST-card-item ${c.skipped ? 'skipped-card' : ''}`;
        
        fg.innerHTML = `
            <div style="flex:1;">
                <strong style="font-size:20px; display:block;">${escapeHTML(c.name)}</strong>
                <small style="color:var(--accent); font-weight:800; display:block;">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</small>
                <div class="CST-card-badges">${cleanBadge} ${arrearsBadge} ${skipBadge}</div>
            </div>
            <div style="display:flex; align-items:center; gap: 8px;">
                <span class="price-text" style="font-weight:950; font-size:22px;">£${(parseFloat(c.price)||0).toFixed(2)}</span>
                <button class="quick-action-btn" onclick="cmdQuickRoute('${c.id}', event)">📍</button>
                <button class="quick-action-btn" onclick="cmdQuickCall('${c.phone}', event)">📞</button>
                <div class="drag-handle">≡</div>
            </div>`;
        
        wrap.appendChild(bg); wrap.appendChild(fg); list.appendChild(wrap);
        attachSwipeGestures(wrap, fg, c.id); attachDragDrop(wrap, list);
    });
};

window.routeMyDay = () => {
    triggerHaptic();
    let todaysJobs = db.customers.filter(c => c.week == curWeek && c.day == workingDay && !c.skipped).sort((a, b) => (a.order || 0) - (b.order || 0));
    if(todaysJobs.length === 0) return showToast("No active jobs to route today!", "error");
    if(todaysJobs.length > 10) showToast("Routing limited to first 10 stops.", "normal");
    
    let stops = todaysJobs.slice(0, 10).map(c => encodeURIComponent(`${c.houseNum} ${c.street}, ${c.postcode || ''}`));
    let destination = stops.pop(); let waypoints = stops.join('|'); 
    
    let url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    if(waypoints) url += `&waypoints=${waypoints}`;
    window.open(url, '_blank');
};

window.openTomorrowModal = () => {
    triggerHaptic();
    let nextIdx = (daysOfWeek.indexOf(workingDay) + 1) % 7;
    let nextDay = daysOfWeek[nextIdx];
    let nextWeek = curWeek;
    
    if (nextDay === 'Mon' && workingDay === 'Sun') { nextWeek = curWeek < 5 ? curWeek + 1 : 1; }
    
    let tomorrowJobs = db.customers.filter(c => c.week == nextWeek && c.day == nextDay && !c.skipped).sort((a, b) => (a.order || 0) - (b.order || 0));
    const list = document.getElementById('tomorrow-list');
    document.getElementById('tomorrow-title-sub').innerText = `Week ${nextWeek} • ${nextDay}`;
    
    if(tomorrowJobs.length === 0) {
        list.innerHTML = `<div class="empty-state" style="padding: 20px;"><div class="empty-text" style="font-size:16px;">No jobs scheduled for tomorrow.</div></div>`;
    } else {
        list.innerHTML = tomorrowJobs.map(c => `
            <div class="CMD-detail-row" style="flex-direction:column; align-items:flex-start; gap:10px; padding:15px; background:var(--ios-grey); border-radius:20px; margin-bottom:10px;">
                <div><strong style="font-size:18px;">${escapeHTML(c.name)}</strong><br><small style="opacity: 0.6; font-weight: 800;">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</small></div>
                <div style="display:flex; gap:10px; width:100%;">
                    <button class="ADM-save-btn" style="height:40px!important; margin:0; font-size:12px; background:rgba(52, 199, 89, 0.15); color:var(--success); box-shadow:none;" onclick="cmdPreRouteWA('${c.id}')">💬 WA REMINDER</button>
                    <button class="ADM-save-btn" style="height:40px!important; margin:0; font-size:12px; background:rgba(0, 122, 255, 0.15); color:var(--accent); box-shadow:none;" onclick="cmdPreRouteSMS('${c.id}')">📱 SMS REMINDER</button>
                </div>
            </div>
        `).join('');
    }
    document.getElementById('tomorrowModal').classList.remove('hidden');
};

window.closeTomorrowModal = () => { document.getElementById('tomorrowModal').classList.add('hidden'); };

window.cmdPreRouteWA = (id) => {
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); if(!c.phone) return showToast("No phone number saved.", "error");
    let phone = c.phone.replace(/\D/g, ''); if(phone.startsWith('0')) phone = '44' + phone.substring(1); 
    let msg = `Hi ${c.name}, Hydro Pro here! We are due to clean your windows tomorrow. Please remember to leave the side gate unlocked. See you then! 💧`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.cmdPreRouteSMS = (id) => {
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); if(!c.phone) return showToast("No phone number saved.", "error");
    let phone = c.phone.replace(/\D/g, '');
    let msg = `Hi ${c.name}, Hydro Pro here! We are due to clean your windows tomorrow. Please remember to leave the side gate unlocked. See you then! 💧`;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const separator = isIOS ? '&' : '?';
    window.open(`sms:${phone}${separator}body=${encodeURIComponent(msg)}`, '_blank');
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

const generateHistoryHtml = (id, phone) => { 
    const history = db.history.filter(h => h.custId === id).slice(-3).reverse();
    if (history.length === 0) return `<div class="empty-state" style="padding: 10px;"><div class="empty-text" style="font-size:14px;">No Payment History</div></div>`;
    
    return history.map(h => `
        <div class="CMD-history-row" style="align-items:center;">
            <div><span>${escapeHTML(h.date)}</span> <span style="opacity:0.5; font-size:10px; margin-left:5px;">${h.method === 'Bank' ? '🏦' : '💵'}</span></div>
            <div style="display:flex; gap:10px; align-items:center;">
                <span style="color:var(--success);">£${parseFloat(h.amt).toFixed(2)}</span>
                <button class="quick-action-btn" style="width:28px; height:28px; font-size:12px; margin-left:0;" onclick="cmdReceiptWA('${escapeHTML(phone)}', '${h.amt}', '${escapeHTML(h.date)}')">🧾</button>
            </div>
        </div>`).join('');
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
        <div class="CMD-header">
            <h2>${escapeHTML(c.name)}</h2>
            <button class="CMD-header-edit-btn" onclick="openAddCustomerModal('${c.id}')">✏️</button>
            <div class="CMD-header-sub">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)}</div>
        </div>
        ${notesHtml}
        ${generateArrearsHtml(arrData, c.id, 'job')}
        <div class="CMD-action-grid">
            <button class="CMD-action-btn clean" onclick="cmdToggleClean('${c.id}')"><span style="font-size:24px;">🧼</span> <br>${c.cleaned ? 'UNDO CLEAN' : 'MARK CLEAN'}</button>
            <button class="CMD-action-btn pay" onclick="cmdSettlePaid('${c.id}', 'job')"><span style="font-size:24px;">💰</span> <br>COLLECT £</button>
            <button class="CMD-action-btn route" onclick="window.open('${navUrl}', '_blank')"><span style="font-size:24px;">📍</span> <br>NAVIGATE</button>
            <button class="CMD-action-btn call" onclick="window.location.href='tel:${escapeHTML(c.phone)}'"><span style="font-size:24px;">📞</span> <br>CALL</button>
            <button class="CMD-action-btn skip" onclick="cmdToggleSkip('${c.id}')"><span style="font-size:24px;">⏭️</span> <br>${c.skipped ? 'UNSKIP' : 'SKIP JOB'}</button>
            <button class="CMD-action-btn whatsapp" onclick="cmdWhatsApp('${c.id}')"><span style="font-size:24px;">💬</span> <br>WA REC</button>
        </div>
        <h3 class="CMD-history-hdr">Rolling History (Tap 🧾 for receipt)</h3><div class="CMD-history-box">${generateHistoryHtml(c.id, c.phone)}</div>
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
        <div class="CMD-header">
            <h2>${escapeHTML(c.name)}</h2>
            <button class="CMD-header-edit-btn" onclick="openAddCustomerModal('${c.id}')">✏️</button>
            <div class="CMD-header-sub">${escapeHTML(c.houseNum)} ${escapeHTML(c.street)} <br>${escapeHTML(c.postcode || '')}</div>
        </div>
        <div class="CMD-details-box">
            <div class="CMD-detail-row"><span>📞 Phone</span><span>${escapeHTML(c.phone) || 'N/A'}</span></div>
            <div class="CMD-detail-row"><span>💰 Price</span><span>£${parseFloat(c.price).toFixed(2)}</span></div>
            <div class="CMD-detail-row"><span>📅 Week</span><span>Week ${escapeHTML(c.week)}</span></div>
            <div class="CMD-detail-row"><span>📆 Day</span><span>${escapeHTML(c.day)}</span></div>
        </div>
        ${notesHtml}
        ${generateArrearsHtml(arrData, c.id, 'cust')}
        <h3 class="CMD-history-hdr">Rolling History (Tap 🧾 for receipt)</h3><div class="CMD-history-box">${generateHistoryHtml(c.id, c.phone)}</div>
    `;
    document.getElementById('briefingModal').classList.remove('hidden');
};

window.closeBriefing = () => document.getElementById('briefingModal').classList.add('hidden');

window.cmdToggleClean = (id) => { 
    triggerHaptic();
    const c = db.customers.find(x => x.id === id); 
    c.cleaned = !c.cleaned; 
    if(c.cleaned) c.skipped = false; 
    window.saveData(); window.renderAllSafe(); 
    document.getElementById('briefingModal').classList.add('hidden');
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
    
    setPayMethod('Cash');

    document.getElementById('briefingModal').classList.add('hidden');
    document.getElementById('paymentModal').classList.remove('hidden');
};

window.closePaymentModal = () => { document.getElementById('paymentModal').classList.add('hidden'); currentPayId = null; };

window.setPayMethod = (method) => {
    triggerHaptic(); currentPayMethod = method;
    document.getElementById('btnPayCash').classList.toggle('active', method === 'Cash');
    document.getElementById('btnPayBank').classList.toggle('active', method === 'Bank');
};

window.processPayment = (type) => {
    triggerHaptic();
    if(!currentPayId) return;
    const c = db.customers.find(x => x.id === currentPayId);

    let amtPaid = 0;
    if(type === 'full') { amtPaid = currentPayTotal; } else { amtPaid = parseFloat(document.getElementById('pay-custom-amt').value); }

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
    
    if(!db.history) db.history = []; 
    db.history.push({ custId: currentPayId, amt: amtPaid, date: new Date().toLocaleDateString('en-GB'), method: currentPayMethod }); 
    
    window.saveData(); window.renderAllSafe(); closePaymentModal();
    showToast(`£${amtPaid.toFixed(2)} logged to ${currentPayMethod} 💰`, "success");
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
        if(typeof chart === 'undefined' || !chart.ctx) return;
        const ctx = chart.ctx; ctx.save();
        ctx.shadowColor = document.body.classList.contains('dark-mode') ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = 15; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 10;
    },
    afterDatasetDraw: (chart, args, options) => { if(typeof chart !== 'undefined' && chart.ctx) chart.ctx.restore(); }
};

window.renderFinances = () => {
    const dash = document.getElementById('FIN-dashboard'); 
    const splitDash = document.getElementById('FIN-split-dashboard');
    const ledger = document.getElementById('FIN-ledger'); 
    if(!dash || !ledger || !splitDash) return;
    
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

    let cashTotal = 0; let bankTotal = 0;
    let currentMonthStr = new Date().toLocaleDateString('en-GB').substring(3);
    db.history.forEach(h => {
        if (h.date && h.date.includes(currentMonthStr)) {
            if (h.method === 'Bank') bankTotal += parseFloat(h.amt);
            else cashTotal += parseFloat(h.amt); 
        }
    });

    let arrearsSection = ''; 
    if (totalArrears > 0) { arrearsSection = `<div class="FIN-arrears-card"><div style="font-size:20px; margin-bottom:15px;">⚠️ OUTSTANDING: £${totalArrears.toFixed(2)}</div><div style="text-align:left; background:rgba(0,0,0,0.15); padding:15px; border-radius:20px; max-height:150px; overflow-y:auto;">${arrearsListHtml}</div></div>`; }
    
    let htmlBuilder = `<div class="FIN-hero-iron"><small style="opacity:0.5; font-weight:900;">NET PROFIT</small><div>£${(income - spend).toFixed(2)}</div></div>`;
    htmlBuilder += arrearsSection;
    htmlBuilder += `<div style="padding: 0 25px; margin-bottom: 5px; font-weight: 950; font-size: 14px; color: var(--accent); display: flex; justify-content: space-between;"><span>COLLECTION PROGRESS</span><span>${Math.round(progressPct)}%</span></div>`;
    htmlBuilder += `<div class="FIN-progress-wrap"><div class="FIN-progress-fill" style="width: ${progressPct}%;"></div></div>`;
    htmlBuilder += `<div class="FIN-bubble-row"><div class="FIN-bubble income"><div class="bubble-icon">📈</div><div class="bubble-info"><small>INCOME</small><strong>£${income.toFixed(2)}</strong></div></div><div class="FIN-bubble spent"><div class="bubble-icon">📉</div><div class="bubble-info"><small>SPENT</small><strong>£${spend.toFixed(2)}</strong></div></div></div>`;
    
    dash.innerHTML = htmlBuilder;

    splitDash.innerHTML = `
        <div class="FIN-bubble-row" style="margin-top:-10px;">
            <div class="FIN-bubble" style="padding:10px;">
                <div class="bubble-icon" style="width:30px;height:30px;font-size:16px;">💵</div>
                <div class="bubble-info"><small>CASH IN HAND</small><strong style="font-size:14px;">£${cashTotal.toFixed(2)}</strong></div>
            </div>
            <div class="FIN-bubble" style="padding:10px;">
                <div class="bubble-icon" style="width:30px;height:30px;font-size:16px;">🏦</div>
                <div class="bubble-info"><small>BANKED</small><strong style="font-size:14px;">£${bankTotal.toFixed(2)}</strong></div>
            </div>
        </div>
    `;
    
    const ctx = document.getElementById('financeChartCanvas');
    if (ctx && typeof Chart !== 'undefined') {
        if (financeChartInstance) financeChartInstance.destroy(); 
        
        let labels = [`Collected: £${income.toFixed(2)}`, `Debt: £${totalArrears.toFixed(2)}`, `Forecasted: £${forecasted.toFixed(2)}`]; 
        let chartData = [income, totalArrears, forecasted]; 
        let colors = ['#34C759', '#ff453a', '#007aff'];
        let isDarkMode = document.body.classList.contains('dark-mode');
        
        if (income > 0 || totalArrears > 0 || forecasted > 0) {
            financeChartInstance = new Chart(ctx, { 
                type: 'doughnut', plugins: [arc3DPlugin], 
                data: { labels: labels, datasets: [{ data: chartData, backgroundColor: colors, borderWidth: 4, borderColor: isDarkMode ? '#1c1c1e' : '#ffffff', borderRadius: 15, hoverOffset: 6, spacing: 5 }] }, 
                options: { 
                    responsive: true, maintainAspectRatio: false, cutout: '75%', layout: { padding: 10 },
                    plugins: { 
                        legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true, pointStyle: 'circle', color: isDarkMode ? '#fff' : '#000', font: { family: '"Plus Jakarta Sans", sans-serif', weight: 'bold', size: 13 } } },
                        tooltip: { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)', titleColor: isDarkMode ? '#000' : '#fff', bodyColor: isDarkMode ? '#000' : '#fff', padding: 12, cornerRadius: 12, displayColors: false, callbacks: { label: function(context) { return ' ' + context.label; } } }
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
            tableRows += `<tr><td style="width: 40px; font-size: 24px; text-align: center; padding-left: 0;">${catIcon}</td><td><div style="display:flex; flex-direction:column;"><span style="color:var(--text);">${escapeHTML(item.desc)}</span><small style="opacity:0.5; font-size:11px;">${escapeHTML(item.date)}</small></div></td><td style="text-align: right; color: var(--danger); padding-right: 0;">-£${parseFloat(item.amt).toFixed(2)}</td></tr>`; 
        }); 
        statementHtml = `<div class="FIN-ledger-card"><div class="FIN-ledger-wrapper"><table class="FIN-ledger-table"><thead><tr><th style="padding-left: 0;">Cat</th><th>Details</th><th style="text-align: right; padding-right: 0;">Amt</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="FIN-ledger-total"><span>TOTAL EXPENSES</span><span>-£${spend.toFixed(2)}</span></div></div>`; 
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
                
                const hwIcon = document.getElementById('hw-icon');
                const hwTemp = document.getElementById('hw-temp');
                const hwDesc = document.getElementById('hw-desc');
                if(hwIcon) hwIcon.innerText = currentIcon;
                if(hwTemp) hwTemp.innerText = temp;
                if(hwDesc) hwDesc.innerText = currentDesc;

                const fRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${W_API_KEY}&units=metric`);
                const fData = await fRes.json();
                
                const dailyData = fData.list.filter(item => item.dt_txt.includes('12:00:00')).slice(0, 5);
                
                let forecastHtml = dailyData.map(day => {
                    const dateObj = new Date(day.dt * 1000);
                    const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
                    return `<div class="WTH-card"><span class="WTH-day">${dayName}</span><span class="WTH-icon">${getIcon(day.weather[0].icon)}</span><span class="WTH-temps">${Math.round(day.main.temp)}°C</span></div>`;
                }).join('');

                if(wDash) {
                    wDash.innerHTML = `
                        <div class="WTH-hero"><div class="WTH-icon" style="font-size: 50px;">${currentIcon}</div><div class="WTH-hero-temp">${temp}</div><div class="WTH-hero-desc">${currentDesc}</div><div style="font-size: 14px; font-weight: 900; color: var(--text); opacity: 0.5; margin-top: 15px; letter-spacing: 1px; text-transform: uppercase;">📍 ${escapeHTML(data.name)}</div></div>
                        <h3 class="ADM-hdr" style="margin: 25px 0 10px;">5-Day Forecast</h3>${forecastHtml}`;
                }
            } catch (e) { 
                if (wDash) wDash.innerHTML = `<div class="empty-state"><span class="empty-icon">📡</span><div class="empty-text">Weather Offline</div><div class="empty-sub">Check your connection to pull the radar.</div></div>`;
            } 
        });
    }
}
