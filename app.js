// 1. Theme Engine Functions
function applyTheme(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    
    const meta = document.getElementById('theme-meta'); 
    if(meta) {
        meta.content = isDark ? "#000000" : "#f2f2f7";
    }
    
    const btnLight = document.getElementById('btnLight'); 
    const btnDark = document.getElementById('btnDark');
    
    if (btnLight && btnDark) {
        if (isDark) { 
            btnLight.classList.remove('active'); 
            btnDark.classList.add('active'); 
        } else { 
            btnLight.classList.add('active'); 
            btnDark.classList.remove('active'); 
        }
    }
}

window.setThemeMode = (isDark) => { 
    applyTheme(isDark); 
    localStorage.setItem('MyApp_Theme', isDark); 
};

// 2. Main App Logic
document.addEventListener("DOMContentLoaded", () => {
    
    // Check local storage for theme
    const savedTheme = localStorage.getItem('MyApp_Theme') === 'true';
    applyTheme(savedTheme);

    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log("Service Worker Registered"))
            .catch(err => console.log("SW Registration Failed", err));
    }

    // PWA Sync Logic
    const syncBtn = document.getElementById('sync-updates-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            syncBtn.innerText = "Syncing...";
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(registrations => {
                    for (let registration of registrations) registration.update();
                });
            }
            caches.keys().then(names => { for (let name of names) caches.delete(name); });
            setTimeout(() => { window.location.reload(true); }, 1000);
        });
    }

    // State & Navigation
    let financialItems = JSON.parse(localStorage.getItem("financialItems")) || [];
    const homeContent = document.getElementById("home-content");
    const addItemForm = document.getElementById("add-item-form");
    const typeRadios = document.querySelectorAll('input[name="itemType"]');
    const views = ['cards', 'bills', 'home', 'loans', 'admin'];

    // Dynamic Form Fields
    typeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const val = e.target.value;
            document.getElementById('account-only-fields').style.display = (val === 'account') ? 'block' : 'none';
            document.getElementById('bill-only-fields').style.display = (val === 'bill') ? 'block' : 'none';
            document.getElementById('itemAmount').placeholder = (val === 'bill') ? "Bill Amount (£)" : "Balance (£)";
        });
    });

    // View Switching
    views.forEach(view => {
        const navBtn = document.getElementById(`nav-${view}`);
        if (navBtn) navBtn.addEventListener("click", () => switchView(view));
    });

    function switchView(targetView) {
        views.forEach(view => {
            document.getElementById(`view-${view}`).classList.toggle("active-view", view === targetView);
            document.getElementById(`nav-${view}`).classList.toggle("active", view === targetView);
        });
        if (targetView === 'home') renderHome();
    }

    // Render Home Screen
    function renderHome() {
        if (!homeContent) return;
        homeContent.innerHTML = ""; 
        const categories = [
            { id: 'account', title: 'Bank Accounts', icon: '🏦' },
            { id: 'card', title: 'Credit Cards', icon: '💳' },
            { id: 'loan', title: 'Loans', icon: '💰' },
            { id: 'bill', title: 'Upcoming Bills', icon: '📑' }
        ];

        categories.forEach(cat => {
            const items = financialItems.filter(i => i.type === cat.id);
            if (items.length === 0) return;
            const section = document.createElement('div');
            section.className = 'home-section';
            section.innerHTML = `<div class="section-title">${cat.icon} ${cat.title}</div>`;
            items.forEach(item => {
                const balanceDisplay = `£${Math.abs(item.balance).toFixed(2)}`;
                const tile = document.createElement('div');
                tile.className = 'item-tile';
                tile.innerHTML = `
                    <div class="item-info">
                        <div class="name">${item.name}</div>
                        <div class="sub">${item.type === 'bill' ? 'Due Day ' + item.dueDate : 'Balance Today'}</div>
                    </div>
                    <div class="item-amount ${item.balance < 0 ? 'text-red' : ''}">${item.balance < 0 ? '-' : ''}${balanceDisplay}</div>
                `;
                section.appendChild(tile);
            });
            homeContent.appendChild(section);
        });
        if (financialItems.length === 0) homeContent.innerHTML = "<p class='placeholder-text'>No data found.</p>";
    }

    // Submit New Item
    if (addItemForm) {
        addItemForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const type = document.querySelector('input[name="itemType"]:checked').value;
            financialItems.push({
                id: Date.now().toString(),
                type: type,
                name: document.getElementById("itemName").value,
                balance: parseFloat(document.getElementById("itemAmount").value),
                odLimit: type === 'account' ? (parseFloat(document.getElementById("odLimit").value) || 0) : null,
                dueDate: type === 'bill' ? document.getElementById("billDay").value : null
            });
            localStorage.setItem("financialItems", JSON.stringify(financialItems));
            addItemForm.reset();
            switchView('home');
        });
    }
    
    // Initial Render
    renderHome();
});
