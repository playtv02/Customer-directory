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
    checkTokenAndLoad();

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            const suggestions = document.getElementById('search-suggestions');
            if (suggestions) suggestions.classList.remove('active');
        }
    });

    const recordForm = document.getElementById('record-form');
    if (recordForm) {
        recordForm.addEventListener('submit', function(event) {
            event.preventDefault();
            window.saveCustomerRecord(event);
        });
    }

    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (deleteTargetId) {
                const previousRecords = records.slice();
                records = records.filter(r => r.id !== deleteTargetId);
                closeModal();
                updateDashboard();
                renderRecords();
                renderHoveringCities();
                populateCustomerDatalist();

                const saved = await pushDataToGitHub();
                if (!saved) {
                    records = previousRecords;
                    updateDashboard();
                    renderRecords();
                    renderHoveringCities();
                    populateCustomerDatalist();
                    return;
                }
                showToast('✅ Record deleted from GitHub');
            }
        });
    }
});

// Bill Items Logic
function addBillItemRow(desc = '', qty = 1, price = '') {
    const wrapper = document.getElementById('bill-items-wrapper');
    if (!wrapper) return;

    const row = document.createElement('div');
    row.className = 'bill-item-row';
    row.style.cssText = 'display: flex; flex-direction: column; gap: 8px; background: #eef2f6; padding: 12px; border-radius: 12px; box-shadow: var(--shadow-pressed);';
    row.innerHTML = `
        <div style="width: 100%;">
            <input type="text" class="form-control item-desc" placeholder="Item Name" value="${String(desc).replace(/"/g, '&quot;')}" style="width: 100%; padding: 12px; box-shadow: none; border: 1px solid rgba(15,23,42,0.1); background: #fff;">
        </div>
        <div style="display: flex; gap: 6px; width: 100%; align-items: center;">
            <input type="number" class="form-control item-qty" placeholder="Qty" value="${qty}" min="1" required style="flex: 1; min-width: 60px; padding: 12px; box-shadow: none; border: 1px solid rgba(15,23,42,0.1); background: #fff;" oninput="updateLiveTotal()">
            <input type="number" class="form-control item-price" placeholder="Price (₹)" step="0.01" min="0" value="${price}" required style="flex: 2; min-width: 90px; padding: 12px; box-shadow: none; border: 1px solid rgba(15,23,42,0.1); background: #fff;" oninput="updateLiveTotal()">
            <button type="button" class="btn-icon" style="margin-bottom: 0; padding: 10px; background: #fff; box-shadow: 0 2px 4px rgba(15,23,42,0.05); flex-shrink: 0;" onclick="removeBillItemRow(this)" title="Remove">🗑️</button>
        </div>
    `;
    wrapper.appendChild(row);
    updateLiveTotal();
}

function removeBillItemRow(btn) {
    const wrapper = document.getElementById('bill-items-wrapper');
    if (!wrapper) return;

    if (wrapper.children.length > 1) {
        btn.closest('.bill-item-row').remove();
        updateLiveTotal();
    } else {
        showToast('⚠️ Bill must have at least one item');
    }
}

// Bank Holiday Checker
function checkBankHoliday() {
    const pill = document.getElementById('bank-holiday-pill');
    const icon = document.getElementById('bank-status-icon');
    const text = document.getElementById('bank-status-text');
    if (!pill || !icon || !text) return;

    const now = new Date();
    const dayOfWeek = now.getDay();
    const dateOfMonth = now.getDate();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(dateOfMonth).padStart(2, '0');
    const mmdd = `${month}-${day}`;
    const fixedHolidays = { '01-26': true, '08-15': true, '10-02': true, '12-25': true };

    let isClosed = false;
    if (fixedHolidays[mmdd]) {
        isClosed = true;
    } else if (dayOfWeek === 0) {
        isClosed = true;
    } else if (dayOfWeek === 6) {
        const weekOfMonth = Math.ceil(dateOfMonth / 7);
        if (weekOfMonth === 2 || weekOfMonth === 4) isClosed = true;
    }

    if (isClosed) {
        pill.className = 'bank-status-pill closed';
        icon.textContent = '🔴';
        text.textContent = 'Bank';
    } else {
        pill.className = 'bank-status-pill open';
        icon.textContent = '🟢';
        text.textContent = 'Bank';
    }
}

function toggleCreditFields() {
    const modeEl = document.getElementById('payment-mode');
    const creditContainer = document.getElementById('credit-container');
    if (!modeEl || !creditContainer) return;

    if (modeEl.value === 'Credit') {
        creditContainer.style.display = 'block';
    } else {
        creditContainer.style.display = 'none';
        const depositEl = document.getElementById('credit-deposit');
        if (depositEl) depositEl.value = 0;
    }
    updateLiveTotal();
}

function updateLiveTotal() {
    let total = 0;
    document.querySelectorAll('.bill-item-row').forEach(row => {
        const qty = parseInt(row.querySelector('.item-qty')?.value) || 0;
        const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
        total += (qty * price);
    });

    const liveTotalEl = document.getElementById('live-bill-total');
    if (liveTotalEl) {
        liveTotalEl.textContent = `₹${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    const mode = document.getElementById('payment-mode')?.value;
    if (mode === 'Credit') {
        const deposit = parseFloat(document.getElementById('credit-deposit')?.value) || 0;
        const remaining = Math.max(0, total - deposit);
        const remEl = document.getElementById('remaining-credit-balance');
        if (remEl) {
            remEl.textContent = `₹${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
    }
}

function populateCustomerDatalist() {
    const datalist = document.getElementById('customer-datalist');
    if (!datalist) return;
    const uniqueNames = [...new Set(records.map(r => r.name).filter(Boolean))];
    datalist.innerHTML = uniqueNames.map(name => `<option value="${String(name).replace(/"/g, '&quot;')}">`).join('');
}

function autoFillCustomerCity() {
    const nameInput = document.getElementById('cust-name');
    const cityInput = document.getElementById('cust-city');
    if (!nameInput || !cityInput) return;

    const typedName = nameInput.value.trim().toLowerCase();
    if (!typedName) return;

    const match = records.find(r => r.name && r.name.toLowerCase() === typedName);
    if (match && match.city) {
        cityInput.value = match.city;
    }
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(40px) scale(0.9)';
        toast.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

function toggleSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
}

function openModal(id) {
    deleteTargetId = id;
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('active');
}

function closeModal() {
    deleteTargetId = null;
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.remove('active');
}

function updateStatus(message, state) {
    const textEl = document.getElementById('status-text');
    const dotEl = document.getElementById('status-dot');
    if (textEl) textEl.textContent = message;
    if (dotEl) dotEl.className = 'status-dot ' + state;
}

function checkTokenAndLoad() {
    const token = localStorage.getItem('ke_gh_token');
    const settingsPanel = document.getElementById('settings-panel');
    if (!token) {
        if (settingsPanel) settingsPanel.style.display = 'block';
        updateStatus('Disconnected', 'error');
    } else {
        if (settingsPanel) settingsPanel.style.display = 'none';
        fetchDataFromGitHub();
    }
}

function saveToken() {
    const tokenInput = document.getElementById('gh-token');
    const val = tokenInput ? tokenInput.value.trim() : '';
    if (val) {
        localStorage.setItem('ke_gh_token', val);
        checkTokenAndLoad();
        showToast('🔑 Token saved');
    } else {
        showToast('⚠️ Please enter a valid GitHub token');
    }
}

// GitHub Sync (Customer Data)
async function fetchDataFromGitHub() {
    updateStatus('Fetching', 'syncing');
    const token = localStorage.getItem('ke_gh_token');
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.raw+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            cache: 'no-store'
        });

        if (response.ok) {
            const parsed = await response.json();
            records = Array.isArray(parsed) ? parsed : [];
            updateDashboard();
            renderRecords();
            renderHoveringCities();
            populateCustomerDatalist();
            updateStatus('Synced', 'active');
        } else if (response.status === 404) {
            records = [];
            updateDashboard();
            renderRecords();
            renderHoveringCities();
            populateCustomerDatalist();
            updateStatus('Ready (New File)', 'active');
        } else {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `HTTP ${response.status}`);
        }
    } catch (e) {
        console.error('Fetch error:', e);
        updateStatus('Cloud Error', 'error');
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel) settingsPanel.style.display = 'block';
        showToast('❌ Failed to fetch: ' + (e.message || 'Check GitHub token'));
    }
}

async function pushDataToGitHub() {
    const token = localStorage.getItem('ke_gh_token');
    const saveBtn = document.getElementById('save-btn');
    if (!token) {
        const settings = document.getElementById('settings-panel');
        if (settings) {
            settings.style.display = 'block';
            settings.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        showToast('⚠️ GitHub token missing. Add your token above.');
        return false;
    }

    updateStatus('Syncing to GitHub...', 'syncing');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ Saving...';
    }

    try {
        const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const checkRes = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            cache: 'no-store'
        });

        let latestSha = null;
        if (checkRes.ok) {
            latestSha = (await checkRes.json()).sha;
        } else if (checkRes.status !== 404) {
            const err = await checkRes.json().catch(() => ({}));
            throw new Error(err.message || `GitHub read error (${checkRes.status})`);
        }

        const body = {
            message: `Save customer records (${new Date().toLocaleString()})`,
            content: encodeBase64(JSON.stringify(records, null, 2))
        };
        if (latestSha) body.sha = latestSha;

        const response = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || `GitHub save error (${response.status})`);

        fileSha = result.content?.sha || latestSha;
        updateStatus('Synced', 'active');
        showToast('✅ Saved successfully to GitHub');
        return true;
    } catch (err) {
        console.error('Save error:', err);
        updateStatus('Sync Failed', 'error');
        showToast('❌ Save failed: ' + (err.message || 'Check internet and GitHub token'));
        return false;
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            const isEditing = Boolean(document.getElementById('edit-record-id')?.value);
            saveBtn.textContent = isEditing ? '✏️ Update Record on GitHub' : '💾 Save directly to GitHub';
        }
    }
}

window.saveCustomerRecord = async function(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const form = document.getElementById('record-form');
    if (!form) return;

    if (!form.checkValidity()) {
        form.reportValidity();
        showToast('⚠️ Please complete all required fields.');
        return;
    }

    const previousRecords = records.slice();
    const editId = document.getElementById('edit-record-id')?.value || '';
    const paymentMode = document.getElementById('payment-mode')?.value || 'Cash';
    const depositAmt = paymentMode === 'Credit' ? (parseFloat(document.getElementById('credit-deposit')?.value) || 0) : 0;

    const itemList = [];
    document.querySelectorAll('.bill-item-row').forEach(row => {
        itemList.push({
            desc: row.querySelector('.item-desc')?.value.trim() || '',
            qty: parseInt(row.querySelector('.item-qty')?.value) || 1,
            price: parseFloat(row.querySelector('.item-price')?.value) || 0
        });
    });

    const recordData = {
        id: editId || Date.now().toString(),
        name: document.getElementById('cust-name')?.value.trim() || '',
        city: document.getElementById('cust-city')?.value.trim() || '',
        itemList: itemList,
        payment: paymentMode,
        deposit: depositAmt,
        date: document.getElementById('cust-date')?.value || getLocalTodayDate()
    };

    if (editId) {
        records = records.map(r => r.id === editId ? recordData : r);
    } else {
        records = [recordData, ...records];
    }

    const saved = await pushDataToGitHub();
    if (!saved) {
        records = previousRecords;
        return;
    }

    cancelEditMode();
    updateDashboard();
    renderRecords();
    renderHoveringCities();
    populateCustomerDatalist();
};

function startEditRecord(id) {
    const rec = records.find(r => r.id === id);
    if (!rec) return;

    document.getElementById('edit-record-id').value = rec.id;
    document.getElementById('cust-name').value = rec.name || '';
    document.getElementById('cust-city').value = rec.city || '';
    document.getElementById('payment-mode').value = rec.payment || 'Cash';
    document.getElementById('credit-deposit').value = rec.deposit || 0;
    document.getElementById('cust-date').value = rec.date || getLocalTodayDate();

    const wrapper = document.getElementById('bill-items-wrapper');
    wrapper.innerHTML = '';
    if (rec.itemList && rec.itemList.length > 0) {
        rec.itemList.forEach(item => addBillItemRow(item.desc, item.qty, item.price));
    } else {
        addBillItemRow('', rec.items || 1, rec.price || '');
    }

    toggleCreditFields();
    updateLiveTotal();

    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.textContent = '✏️ Update Record on GitHub';
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';

    document.getElementById('record-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(`✏️ Editing ${rec.name || 'Record'}`);
}

function cancelEditMode() {
    const form = document.getElementById('record-form');
    if (form) form.reset();

    const editIdEl = document.getElementById('edit-record-id');
    if (editIdEl) editIdEl.value = '';

    const wrapper = document.getElementById('bill-items-wrapper');
    if (wrapper) {
        wrapper.innerHTML = '';
        addBillItemRow();
    }

    const paymentEl = document.getElementById('payment-mode');
    if (paymentEl) paymentEl.value = 'Cash';
    toggleCreditFields();

    const dateEl = document.getElementById('cust-date');
    if (dateEl) dateEl.value = getLocalTodayDate();
    updateLiveTotal();

    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.textContent = '💾 Save directly to GitHub';

    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';

    updateDashboard();
}

// Search & Filtering
function handleSearchInput() {
    const searchBar = document.getElementById('search-bar');
    const query = searchBar ? searchBar.value.trim().toLowerCase() : '';
    renderRecords();
    renderHoveringCities();

    const dropdown = document.getElementById('search-suggestions');
    if (!dropdown) return;

    if (!query) {
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
        return;
    }

    const seen = new Set();
    const matchList = [];
    records.forEach(r => {
        if (r.name && r.name.toLowerCase().includes(query) && !seen.has('n:' + r.name.toLowerCase())) {
            seen.add('n:' + r.name.toLowerCase());
            matchList.push({ type: '👤 Customer', text: r.name });
        }
        if (r.city && r.city.toLowerCase().includes(query) && !seen.has('c:' + r.city.toLowerCase())) {
            seen.add('c:' + r.city.toLowerCase());
            matchList.push({ type: '🏙️ City', text: r.city });
        }
    });

    const topMatches = matchList.slice(0, 5);
    if (topMatches.length > 0) {
        dropdown.innerHTML = topMatches.map(m => `
            <div class="suggestion-item" onclick="selectSuggestion('${m.text.replace(/'/g, "\\'")}')">
                <span>${m.text}</span>
                <span style="font-size: 0.75rem; font-weight: 800; color: var(--text-muted);">${m.type}</span>
            </div>
        `).join('');
        dropdown.classList.add('active');
    } else {
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
    }
}

function selectSuggestion(val) {
    const searchBar = document.getElementById('search-bar');
    if (searchBar) searchBar.value = val;
    const dropdown = document.getElementById('search-suggestions');
    if (dropdown) dropdown.classList.remove('active');
    renderRecords();
    renderHoveringCities();
}

function renderHoveringCities() {
    const container = document.getElementById('hovering-cities');
    if (!container) return;

    const currentQuery = document.getElementById('search-bar')?.value.trim().toLowerCase() || '';
    const citiesMap = {};

    records.forEach(r => {
        if (r.city) {
            const cityName = r.city.trim();
            const key = cityName.toLowerCase();
            if (!citiesMap[key]) citiesMap[key] = { name: cityName, count: 0 };
            citiesMap[key].count++;
        }
    });

    const uniqueCities = Object.values(citiesMap);
    if (uniqueCities.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="city-hover-pill ${currentQuery === '' ? 'active' : ''}" onclick="filterByCity('')">
            🌐 All Cities
        </div>
    ` + uniqueCities.map(c => `
        <div class="city-hover-pill ${currentQuery === c.name.toLowerCase() ? 'active' : ''}" onclick="filterByCity('${c.name.replace(/'/g, "\\'")}')">
            📍 ${c.name} <span style="opacity: 0.6; font-size: 0.7rem;">(${c.count})</span>
        </div>
    `).join('');
}

function filterByCity(cityName) {
    const searchBar = document.getElementById('search-bar');
    if (searchBar) searchBar.value = cityName;
    const dropdown = document.getElementById('search-suggestions');
    if (dropdown) dropdown.classList.remove('active');
    renderRecords();
    renderHoveringCities();
}

function renderRecords() {
    const rawQuery = document.getElementById('search-bar')?.value.trim().toLowerCase() || '';
    const paymentFilter = document.getElementById('filter-payment')?.value || 'all';
    const container = document.getElementById('records-container');
    if (!container) return;

    container.innerHTML = '';

    const filtered = records.filter(r => {
        const totals = getRecordTotals(r);
        const paymentMode = (r.payment || 'Cash').toLowerCase();
        const deposit = r.deposit || 0;
        const remaining = Math.max(0, totals.bill - deposit);

        const matchesQuery = !rawQuery ||
            (r.name && r.name.toLowerCase().includes(rawQuery)) ||
            (r.city && r.city.toLowerCase().includes(rawQuery)) ||
            paymentMode.includes(rawQuery) ||
            ((rawQuery === 'udhar' || rawQuery === 'credit') && paymentMode === 'credit') ||
            ((rawQuery === 'pending' || rawQuery === 'balance') && remaining > 0);

        if (!matchesQuery) return false;
        if (paymentFilter === 'Cash' && paymentMode !== 'cash') return false;
        if (paymentFilter === 'UPI' && paymentMode !== 'upi') return false;
        if (paymentFilter === 'Credit' && paymentMode !== 'credit') return false;
        if (paymentFilter === 'PendingCredit' && (paymentMode !== 'credit' || remaining <= 0)) return false;

        return true;
    });

    filtered.sort((a, b) => (b.date || '').localeCompare(a.date || '') || Number(b.id) - Number(a.id));

    const showingCount = document.getElementById('showing-count');
    if (showingCount) showingCount.textContent = `📊 ${filtered.length} records`;

    if (filtered.length === 0) {
        container.innerHTML = `<div class="card-3d card" style="text-align: center; color: var(--text-muted); padding: 40px; font-weight: 700;">No matching records found</div>`;
        return;
    }

    filtered.forEach(r => {
        const totals = getRecordTotals(r);
        const payment = r.payment || 'Cash';
        const deposit = r.deposit || 0;
        const remaining = Math.max(0, totals.bill - deposit);
        const [y, m, d] = r.date ? r.date.split('-') : ['--', '--', '--'];
        const safeCity = (r.city && r.city.trim()) ? r.city.trim() : 'N/A';
        const safeName = (r.name && r.name.trim()) ? r.name.trim() : 'Unknown';

        let paymentText = payment;
        if (payment === 'Cash') paymentText = '💵 Cash';
        else if (payment === 'UPI') paymentText = '📱 UPI';
        else if (payment === 'Credit') {
            paymentText = `📒 Credit (Paid: ₹${deposit.toFixed(2)} | Bal: ₹${remaining.toFixed(2)})`;
        }

        let itemsHtml = '';
        if (r.itemList && r.itemList.length > 0) {
            itemsHtml = r.itemList.map(i => `
                <div class="record-item-line">
                    <span class="record-item-name">${i.desc || 'Item'} <span class="record-item-qty">(x${i.qty} @ ₹${Number(i.price).toFixed(2)})</span></span>
                    <span class="record-item-price">₹${(i.qty * i.price).toFixed(2)}</span>
                </div>
            `).join('');
        } else {
            itemsHtml = `
                <div class="record-item-line">
                    <span class="record-item-name">Legacy Record <span class="record-item-qty">(x${r.items || 1} @ ₹${Number(r.price || 0).toFixed(2)})</span></span>
                    <span class="record-item-price">₹${(Number(r.price || 0) * (r.items || 1)).toFixed(2)}</span>
                </div>
            `;
        }

        const card = document.createElement('div');
        card.className = 'card-3d record-card';
        card.innerHTML = `
            <div class="record-header">
                <span class="record-date">📅 ${d}/${m}/${y}</span>
                <div class="record-header-meta">
                    <span class="badge record-city" onclick="filterByCity('${safeCity.replace(/'/g, "\\'")}')">📍 ${safeCity}</span>
                    <span class="record-payment">${paymentText}</span>
                </div>
                <div class="record-actions">
                    <button type="button" class="btn-icon edit" onclick="startEditRecord('${r.id}')" title="Edit Record" aria-label="Edit Record">✏️</button>
                    <button type="button" class="btn-icon" onclick="openModal('${r.id}')" title="Delete" aria-label="Delete Record">🗑️</button>
                </div>
            </div>
            <div class="record-name">👤 ${safeName}</div>
            <div class="record-items-panel">
                <div class="record-items-title">🛒 Items List</div>
                ${itemsHtml}
            </div>
            <div class="record-details">
                <div class="record-calc">📦 Total Qty: ${totals.qty}</div>
                <div class="record-total">₹${Number(totals.bill).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
        `;
        container.appendChild(card);
    });
}

function updateDashboard() {
    const selectedDate = document.getElementById('cust-date')?.value || '';
    let daySale = 0, totalItems = 0, cities = new Set();
    const yearMap = {};

    records.forEach(r => {
        const totals = getRecordTotals(r);
        const realizedSale = (r.payment === 'Credit') ? (r.deposit || 0) : totals.bill;

        if (r.date === selectedDate) {
            daySale += realizedSale;
        }
        totalItems += totals.qty;
        if (r.city) cities.add(r.city.toLowerCase());

        const year = r.date ? r.date.split('-')[0] : 'Unknown';
        if (!yearMap[year]) yearMap[year] = { sale: 0, count: 0, items: 0 };
        yearMap[year].sale += realizedSale;
        yearMap[year].count += 1;
        yearMap[year].items += totals.qty;
    });

    const dayLabelEl = document.getElementById('stat-day-label');
    if (dayLabelEl) {
        if (selectedDate) {
            const [y, m, d] = selectedDate.split('-');
            dayLabelEl.textContent = `📈 Sale (${d}/${m})`;
        } else {
            dayLabelEl.textContent = '📈 Day Sale';
        }
    }

    const daySaleEl = document.getElementById('stat-day-sale');
    if (daySaleEl) daySaleEl.textContent = `₹${daySale.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const recordsEl = document.getElementById('stat-records');
    if (recordsEl) recordsEl.textContent = records.length;

    const itemsEl = document.getElementById('stat-items');
    if (itemsEl) itemsEl.textContent = totalItems;

    const citiesEl = document.getElementById('stat-cities');
    if (citiesEl) citiesEl.textContent = cities.size;

    renderYearSummary(yearMap);
}

function renderYearSummary(yearMap) {
    const container = document.getElementById('year-summary-container');
    if (!container) return;

    container.innerHTML = '';
    const sortedYears = Object.keys(yearMap).sort((a, b) => b.localeCompare(a));

    if (sortedYears.length === 0) {
        container.innerHTML = `<div class="card-3d year-card" style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); font-weight: 700;">No year data available</div>`;
        return;
    }

    sortedYears.forEach(year => {
        const data = yearMap[year];
        const card = document.createElement('div');
        card.className = 'card-3d year-card';
        card.innerHTML = `
            <div class="year-card-title">
                <span>📅 ${year}</span>
                <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">${data.count} records</span>
            </div>
            <div class="year-card-total">₹${data.sale.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">📦 ${data.items} items sold</div>
        `;
        container.appendChild(card);
    });
}
