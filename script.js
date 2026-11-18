const GITHUB_OWNER = 'playtv02';
const GITHUB_REPO = 'Customer-directory';
const FILE_PATH = 'data.json';

let records = [];
let fileSha = null;
let deleteTargetId = null;
let liveSyncInterval = null;

function getRecordTotals(r) {
    if (r.itemList && r.itemList.length > 0) {
        let bill = 0, qty = 0;
        r.itemList.forEach(i => {
            bill += (Number(i.qty) || 0) * (Number(i.price) || 0);
            qty += Number(i.qty) || 0;
        });
        return { bill, qty };
    }
    return { bill: (Number(r.items) || 1) * (Number(r.price) || 0), qty: Number(r.items) || 1 };
}

function getLocalTodayDate() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().split('T')[0];
}

function addBillItemRow(item = {}) {
    const container = document.getElementById('bill-items-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'bill-item-row flex gap-2 items-center mb-2';
    div.innerHTML = `
        <input type="text" class="item-name form-input flex-1 p-2 border rounded" placeholder="Item Name" value="${item.name || ''}" required>
        <input type="number" class="item-qty form-input w-20 p-2 border rounded" placeholder="Qty" value="${item.qty !== undefined ? item.qty : 1}" min="1" oninput="updateLiveTotal()" required>
        <input type="number" class="item-price form-input w-24 p-2 border rounded" placeholder="Price" value="${item.price !== undefined ? item.price : ''}" step="0.01" min="0" oninput="updateLiveTotal()" required>
        <button type="button" onclick="removeBillItemRow(this)" class="text-red-500 hover:text-red-700 px-2 font-bold">✕</button>
    `;
    container.appendChild(div);
    updateLiveTotal();
}

function removeBillItemRow(btn) {
    const row = btn.closest('.bill-item-row');
    if (row) {
        row.remove();
        updateLiveTotal();
    }
}

function updateLiveTotal() {
    const rows = document.querySelectorAll('.bill-item-row');
    let total = 0;
    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
        const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
        total += qty * price;
    });

    const liveTotalEl = document.getElementById('live-bill-total');
    if (liveTotalEl) {
        liveTotalEl.textContent = '₹' + total.toFixed(2);
    }

    const payMode = document.getElementById('payment-mode')?.value;
    if (payMode === 'Credit') {
        const deposit = parseFloat(document.getElementById('credit-deposit')?.value) || 0;
        const remaining = total - deposit;
        const remEl = document.getElementById('remaining-credit-balance');
        if (remEl) {
            remEl.textContent = '₹' + Math.max(0, remaining).toFixed(2);
        }
    }
}

function toggleCreditFields() {
    const payMode = document.getElementById('payment-mode')?.value;
    const creditContainer = document.getElementById('credit-container');
    if (creditContainer) {
        if (payMode === 'Credit') {
            creditContainer.classList.remove('hidden');
        } else {
            creditContainer.classList.add('hidden');
        }
    }
    updateLiveTotal();
}

function checkBankHoliday() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const dateOfMonth = now.getDate();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(dateOfMonth).padStart(2, '0');
    const mmdd = `${month}-${day}`;

    const fixedHolidays = { '01-26': true, '08-15': true, '10-02': true, '12-25': true };
    const pill = document.getElementById('bank-holiday-pill');
    const icon = document.getElementById('bank-status-icon');
    const text = document.getElementById('bank-status-text');

    let isClosed = false;
    if (fixedHolidays[mmdd]) {
        isClosed = true;
    } else if (dayOfWeek === 0) {
        isClosed = true;
    } else if (dayOfWeek === 6) {
        const weekOfMonth = Math.ceil(dateOfMonth / 7);
        if (weekOfMonth === 2 || weekOfMonth === 4) {
            isClosed = true;
        }
    }

    if (isClosed) {
        if (pill) pill.className = 'bank-status-pill closed';
        if (icon) icon.textContent = '🔴';
        if (text) text.textContent = 'Bank Holiday';
    } else {
        if (pill) pill.className = 'bank-status-pill open';
        if (icon) icon.textContent = '🟢';
        if (text) text.textContent = 'Working Day';
    }
}

function updateStatus(text, type) {
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');
    if (statusText) statusText.textContent = text;
    if (statusDot) {
        statusDot.className = 'status-dot ' + (type || 'online');
    }
}

function toggleSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (panel) {
        if (panel.style.display === 'none' || !panel.style.display) {
            panel.style.display = 'block';
            const input = document.getElementById('gh-token');
            if (input) input.value = localStorage.getItem('gh_token') || '';
        } else {
            panel.style.display = 'none';
        }
    }
}

function saveToken() {
    const input = document.getElementById('gh-token');
    if (!input) return;
    const val = input.value.trim();
    if (val) {
        localStorage.setItem('gh_token', val);
        showToast('Token saved!', 'success');
    } else {
        localStorage.removeItem('gh_token');
        showToast('Token cleared.', 'info');
    }
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = 'none';
    checkTokenAndLoad();
}

async function loadData(silent = false) {
    if (!silent) updateStatus('Syncing...', 'syncing');
    const token = localStorage.getItem('gh_token') || '';
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }

    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}?ref=main&t=${Date.now()}`;

    try {
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const data = await res.json();
        fileSha = data.sha;

        const content = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
        const parsed = JSON.parse(content);
        const newRecords = Array.isArray(parsed) ? parsed : [];

        const dataChanged = JSON.stringify(newRecords) !== JSON.stringify(records);
        if (dataChanged) {
            records = newRecords;
            updateDashboard();
            renderRecords();
            renderHoveringCities();
            populateCustomerDatalist();
        }
        updateStatus('Connected', 'online');
    } catch (err) {
        console.error('Error loading data:', err);
        if (!silent) {
            updateStatus('Offline', 'offline');
            showToast('Failed to load data from GitHub', 'danger');
        }
    }
}

function startLiveSync() {
    if (liveSyncInterval) clearInterval(liveSyncInterval);
    liveSyncInterval = setInterval(() => {
        loadData(true);
    }, 5000);
}

async function checkTokenAndLoad() {
    const input = document.getElementById('gh-token');
    if (input) input.value = localStorage.getItem('gh_token') || '';
    await loadData();
    startLiveSync();
}

async function pushDataToGitHub(newRecords, commitMessage) {
    updateStatus('Syncing...', 'syncing');
    const token = localStorage.getItem('gh_token') || '';
    if (!token) {
        showToast('GitHub Token required to save changes', 'warning');
        toggleSettingsPanel();
        updateStatus('Offline', 'offline');
        return false;
    }

    const contentStr = JSON.stringify(newRecords, null, 2);
    const encodedContent = btoa(unescape(encodeURIComponent(contentStr)));

    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const payload = {
        message: commitMessage || 'Update customer records',
        content: encodedContent,
        branch: 'main'
    };
    if (fileSha) payload.sha = fileSha;

    try {
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.message || 'Failed to save');
        }

        const resData = await res.json();
        fileSha = resData.content.sha;
        records = newRecords;
        updateDashboard();
        renderRecords();
        renderHoveringCities();
        populateCustomerDatalist();
        updateStatus('Connected', 'online');
        showToast('Saved to GitHub successfully!', 'success');
        return true;
    } catch (err) {
        console.error('Save error:', err);
        showToast('Error saving to GitHub: ' + err.message, 'danger');
        updateStatus('Offline', 'offline');
        return false;
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-record-id')?.value;
    const name = document.getElementById('cust-name')?.value.trim();
    const city = document.getElementById('cust-city')?.value.trim();
    const date = document.getElementById('cust-date')?.value;
    const paymentMode = document.getElementById('payment-mode')?.value || 'Cash';
    
    let deposit = 0;
    if (paymentMode === 'Credit') {
        deposit = parseFloat(document.getElementById('credit-deposit')?.value) || 0;
    }

    const itemRows = document.querySelectorAll('.bill-item-row');
    const itemList = [];
    itemRows.forEach(row => {
        const iName = row.querySelector('.item-name')?.value.trim();
        const iQty = parseFloat(row.querySelector('.item-qty')?.value) || 1;
        const iPrice = parseFloat(row.querySelector('.item-price')?.value) || 0;
        if (iName) {
            itemList.push({ name: iName, qty: iQty, price: iPrice });
        }
    });

    if (!name || !date || itemList.length === 0) {
        showToast('Please fill in required fields and add at least one item', 'warning');
        return;
    }

    const { bill: totalBill, qty: totalQty } = getRecordTotals({ itemList });

    const newRecord = {
        id: editId ? Number(editId) : Date.now(),
        name,
        city: city || 'Local',
        date,
        items: totalQty,
        price: totalBill > 0 ? (totalBill / totalQty) : 0,
        itemList,
        paymentMode,
        deposit: paymentMode === 'Credit' ? deposit : 0
    };

    let updatedRecords = [...records];
    if (editId) {
        const idx = updatedRecords.findIndex(r => r.id === Number(editId));
        if (idx !== -1) updatedRecords[idx] = newRecord;
    } else {
        updatedRecords.unshift(newRecord);
    }

    const success = await pushDataToGitHub(updatedRecords, editId ? `Update record #${editId}` : `Add record for ${name}`);
    if (success) {
        resetForm();
    }
}

function resetForm() {
    const form = document.getElementById('record-form');
    if (form) form.reset();
    document.getElementById('edit-record-id').value = '';
    document.getElementById('cust-date').value = getLocalTodayDate();
    document.getElementById('save-btn').textContent = 'Save Record';
    document.getElementById('cancel-edit-btn').classList.add('hidden');
    document.getElementById('bill-items-container').innerHTML = '';
    toggleCreditFields();
    addBillItemRow();
}

function cancelEditMode() {
    resetForm();
}

function editRecord(id) {
    const r = records.find(rec => rec.id === id);
    if (!r) return;

    document.getElementById('edit-record-id').value = r.id;
    document.getElementById('cust-name').value = r.name || '';
    document.getElementById('cust-city').value = r.city || '';
    document.getElementById('cust-date').value = r.date || getLocalTodayDate();
    document.getElementById('payment-mode').value = r.paymentMode || 'Cash';

    toggleCreditFields();
    if (r.paymentMode === 'Credit') {
        document.getElementById('credit-deposit').value = r.deposit || 0;
    }

    const container = document.getElementById('bill-items-container');
    container.innerHTML = '';
    if (r.itemList && r.itemList.length > 0) {
        r.itemList.forEach(item => addBillItemRow(item));
    } else {
        addBillItemRow({ name: 'Item', qty: r.items || 1, price: r.price || 0 });
    }

    document.getElementById('save-btn').textContent = 'Update Record';
    document.getElementById('cancel-edit-btn').classList.remove('hidden');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openDeleteModal(id) {
    deleteTargetId = id;
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeModal() {
    deleteTargetId = null;
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
}

async function executeDelete() {
    if (!deleteTargetId) return;
    const updatedRecords = records.filter(r => r.id !== deleteTargetId);
    closeModal();
    await pushDataToGitHub(updatedRecords, `Delete record #${deleteTargetId}`);
}

function updateDashboard() {
    const selectedDate = document.getElementById('cust-date')?.value || getLocalTodayDate();
    let totalDaySale = 0;
    let totalItems = 0;
    const citiesSet = new Set();

    records.forEach(r => {
        const totals = getRecordTotals(r);
        if (r.date === selectedDate) {
            totalDaySale += totals.bill;
        }
        totalItems += totals.qty;
        if (r.city) citiesSet.add(r.city);
    });

    const dayLabel = document.getElementById('stat-day-label');
    if (dayLabel) dayLabel.textContent = selectedDate;

    const daySaleEl = document.getElementById('stat-day-sale');
    if (daySaleEl) daySaleEl.textContent = '₹' + totalDaySale.toFixed(2);

    const recordsEl = document.getElementById('stat-records');
    if (recordsEl) recordsEl.textContent = records.length;

    const itemsEl = document.getElementById('stat-items');
    if (itemsEl) itemsEl.textContent = totalItems;

    const citiesEl = document.getElementById('stat-cities');
    if (citiesEl) citiesEl.textContent = citiesSet.size;
}

function handleSearchInput() {
    const query = document.getElementById('search-bar')?.value.toLowerCase().trim() || '';
    const sugBox = document.getElementById('search-suggestions');
    if (!sugBox) return;

    if (!query) {
        sugBox.classList.remove('active');
        sugBox.innerHTML = '';
        renderRecords();
        return;
    }

    const matches = records.filter(r => 
        (r.name && r.name.toLowerCase().includes(query)) ||
        (r.city && r.city.toLowerCase().includes(query)) ||
        (r.itemList && r.itemList.some(i => i.name.toLowerCase().includes(query)))
    );

    if (matches.length > 0) {
        sugBox.innerHTML = matches.map(r => `
            <div class="suggestion-item p-2 hover:bg-gray-100 cursor-pointer border-b" onclick="selectSearchSuggestion('${r.name.replace(/'/g, "\\'")}')">
                <span class="font-bold">${r.name}</span> <span class="text-xs text-gray-500">(${r.city || 'Local'})</span>
            </div>
        `).join('');
        sugBox.classList.add('active');
    } else {
        sugBox.innerHTML = '<div class="p-2 text-gray-500 text-sm">No matching records</div>';
        sugBox.classList.add('active');
    }
    renderRecords();
}

function selectSearchSuggestion(name) {
    const searchBar = document.getElementById('search-bar');
    if (searchBar) searchBar.value = name;
    document.getElementById('search-suggestions')?.classList.remove('active');
    renderRecords();
}

function renderRecords() {
    const container = document.getElementById('records-container');
    const showingCount = document.getElementById('showing-count');
    if (!container) return;

    const query = document.getElementById('search-bar')?.value.toLowerCase().trim() || '';
    const filterPay = document.getElementById('filter-payment')?.value || 'ALL';

    let filtered = records.filter(r => {
        const matchesQuery = !query || 
            (r.name && r.name.toLowerCase().includes(query)) ||
            (r.city && r.city.toLowerCase().includes(query)) ||
            (r.itemList && r.itemList.some(i => i.name.toLowerCase().includes(query)));
        
        const matchesPay = filterPay === 'ALL' || (r.paymentMode || 'Cash') === filterPay;
        return matchesQuery && matchesPay;
    });

    if (showingCount) {
        showingCount.textContent = `Showing ${filtered.length} of ${records.length} records`;
    }

    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-500">No records found.</div>';
        return;
    }

    container.innerHTML = filtered.map(r => {
        const totals = getRecordTotals(r);
        const payMode = r.paymentMode || 'Cash';
        let payBadge = `<span class="px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-800">${payMode}</span>`;
        if (payMode === 'Credit') {
            const deposit = r.deposit || 0;
            const remaining = totals.bill - deposit;
            payBadge = `<span class="px-2 py-1 rounded text-xs font-semibold bg-yellow-100 text-yellow-800">Credit (Rem: ₹${remaining.toFixed(2)})</span>`;
        } else if (payMode === 'UPI') {
            payBadge = `<span class="px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800">UPI</span>`;
        }

        let itemsHtml = '';
        if (r.itemList && r.itemList.length > 0) {
            itemsHtml = r.itemList.map(i => `${i.name} (x${i.qty} @ ₹${i.price})`).join(', ');
        } else {
            itemsHtml = `Items: ${r.items || 1} @ ₹${r.price || 0}`;
        }

        return `
            <div class="record-card p-4 border rounded shadow-sm bg-white hover:shadow-md transition mb-3">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h3 class="text-lg font-bold text-gray-800">${r.name}</h3>
                        <p class="text-xs text-gray-500">${r.city || 'Local'} • ${r.date || ''}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        ${payBadge}
                        <button onclick="editRecord(${r.id})" class="text-blue-600 hover:text-blue-800 text-sm font-semibold">Edit</button>
                        <button onclick="openDeleteModal(${r.id})" class="text-red-600 hover:text-red-800 text-sm font-semibold">Delete</button>
                    </div>
                </div>
                <div class="text-sm text-gray-700 mb-2">${itemsHtml}</div>
                <div class="text-right font-bold text-gray-900">Total: ₹${totals.bill.toFixed(2)}</div>
            </div>
        `;
    }).join('');
}

function renderHoveringCities() {
    const container = document.getElementById('hovering-cities');
    if (!container) return;
    const citiesSet = new Set();
    records.forEach(r => { if (r.city) citiesSet.add(r.city); });

    if (citiesSet.size === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = Array.from(citiesSet).map(c => `
        <span class="inline-block bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded-full cursor-pointer hover:bg-gray-300 mr-1 mb-1" onclick="filterByCity('${c.replace(/'/g, "\\'")}')">${c}</span>
    `).join('');
}

function filterByCity(cityName) {
    const searchBar = document.getElementById('search-bar');
    if (searchBar) searchBar.value = cityName;
    renderRecords();
}

function populateCustomerDatalist() {
    const list = document.getElementById('customer-datalist');
    if (!list) return;
    const names = new Set();
    records.forEach(r => { if (r.name) names.add(r.name); });
    list.innerHTML = Array.from(names).map(n => `<option value="${n}">`).join('');
}

function autoFillCustomerCity() {
    const nameInput = document.getElementById('cust-name');
    const cityInput = document.getElementById('cust-city');
    if (!nameInput || !cityInput) return;
    const val = nameInput.value.trim().toLowerCase();
    if (!val) return;
    const rec = records.find(r => r.name && r.name.toLowerCase() === val);
    if (rec && rec.city) {
        cityInput.value = rec.city;
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const bgColors = {
        success: 'bg-green-600',
        danger: 'bg-red-600',
        warning: 'bg-yellow-600',
        info: 'bg-blue-600'
    };
    toast.className = `toast ${bgColors[type] || bgColors.info} text-white px-4 py-2 rounded shadow text-sm transition-opacity duration-300`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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
    checkTokenAndLoad();

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            const sug = document.getElementById('search-suggestions');
            if (sug) sug.classList.remove('active');
        }
    });
});
