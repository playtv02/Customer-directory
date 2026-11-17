const GITHUB_OWNER = 'playtv02';
const GITHUB_REPO = 'Customer-directory';
const FILE_PATH = 'data.json';
const LOCAL_STORAGE_KEY = 'kabir_emporium_records';
const TOKEN_STORAGE_KEY = 'kabir_emporium_gh_token';

let records = [];
let fileSha = null;
let deleteTargetId = null;
let editingRecordId = null;
let searchDebounceTimer = null;

// Debounce helper
function debounce(func, delay = 300) {
    return function (...args) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => func.apply(this, args), delay);
    };
}

// Helpers
const encodeBase64 = str => btoa(unescape(encodeURIComponent(str)));
const decodeBase64 = str => decodeURIComponent(escape(atob(str)));

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

function getRecordTotals(r) {
    let bill = 0, qty = 0;
    if (r.itemList && Array.isArray(r.itemList) && r.itemList.length > 0) {
        r.itemList.forEach(item => {
            const q = parseFloat(item.qty) || 0;
            const rate = parseFloat(item.rate) || 0;
            qty += q;
            bill += q * rate;
        });
    } else {
        bill = parseFloat(r.billAmount) || 0;
        qty = parseFloat(r.qty) || 1;
    }

    let paid = 0;
    const mode = r.paymentMode || 'Paid Cash';
    if (mode.startsWith('Paid')) {
        paid = bill;
    } else if (mode === 'Credit / Udhaar') {
        paid = parseFloat(r.deposit) || 0;
    } else if (mode === 'Partially Paid') {
        paid = parseFloat(r.deposit) || 0;
    }

    const due = Math.max(0, bill - paid);
    return { bill, paid, due, qty };
}

// Initialization & Data Loading with Try/Catch & localStorage Fallback
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    loadSavedToken();
    await loadInitialData();
    setupEventListeners();
    updateDashboard();
    renderRecords();
    populateCustomerDatalist();
    setDefaultDate();
}

function loadSavedToken() {
    const tokenInput = document.getElementById('gh-token-input');
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (tokenInput && token) {
        tokenInput.value = token;
    }
    updateSyncStatus();
}

async function loadInitialData() {
    // Try loading from localStorage first or fetch remote data with fallback
    let loadedFromLocal = false;
    const localData = localStorage.getItem(LOCAL_STORAGE_KEY);

    if (localData) {
        try {
            const parsed = JSON.parse(localData);
            if (Array.isArray(parsed) && parsed.length > 0) {
                records = parsed;
                loadedFromLocal = true;
            }
        } catch (e) {
            console.warn('Error parsing local storage records:', e);
        }
    }

    // Try fetching remote data from data.json or employees.json
    try {
        const token = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (token) {
            await fetchDataFromGitHub(false);
            return;
        }

        // Fetch fallback static files data.json / employees.json with try/catch
        const res = await fetch('./data.json').catch(() => null) || await fetch('./employees.json').catch(() => null);
        if (res && res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
                records = data;
                saveToLocalStorage();
            }
        }
    } catch (err) {
        console.warn('Failed fetching data.json / employees.json, falling back to local storage:', err);
        if (!loadedFromLocal) {
            records = [];
        }
    }
}

function saveToLocalStorage() {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
    } catch (e) {
        console.error('LocalStorage write failed:', e);
    }
}

function setupEventListeners() {
    // Search input debouncing
    const searchBar = document.getElementById('search-bar');
    if (searchBar) {
        const debouncedSearch = debounce(() => {
            renderRecords();
        }, 300);
        searchBar.addEventListener('input', debouncedSearch);
    }
}

function handleSearchInput() {
    // Triggered on input, handled by debounced listener if bound, or direct render fallback
    if (!searchDebounceTimer) {
        renderRecords();
    }
}

function setDefaultDate() {
    const dateInput = document.getElementById('cust-date');
    if (dateInput && !dateInput.value) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }
}

// Validation & Input Sanitization
function validateCustomerForm(data) {
    if (!data.name || data.name.trim() === '') {
        showToast('Customer Name is required.', 'error');
        return false;
    }

    if (data.phone && data.phone.trim() !== '') {
        const phoneRegex = /^[0-9+\-\s()]{7,15}$/;
        if (!phoneRegex.test(data.phone.trim())) {
            showToast('Please enter a valid phone number (digits/standard format).', 'error');
            return false;
        }
    }

    if (data.email && data.email.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email.trim())) {
            showToast('Please enter a valid email address.', 'error');
            return false;
        }
    }

    if (!data.itemList || data.itemList.length === 0) {
        showToast('At least one item purchase record is required.', 'error');
        return false;
    }

    for (let i = 0; i < data.itemList.length; i++) {
        const item = data.itemList[i];
        if (!item.desc || item.desc.trim() === '') {
            showToast(`Item #${i + 1} description cannot be empty.`, 'error');
            return false;
        }
        if (isNaN(item.qty) || item.qty <= 0) {
            showToast(`Item #${i + 1} quantity must be greater than 0.`, 'error');
            return false;
        }
        if (isNaN(item.rate) || item.rate < 0) {
            showToast(`Item #${i + 1} rate cannot be negative.`, 'error');
            return false;
        }
    }

    return true;
}

// Form Operations
function saveCustomerRecord(e) {
    if (e) e.preventDefault();

    const nameInput = document.getElementById('cust-name');
    const phoneInput = document.getElementById('cust-phone');
    const cityInput = document.getElementById('cust-city');
    const paymentModeSelect = document.getElementById('payment-mode');
    const depositInput = document.getElementById('credit-deposit');
    const dateInput = document.getElementById('cust-date');

    const itemList = [];
    const rows = document.querySelectorAll('#items-tbody tr');
    rows.forEach(row => {
        const desc = row.querySelector('.bill-desc')?.value || '';
        const qty = parseFloat(row.querySelector('.bill-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.bill-rate')?.value) || 0;
        if (desc.trim() !== '') {
            itemList.push({ desc: desc.trim(), qty, rate });
        }
    });

    const recordData = {
        id: editingRecordId ? editingRecordId : Date.now(),
        name: nameInput ? nameInput.value.trim() : '',
        phone: phoneInput ? phoneInput.value.trim() : '',
        city: cityInput ? cityInput.value.trim() : '',
        paymentMode: paymentModeSelect ? paymentModeSelect.value : 'Paid Cash',
        deposit: parseFloat(depositInput?.value) || 0,
        date: dateInput ? dateInput.value : new Date().toISOString().split('T')[0],
        itemList: itemList
    };

    if (!validateCustomerForm(recordData)) {
        return;
    }

    if (editingRecordId) {
        const index = records.findIndex(r => r.id === editingRecordId);
        if (index !== -1) {
            records[index] = recordData;
            showToast('Customer record updated successfully!', 'success');
        }
        editingRecordId = null;
        resetFormState();
    } else {
        records.unshift(recordData);
        showToast('New customer record added!', 'success');
    }

    saveToLocalStorage();
    updateDashboard();
    renderRecords();
    populateCustomerDatalist();
    resetCustomerForm();
    if (localStorage.getItem(TOKEN_STORAGE_KEY)) {
        pushDataToGitHub(true);
    }
}

function resetFormState() {
    const title = document.getElementById('form-card-title');
    const saveBtn = document.getElementById('save-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (title) title.textContent = 'New Customer Record';
    if (saveBtn) saveBtn.textContent = 'Save Record';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

function resetCustomerForm() {
    const form = document.getElementById('customer-form');
    if (form) form.reset();

    const tbody = document.getElementById('items-tbody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td><input type="text" class="form-control bill-desc" placeholder="Description (e.g. Kurti)" required aria-label="Item Description"></td>
                <td><input type="number" class="form-control bill-qty" placeholder="Qty" value="1" min="1" oninput="updateLiveTotal()" required aria-label="Item Quantity"></td>
                <td><input type="number" class="form-control bill-rate" placeholder="Rate ₹" step="0.01" min="0" oninput="updateLiveTotal()" required aria-label="Item Price"></td>
                <td><button type="button" class="btn-remove-row" onclick="removeBillItemRow(this)" aria-label="Remove item">&times;</button></td>
            </tr>
        `;
    }
    updateLiveTotal();
    toggleCreditFields();
    setDefaultDate();
    resetFormState();
}

function cancelEditMode() {
    editingRecordId = null;
    resetCustomerForm();
}

function addBillItemRow() {
    const tbody = document.getElementById('items-tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" class="form-control bill-desc" placeholder="Description" required aria-label="Item Description"></td>
        <td><input type="number" class="form-control bill-qty" placeholder="Qty" value="1" min="1" oninput="updateLiveTotal()" required aria-label="Item Quantity"></td>
        <td><input type="number" class="form-control bill-rate" placeholder="Rate ₹" step="0.01" min="0" oninput="updateLiveTotal()" required aria-label="Item Price"></td>
        <td><button type="button" class="btn-remove-row" onclick="removeBillItemRow(this)" aria-label="Remove item">&times;</button></td>
    `;
    tbody.appendChild(tr);
    updateLiveTotal();
}

function removeBillItemRow(btn) {
    const tbody = document.getElementById('items-tbody');
    if (!tbody || tbody.querySelectorAll('tr').length <= 1) {
        showToast('At least one item line is required.', 'info');
        return;
    }
    const tr = btn.closest('tr');
    if (tr) tr.remove();
    updateLiveTotal();
}

function updateLiveTotal() {
    let total = 0;
    const rows = document.querySelectorAll('#items-tbody tr');
    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('.bill-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.bill-rate')?.value) || 0;
        total += qty * rate;
    });

    const display = document.getElementById('live-total-display');
    if (display) {
        display.textContent = `₹${total.toFixed(2)}`;
    }

    const mode = document.getElementById('payment-mode')?.value;
    const deposit = parseFloat(document.getElementById('credit-deposit')?.value) || 0;
    const help = document.getElementById('due-amount-help');

    if (help && (mode === 'Credit / Udhaar' || mode === 'Partially Paid')) {
        const due = Math.max(0, total - deposit);
        help.textContent = `Remaining Balance Due: ₹${due.toFixed(2)}`;
    } else if (help) {
        help.textContent = '';
    }
}

function toggleCreditFields() {
    const mode = document.getElementById('payment-mode')?.value;
    const group = document.getElementById('deposit-group');
    if (group) {
        if (mode === 'Credit / Udhaar' || mode === 'Partially Paid') {
            group.style.display = 'block';
        } else {
            group.style.display = 'none';
        }
    }
    updateLiveTotal();
}

function autoFillCustomerCity() {
    const nameVal = document.getElementById('cust-name')?.value?.trim();
    if (!nameVal) return;
    const match = records.find(r => r.name.toLowerCase() === nameVal.toLowerCase());
    if (match) {
        const phoneInput = document.getElementById('cust-phone');
        const cityInput = document.getElementById('cust-city');
        if (phoneInput && !phoneInput.value && match.phone) phoneInput.value = match.phone;
        if (cityInput && !cityInput.value && match.city) cityInput.value = match.city;
    }
}

function populateCustomerDatalist() {
    const datalist = document.getElementById('customer-list');
    if (!datalist) return;
    datalist.innerHTML = '';
    const uniqueNames = [...new Set(records.map(r => r.name).filter(Boolean))];
    uniqueNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        datalist.appendChild(opt);
    });
}

// XSS-Safe Dynamic Rendering using textContent and DOM API
function renderRecords() {
    const tbody = document.getElementById('records-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const query = (document.getElementById('search-bar')?.value || '').toLowerCase().trim();
    const filterPayment = document.getElementById('filter-payment')?.value || 'ALL';

    const filtered = records.filter(r => {
        const { bill, paid, due } = getRecordTotals(r);
        const nameMatch = (r.name || '').toLowerCase().includes(query);
        const cityMatch = (r.city || '').toLowerCase().includes(query);
        const modeMatch = (r.paymentMode || '').toLowerCase().includes(query);
        const itemsMatch = (r.itemList || []).some(item => (item.desc || '').toLowerCase().includes(query));

        const matchesQuery = !query || nameMatch || cityMatch || modeMatch || itemsMatch;

        let matchesFilter = true;
        if (filterPayment === 'Paid') {
            matchesFilter = (r.paymentMode || '').startsWith('Paid');
        } else if (filterPayment !== 'ALL') {
            matchesFilter = r.paymentMode === filterPayment;
        }

        return matchesQuery && matchesFilter;
    });

    if (filtered.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.className = 'text-center';
        td.style.padding = '24px';
        td.style.color = '#7f8c8d';
        td.textContent = 'No matching customer records found.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        renderCityPills();
        return;
    }

    filtered.forEach(r => {
        const tr = document.createElement('tr');
        const { bill, paid, due } = getRecordTotals(r);

        // Date
        const tdDate = document.createElement('td');
        tdDate.textContent = r.date || '-';
        tr.appendChild(tdDate);

        // Name
        const tdName = document.createElement('td');
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = r.name || 'Unnamed';
        tdName.appendChild(nameStrong);
        tr.appendChild(tdName);

        // Phone / City
        const tdContact = document.createElement('td');
        const phoneDiv = document.createElement('div');
        phoneDiv.textContent = r.phone || '-';
        const citySmall = document.createElement('small');
        citySmall.style.color = '#7f8c8d';
        citySmall.style.display = 'block';
        citySmall.textContent = r.city || 'No City';
        tdContact.appendChild(phoneDiv);
        tdContact.appendChild(citySmall);
        tr.appendChild(tdContact);

        // Items
        const tdItems = document.createElement('td');
        if (r.itemList && Array.isArray(r.itemList) && r.itemList.length > 0) {
            r.itemList.forEach(item => {
                const badge = document.createElement('span');
                badge.className = 'item-badge';
                badge.style.display = 'inline-block';
                badge.style.margin = '2px';
                badge.style.padding = '2px 6px';
                badge.style.background = '#eef2f5';
                badge.style.borderRadius = '4px';
                badge.style.fontSize = '12px';
                badge.textContent = `${item.desc} (x${item.qty})`;
                tdItems.appendChild(badge);
            });
        } else {
            tdItems.textContent = r.itemDesc || '-';
        }
        tr.appendChild(tdItems);

        // Total Bill
        const tdBill = document.createElement('td');
        tdBill.textContent = `₹${bill.toFixed(2)}`;
        tr.appendChild(tdBill);

        // Amount Paid
        const tdPaid = document.createElement('td');
        tdPaid.textContent = `₹${paid.toFixed(2)}`;
        tr.appendChild(tdPaid);

        // Status Badge
        const tdStatus = document.createElement('td');
        const statusSpan = document.createElement('span');
        let statusClass = 'badge-paid';
        let statusText = r.paymentMode || 'Paid';

        if (r.paymentMode === 'Credit / Udhaar') {
            statusClass = 'badge-pending';
            statusText = `Pending (Due ₹${due.toFixed(2)})`;
        } else if (r.paymentMode === 'Partially Paid') {
            statusClass = 'badge-partial';
            statusText = `Partial (Due ₹${due.toFixed(2)})`;
        }

        statusSpan.className = `status-badge ${statusClass}`;
        statusSpan.textContent = statusText;
        tdStatus.appendChild(statusSpan);
        tr.appendChild(tdStatus);

        // Actions
        const tdActions = document.createElement('td');
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-action btn-edit';
        editBtn.setAttribute('aria-label', `Edit record for ${r.name}`);
        editBtn.textContent = '✏️ Edit';
        editBtn.onclick = () => editRecord(r.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-action btn-delete';
        deleteBtn.setAttribute('aria-label', `Delete record for ${r.name}`);
        deleteBtn.textContent = '🗑️ Delete';
        deleteBtn.onclick = () => promptDelete(r.id);

        tdActions.appendChild(editBtn);
        tdActions.appendChild(deleteBtn);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });

    renderCityPills();
}

function renderCityPills() {
    const container = document.getElementById('city-pills-container');
    if (!container) return;
    container.innerHTML = '';

    const cities = [...new Set(records.map(r => r.city).filter(Boolean))];
    if (cities.length === 0) return;

    const allPill = document.createElement('span');
    allPill.className = 'city-pill active';
    allPill.textContent = 'All Cities';
    allPill.onclick = () => {
        document.getElementById('search-bar').value = '';
        renderRecords();
    };
    container.appendChild(allPill);

    cities.forEach(city => {
        const pill = document.createElement('span');
        pill.className = 'city-pill';
        pill.textContent = city;
        pill.onclick = () => {
            document.getElementById('search-bar').value = city;
            renderRecords();
        };
        container.appendChild(pill);
    });
}

function editRecord(id) {
    const r = records.find(rec => rec.id === id);
    if (!r) return;

    editingRecordId = id;

    const nameInput = document.getElementById('cust-name');
    const phoneInput = document.getElementById('cust-phone');
    const cityInput = document.getElementById('cust-city');
    const paymentModeSelect = document.getElementById('payment-mode');
    const depositInput = document.getElementById('credit-deposit');
    const dateInput = document.getElementById('cust-date');

    if (nameInput) nameInput.value = r.name || '';
    if (phoneInput) phoneInput.value = r.phone || '';
    if (cityInput) cityInput.value = r.city || '';
    if (paymentModeSelect) paymentModeSelect.value = r.paymentMode || 'Paid Cash';
    if (depositInput) depositInput.value = r.deposit || 0;
    if (dateInput) dateInput.value = r.date || new Date().toISOString().split('T')[0];

    const tbody = document.getElementById('items-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        if (r.itemList && Array.isArray(r.itemList) && r.itemList.length > 0) {
            r.itemList.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><input type="text" class="form-control bill-desc" value="${item.desc || ''}" required aria-label="Item Description"></td>
                    <td><input type="number" class="form-control bill-qty" value="${item.qty || 1}" min="1" oninput="updateLiveTotal()" required aria-label="Item Quantity"></td>
                    <td><input type="number" class="form-control bill-rate" value="${item.rate || 0}" step="0.01" min="0" oninput="updateLiveTotal()" required aria-label="Item Price"></td>
                    <td><button type="button" class="btn-remove-row" onclick="removeBillItemRow(this)" aria-label="Remove item">&times;</button></td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" class="form-control bill-desc" value="${r.itemDesc || ''}" required aria-label="Item Description"></td>
                <td><input type="number" class="form-control bill-qty" value="${r.qty || 1}" min="1" oninput="updateLiveTotal()" required aria-label="Item Quantity"></td>
                <td><input type="number" class="form-control bill-rate" value="${r.billAmount || 0}" step="0.01" min="0" oninput="updateLiveTotal()" required aria-label="Item Price"></td>
                <td><button type="button" class="btn-remove-row" onclick="removeBillItemRow(this)" aria-label="Remove item">&times;</button></td>
            `;
            tbody.appendChild(tr);
        }
    }

    const title = document.getElementById('form-card-title');
    const saveBtn = document.getElementById('save-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (title) title.textContent = 'Edit Customer Record';
    if (saveBtn) saveBtn.textContent = 'Update Record';
    if (cancelBtn) cancelBtn.style.display = 'block';

    toggleCreditFields();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function promptDelete(id) {
    deleteTargetId = id;
    const modal = document.getElementById('confirm-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');

        const btn = document.getElementById('confirm-delete-btn');
        if (btn) {
            btn.onclick = () => confirmDelete();
        }
    }
}

function confirmDelete() {
    if (!deleteTargetId) return;
    records = records.filter(r => r.id !== deleteTargetId);
    deleteTargetId = null;

    closeModal('confirm-modal');
    saveToLocalStorage();
    updateDashboard();
    renderRecords();
    populateCustomerDatalist();
    showToast('Record deleted.', 'info');

    if (localStorage.getItem(TOKEN_STORAGE_KEY)) {
        pushDataToGitHub(true);
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
}

// Dashboard Stats & Financial Summary
function updateDashboard() {
    let totalRev = 0;
    let pendingCol = 0;
    let todayRev = 0;

    const todayStr = new Date().toISOString().split('T')[0];

    records.forEach(r => {
        const { bill, paid, due } = getRecordTotals(r);
        totalRev += bill;
        pendingCol += due;
        if (r.date === todayStr) {
            todayRev += bill;
        }
    });

    const totalCustEl = document.getElementById('stat-total-cust');
    const totalRevEl = document.getElementById('stat-total-rev');
    const pendingEl = document.getElementById('stat-pending');
    const todayEl = document.getElementById('stat-today');

    if (totalCustEl) totalCustEl.textContent = records.length;
    if (totalRevEl) totalRevEl.textContent = `₹${totalRev.toFixed(2)}`;
    if (pendingEl) pendingEl.textContent = `₹${pendingCol.toFixed(2)}`;
    if (todayEl) todayEl.textContent = `₹${todayRev.toFixed(2)}`;

    renderYearSummary();
}

function renderYearSummary() {
    const container = document.getElementById('year-summary-grid');
    if (!container) return;
    container.innerHTML = '';

    const yearData = {};

    records.forEach(r => {
        const year = r.date ? r.date.split('-')[0] : 'Unknown';
        const { bill, paid, due } = getRecordTotals(r);

        if (!yearData[year]) {
            yearData[year] = { count: 0, bill: 0, paid: 0, due: 0 };
        }
        yearData[year].count += 1;
        yearData[year].bill += bill;
        yearData[year].paid += paid;
        yearData[year].due += due;
    });

    const sortedYears = Object.keys(yearData).sort((a, b) => b.localeCompare(a));

    if (sortedYears.length === 0) {
        container.textContent = 'No financial records available.';
        return;
    }

    sortedYears.forEach(year => {
        const card = document.createElement('div');
        card.className = 'year-card';
        card.style.background = '#f8f9fa';
        card.style.border = '1px solid #e2e8f0';
        card.style.borderRadius = '8px';
        card.style.padding = '14px';

        const data = yearData[year];

        const h4 = document.createElement('h4');
        h4.style.margin = '0 0 8px 0';
        h4.style.color = '#2c3e50';
        h4.textContent = `Year ${year}`;

        const pCount = document.createElement('p');
        pCount.style.margin = '4px 0';
        pCount.textContent = `Transactions: ${data.count}`;

        const pBill = document.createElement('p');
        pBill.style.margin = '4px 0';
        pBill.style.fontWeight = '600';
        pBill.textContent = `Total Sales: ₹${data.bill.toFixed(2)}`;

        const pPaid = document.createElement('p');
        pPaid.style.margin = '4px 0';
        pPaid.style.color = '#27ae60';
        pPaid.textContent = `Collected: ₹${data.paid.toFixed(2)}`;

        const pDue = document.createElement('p');
        pDue.style.margin = '4px 0';
        pDue.style.color = '#e74c3c';
        pDue.textContent = `Pending: ₹${data.due.toFixed(2)}`;

        card.appendChild(h4);
        card.appendChild(pCount);
        card.appendChild(pBill);
        card.appendChild(pPaid);
        card.appendChild(pDue);

        container.appendChild(card);
    });
}

// GitHub Cloud Sync & Token Storage
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

function toggleSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    const pill = document.getElementById('sync-pill');
    if (!panel) return;
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    if (pill) pill.setAttribute('aria-expanded', isVisible ? 'false' : 'true');
}

function saveToken() {
    const input = document.getElementById('gh-token-input');
    if (!input) return;
    const token = input.value.trim();
    if (token) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
        showToast('GitHub Personal Access Token saved!', 'success');
    } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        showToast('Token cleared. Switched to Local-Only mode.', 'info');
    }
    updateSyncStatus();
    toggleSettingsPanel();
}

function updateSyncStatus() {
    const dot = document.getElementById('sync-dot');
    const text = document.getElementById('sync-text');
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);

    if (!dot || !text) return;

    if (token) {
        dot.className = 'sync-dot green';
        text.textContent = 'Cloud Sync Enabled';
    } else {
        dot.className = 'sync-dot yellow';
        text.textContent = 'Local Only Mode';
    }
}

async function fetchDataFromGitHub(showToasts = true) {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;

    try {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (token) headers['Authorization'] = `token ${token}`;

        const res = await fetch(url, { headers });
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }

        const json = await res.json();
        fileSha = json.sha;

        const contentStr = decodeBase64(json.content);
        const parsed = JSON.parse(contentStr);

        if (Array.isArray(parsed)) {
            records = parsed;
            saveToLocalStorage();
            updateDashboard();
            renderRecords();
            populateCustomerDatalist();
            if (showToasts) showToast('Data successfully pulled from GitHub!', 'success');
        }
    } catch (err) {
        console.warn('Error fetching data from GitHub:', err);
        if (showToasts) showToast('Failed to pull from GitHub. Operating on local cache.', 'error');
    } finally {
        updateSyncStatus();
    }
}

async function pushDataToGitHub(silent = false) {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
        if (!silent) showToast('No GitHub token found. Please add token in settings.', 'error');
        return;
    }

    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;

    try {
        if (!fileSha) {
            const getRes = await fetch(url, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            if (getRes.ok) {
                const getJson = await getRes.json();
                fileSha = getJson.sha;
            }
        }

        const bodyData = {
            message: 'Update customer records via web app',
            content: encodeBase64(JSON.stringify(records, null, 2)),
            sha: fileSha
        };

        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyData)
        });

        if (!res.ok) throw new Error(`Push failed status ${res.status}`);

        const resJson = await res.json();
        fileSha = resJson.content.sha;
        if (!silent) showToast('Data successfully synced to GitHub!', 'success');
    } catch (err) {
        console.error('Push data error:', err);
        if (!silent) showToast('Failed to sync to GitHub. Local changes saved.', 'error');
    }
}
