const GITHUB_OWNER = 'playtv02';
const GITHUB_REPO = 'Customer-directory';
const FILE_PATH = 'data.json';

let records = [];
let fileSha = null;
let deleteTargetId = null;

// Helpers
const encodeBase64 = str => btoa(unescape(encodeURIComponent(str)));
const decodeBase64 = str => decodeURIComponent(escape(atob(str)));

function getRecordTotals(r) {
    if (r.itemList && r.itemList.length > 0) {
        let bill = 0, qty = 0;
        r.itemList.forEach(i => {
            bill += (i.qty * i.price);
            qty += i.qty;
        });
        return { bill, qty };
    }
    return { bill: (r.items || 1) * (Number(r.price) || 0), qty: r.items || 1 };
}

function getLocalTodayDate() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().split('T')[0];
}

document.addEventListener('DOMContentLoaded', () => {
    const todayStr = getLocalTodayDate();
    const dateInput = document.getElementById('cust-date');
    if (dateInput) dateInput.value = todayStr;

    const bannerYear = document.getElementById('banner-year');
    if (bannerYear) bannerYear.textContent = new Date().getFullYear();

    addBillItemRow();
    checkBankHoliday();
    updateDashboard();
    setupFiltersAndSort();
    setupViewToggles();

    const form = document.getElementById('customerForm');
    if (form) form.addEventListener('submit', handleFormSubmit);

    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', handleSearch);

    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) statusFilter.addEventListener('change', filterAndRenderDirectory);

    const tierFilter = document.getElementById('tierFilter');
    if (tierFilter) tierFilter.addEventListener('change', filterAndRenderDirectory);

    const sortBy = document.getElementById('sortBy');
    if (sortBy) sortBy.addEventListener('change', filterAndRenderDirectory);

    const addCustBtn = document.getElementById('addCustomerBtn');
    if (addCustBtn) addCustBtn.addEventListener('click', () => openCustomerModal());

    const closeBtn = document.getElementById('closeModalBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeCustomerModal);

    const cancelBtn = document.getElementById('cancelModalBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeCustomerModal);

    const overlay = document.querySelector('.modal-overlay');
    if (overlay) overlay.addEventListener('click', closeCustomerModal);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportToCSV);

    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.dataset.tab;
            switchTab(tab);
        });
    });

    loadRecords();
});

function checkBankHoliday() {
    const today = getLocalTodayDate();
    const banner = document.getElementById('holiday-banner');
    if (!banner) return;
    if (typeof BANK_HOLIDAYS !== 'undefined' && BANK_HOLIDAYS[today]) {
        banner.style.display = 'block';
        banner.textContent = `📢 Bank Holiday Notice: ${BANK_HOLIDAYS[today]}`;
    } else {
        banner.style.display = 'none';
    }
}

function updateDashboard() {
    const totalCount = records.length;
    const activeCount = records.filter(r => (r.status || 'Active') === 'Active').length;
    const vipCount = records.filter(r => (r.tier || 'Standard') === 'VIP').length;
    
    let totalSpent = 0;
    records.forEach(r => {
        const totals = getRecordTotals(r);
        totalSpent += totals.bill;
    });

    const totalElem = document.getElementById('totalCustomersCount');
    const activeElem = document.getElementById('activeCustomersCount');
    const vipElem = document.getElementById('vipCustomersCount');
    const revenueElem = document.getElementById('totalRevenueCount');

    if (totalElem) totalElem.textContent = totalCount;
    if (activeElem) activeElem.textContent = activeCount;
    if (vipElem) vipElem.textContent = vipCount;
    if (revenueElem) revenueElem.textContent = `$${totalSpent.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    renderAnalyticsCharts();
}

function filterAndRenderDirectory() {
    const searchVal = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const statusVal = document.getElementById('statusFilter')?.value || 'all';
    const tierVal = document.getElementById('tierFilter')?.value || 'all';
    const sortVal = document.getElementById('sortBy')?.value || 'name';

    let filtered = records.filter(r => {
        const nameMatch = (r.name || '').toLowerCase().includes(searchVal);
        const emailMatch = (r.email || '').toLowerCase().includes(searchVal);
        const companyMatch = (r.company || '').toLowerCase().includes(searchVal);
        const matchesSearch = nameMatch || emailMatch || companyMatch;

        const matchesStatus = statusVal === 'all' || (r.status || 'Active') === statusVal;
        const matchesTier = tierVal === 'all' || (r.tier || 'Standard') === tierVal;

        return matchesSearch && matchesStatus && matchesTier;
    });

    filtered.sort((a, b) => {
        if (sortVal === 'name') return (a.name || '').localeCompare(b.name || '');
        if (sortVal === 'company') return (a.company || '').localeCompare(b.company || '');
        if (sortVal === 'spent') return getRecordTotals(b).bill - getRecordTotals(a).bill;
        if (sortVal === 'date') return new Date(b.date || 0) - new Date(a.date || 0);
        return 0;
    });

    renderDirectoryView(filtered);
}

function handleSearch() {
    filterAndRenderDirectory();
}

function renderDirectoryView(data) {
    const container = document.getElementById('directoryView');
    if (!container) return;

    const isGrid = container.classList.contains('view-grid');

    if (data.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🔍</span>
                <h3>No Customers Found</h3>
                <p>Try adjusting your search query or filters.</p>
            </div>
        `;
        return;
    }

    if (isGrid) {
        container.innerHTML = `<div class="grid-view">${data.map(r => createCardHTML(r)).join('')}</div>`;
    } else {
        container.innerHTML = `
            <table class="directory-table">
                <thead>
                    <tr>
                        <th>Customer</th>
                        <th>Company</th>
                        <th>Status</th>
                        <th>Tier</th>
                        <th>Total Spent</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map(r => createTableRowHTML(r)).join('')}
                </tbody>
            </table>
        `;
    }
}

function createTableRowHTML(r) {
    const totals = getRecordTotals(r);
    const initials = getInitials(r.name || 'Unknown');
    const statusClass = (r.status || 'Active').toLowerCase();
    const tierClass = (r.tier || 'Standard').toLowerCase();

    return `
        <tr>
            <td>
                <div class="customer-cell">
                    <div class="avatar">${initials}</div>
                    <div class="customer-meta">
                        <span class="cust-name">${escapeHTML(r.name || 'N/A')}</span>
                        <span class="cust-email">${escapeHTML(r.email || 'N/A')}</span>
                    </div>
                </div>
            </td>
            <td>${escapeHTML(r.company || 'N/A')}</td>
            <td><span class="badge badge-status badge-${statusClass}">${escapeHTML(r.status || 'Active')}</span></td>
            <td><span class="badge badge-tier badge-${tierClass}">${escapeHTML(r.tier || 'Standard')}</span></td>
            <td>$${totals.bill.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            <td>
                <div class="table-actions">
                    <button class="icon-btn" onclick="openCustomerModal('${r.id}')" title="Edit">✏️</button>
                    <button class="icon-btn delete-btn" onclick="confirmDelete('${r.id}')" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>
    `;
}

function createCardHTML(r) {
    const totals = getRecordTotals(r);
    const initials = getInitials(r.name || 'Unknown');
    const statusClass = (r.status || 'Active').toLowerCase();
    const tierClass = (r.tier || 'Standard').toLowerCase();

    return `
        <div class="customer-card">
            <div class="card-header">
                <div class="avatar lg">${initials}</div>
                <div class="card-badges">
                    <span class="badge badge-status badge-${statusClass}">${escapeHTML(r.status || 'Active')}</span>
                    <span class="badge badge-tier badge-${tierClass}">${escapeHTML(r.tier || 'Standard')}</span>
                </div>
            </div>
            <div class="card-body">
                <h3>${escapeHTML(r.name || 'N/A')}</h3>
                <p class="card-email">${escapeHTML(r.email || 'N/A')}</p>
                <div class="card-details">
                    <div class="detail-item">
                        <span class="detail-label">Company</span>
                        <span class="detail-val">${escapeHTML(r.company || 'N/A')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Phone</span>
                        <span class="detail-val">${escapeHTML(r.phone || 'N/A')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Total Spent</span>
                        <span class="detail-val highlight">$${totals.bill.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                    </div>
                </div>
            </div>
            <div class="card-footer">
                <button class="btn btn-outline btn-sm" onclick="openCustomerModal('${r.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="confirmDelete('${r.id}')">Delete</button>
            </div>
        </div>
    `;
}

function setupViewToggles() {
    const btns = document.querySelectorAll('.toggle-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            const container = document.getElementById('directoryView');
            if (container) {
                container.className = `directory-container view-${view}`;
                filterAndRenderDirectory();
            }
        });
    });
}

function switchTab(tabName) {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        if (item.dataset.tab === tabName) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    tabContents.forEach(content => {
        if (content.id === `${tabName}Tab`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
}

function openCustomerModal(id = null) {
    const modal = document.getElementById('customerModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('customerForm');
    if (!modal || !form) return;

    form.reset();

    if (id) {
        const record = records.find(r => String(r.id) === String(id));
        if (record) {
            title.textContent = 'Edit Customer';
            document.getElementById('customerId').value = record.id;
            document.getElementById('custName').value = record.name || '';
            document.getElementById('custEmail').value = record.email || '';
            document.getElementById('custPhone').value = record.phone || '';
            document.getElementById('custCompany').value = record.company || '';
            document.getElementById('custStatus').value = record.status || 'Active';
            document.getElementById('custTier').value = record.tier || 'Standard';
            
            const totals = getRecordTotals(record);
            document.getElementById('custSpent').value = totals.bill;
        }
    } else {
        title.textContent = 'Add New Customer';
        document.getElementById('customerId').value = '';
    }

    modal.classList.add('active');
}

function closeCustomerModal() {
    const modal = document.getElementById('customerModal');
    if (modal) modal.classList.remove('active');
}

function handleFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('customerId').value;
    const name = document.getElementById('custName').value.trim();
    const email = document.getElementById('custEmail').value.trim();
    const phone = document.getElementById('custPhone').value.trim();
    const company = document.getElementById('custCompany').value.trim();
    const status = document.getElementById('custStatus').value;
    const tier = document.getElementById('custTier').value;
    const spent = parseFloat(document.getElementById('custSpent').value) || 0;

    if (!name || !email) {
        alert('Please fill in required fields.');
        return;
    }

    if (id) {
        const idx = records.findIndex(r => String(r.id) === String(id));
        if (idx !== -1) {
            records[idx] = {
                ...records[idx],
                name, email, phone, company, status, tier,
                price: spent, items: 1, itemList: []
            };
        }
    } else {
        const newRecord = {
            id: 'CUST-' + Date.now().toString(36).toUpperCase(),
            name, email, phone, company, status, tier,
            price: spent, items: 1, itemList: [],
            date: getLocalTodayDate()
        };
        records.unshift(newRecord);
    }

    closeCustomerModal();
    updateDashboard();
    filterAndRenderDirectory();
    saveRecords();
}

function confirmDelete(id) {
    if (confirm('Are you sure you want to delete this customer?')) {
        records = records.filter(r => String(r.id) !== String(id));
        updateDashboard();
        filterAndRenderDirectory();
        saveRecords();
    }
}

function exportToCSV() {
    if (records.length === 0) {
        alert('No data to export.');
        return;
    }

    const headers = ['ID', 'Name', 'Email', 'Phone', 'Company', 'Status', 'Tier', 'Total Spent', 'Date'];
    const rows = records.map(r => [
        r.id || '',
        `"${(r.name || '').replace(/"/g, '""')}"`,
        `"${(r.email || '').replace(/"/g, '""')}"`,
        `"${(r.phone || '').replace(/"/g, '""')}"`,
        `"${(r.company || '').replace(/"/g, '""')}"`,
        r.status || 'Active',
        r.tier || 'Standard',
        getRecordTotals(r).bill.toFixed(2),
        r.date || ''
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `customers_export_${getLocalTodayDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function renderAnalyticsCharts() {
    const tierChart = document.getElementById('tierChart');
    const statusChart = document.getElementById('statusChart');

    if (tierChart) {
        const tiers = {};
        records.forEach(r => {
            const t = r.tier || 'Standard';
            tiers[t] = (tiers[t] || 0) + 1;
        });
        tierChart.innerHTML = Object.entries(tiers).map(([tier, count]) => `
            <div class="chart-bar-row">
                <span class="bar-label">${tier}</span>
                <div class="bar-container">
                    <div class="bar-fill" style="width: ${(count / (records.length || 1)) * 100}%"></div>
                </div>
                <span class="bar-val">${count}</span>
            </div>
        `).join('');
    }

    if (statusChart) {
        const statuses = {};
        records.forEach(r => {
            const s = r.status || 'Active';
            statuses[s] = (statuses[s] || 0) + 1;
        });
        statusChart.innerHTML = Object.entries(statuses).map(([status, count]) => `
            <div class="chart-bar-row">
                <span class="bar-label">${status}</span>
                <div class="bar-container">
                    <div class="bar-fill status-${status.toLowerCase()}" style="width: ${(count / (records.length || 1)) * 100}%"></div>
                </div>
                <span class="bar-val">${count}</span>
            </div>
        `).join('');
    }
}

function loadRecords() {
    // Attempt load from server or default
    fetch('data.json')
        .then(res => res.json())
        .then(data => {
            records = Array.isArray(data) ? data : (data.records || []);
            updateDashboard();
            filterAndRenderDirectory();
        })
        .catch(err => {
            console.warn('Could not load data.json, starting empty or using cached', err);
            records = [];
            updateDashboard();
            filterAndRenderDirectory();
        });
}

function saveRecords() {
    console.log('Saving records...', records);
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
