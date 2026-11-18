// --- STATE & STORAGE ---
const STORAGE_KEY = 'kabir_emporium_customers_v1';
const GH_CONFIG_KEY = 'kabir_emporium_gh_config';

let entries = [];
let isSaving = false;
let pendingSave = false;
let currentEditingId = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('cust-date');
  if (dateInput) dateInput.value = today;

  loadLocalRecords();
  initBillItemRow();
  renderRecords();
  updateDashboard();
  fetchFromGitHub(false);

  // Form submit handler
  const form = document.getElementById('record-form');
  if (form) {
    form.addEventListener('submit', handleFormSubmit);
  }
});

function loadLocalRecords() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      entries = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Error loading local storage:', e);
    entries = [];
  }
}

function saveLocalRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// --- GITHUB CONFIG & SYNC ---
function getGHConfig() {
  const saved = JSON.parse(localStorage.getItem(GH_CONFIG_KEY) || '{}');
  const legacyToken = localStorage.getItem('github_token') || localStorage.getItem('gh_token') || localStorage.getItem('token') || '';
  return {
    owner: (saved.owner || 'playtv02').trim(),
    repo: (saved.repo || 'Customer-directory').trim(),
    path: (saved.path || 'data.json').trim(),
    token: (saved.token || legacyToken).trim()
  };
}

function toggleSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') {
    const cfg = getGHConfig();
    const tokenInput = document.getElementById('gh-token');
    if (tokenInput) tokenInput.value = cfg.token;
  }
}

function saveToken() {
  const tokenInput = document.getElementById('gh-token');
  if (!tokenInput) return;
  const token = tokenInput.value.trim();

  const cfg = getGHConfig();
  cfg.token = token;
  localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(cfg));

  toggleSettingsPanel();
  showToast('Token saved successfully!');
  fetchFromGitHub(true);
}

function setSyncStatus(status, text) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (dot) dot.className = `status-dot ${status}`;
  if (txt) txt.textContent = text;
}

// --- SAFE UTF-8 BASE64 ENCODER / DECODER (Prevents btoa/Unicode crashes) ---
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUtf8(base64) {
  const clean = base64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// --- FETCH FROM GITHUB ---
async function fetchFromGitHub(manual = false) {
  const cfg = getGHConfig();
  if (!cfg.token) {
    setSyncStatus('error', 'No Token');
    if (manual) showToast('Please add GitHub token in settings.');
    return;
  }

  setSyncStatus('syncing', 'Syncing...');
  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?t=${Date.now()}`;

  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${cfg.token}`
    };

    const res = await fetch(apiUrl, { headers, cache: 'no-store' });
    if (res.status === 404) {
      setSyncStatus('active', 'Ready (New File)');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const fileData = await res.json();
    const decodedText = base64ToUtf8(fileData.content || 'W10=');
    const parsed = JSON.parse(decodedText);

    if (Array.isArray(parsed)) {
      entries = parsed;
      saveLocalRecords();
      renderRecords();
      updateDashboard();
      setSyncStatus('active', 'Synced');
      if (manual) showToast('Data loaded from GitHub!');
    }
  } catch (err) {
    console.error('Fetch error:', err);
    setSyncStatus('error', 'Sync Failed');
    if (manual) showToast('Sync failed: ' + err.message);
  }
}

// --- RELIABLE SAVE TO GITHUB WITH SHA AUTO-RETRY ---
async function syncToGitHub(retryCount = 0) {
  const cfg = getGHConfig();
  if (!cfg.token) {
    setSyncStatus('error', 'Local Only');
    showToast('Saved locally. Add GitHub token to sync online.');
    return;
  }

  if (isSaving) {
    pendingSave = true;
    return;
  }

  isSaving = true;
  setSyncStatus('syncing', 'Saving...');

  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `Bearer ${cfg.token}`,
    'Content-Type': 'application/json'
  };

  try {
    // 1. Fetch latest SHA with cache-busting right before PUT
    let latestSha = null;
    const getRes = await fetch(`${apiUrl}?t=${Date.now()}`, {
      method: 'GET',
      headers,
      cache: 'no-store'
    });

    if (getRes.ok) {
      const json = await getRes.json();
      latestSha = json.sha;
    } else if (getRes.status !== 404) {
      const errJson = await getRes.json().catch(() => ({}));
      throw new Error(errJson.message || `Failed to fetch SHA (${getRes.status})`);
    }

    // 2. Prepare PUT payload
    const contentStr = JSON.stringify(entries, null, 2);
    const bodyPayload = {
      message: `Save customer records (${new Date().toLocaleString('en-IN')})`,
      content: utf8ToBase64(contentStr)
    };
    if (latestSha) {
      bodyPayload.sha = latestSha;
    }

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(bodyPayload)
    });

    // 3. Auto-retry on 409 Conflict or 422 SHA mismatch up to 3 times
    if ((putRes.status === 409 || putRes.status === 422) && retryCount < 3) {
      isSaving = false;
      await new Promise(r => setTimeout(r, 600 * (retryCount + 1)));
      return syncToGitHub(retryCount + 1);
    }

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${putRes.status}`);
    }

    setSyncStatus('active', 'Synced ✓');
    showToast('Saved & Synced to GitHub!');
  } catch (err) {
    console.error('Save error:', err);
    setSyncStatus('error', 'Save Error');
    showToast('GitHub Save Error: ' + err.message);
  } finally {
    isSaving = false;
    if (pendingSave) {
      pendingSave = false;
      syncToGitHub(0);
    }
  }
}

// --- MULTI-ITEM BILLING & FORM LOGIC ---
function initBillItemRow() {
  const wrapper = document.getElementById('bill-items-wrapper');
  if (wrapper && wrapper.children.length === 0) {
    addBillItemRow();
  }
}

function addBillItemRow(name = '', qty = 1, price = '') {
  const wrapper = document.getElementById('bill-items-wrapper');
  if (!wrapper) return;

  const row = document.createElement('div');
  row.className = 'bill-item-row';
  row.style.cssText = 'display: grid; grid-template-columns: 2fr 1fr 1.2fr auto; gap: 8px; align-items: center;';
  
  row.innerHTML = `
    <input type="text" class="form-control item-name" placeholder="Item Name" value="${escapeHtml(name)}" required oninput="updateLiveTotal()">
    <input type="number" class="form-control item-qty" placeholder="Qty" value="${qty}" min="1" step="any" required oninput="updateLiveTotal()">
    <input type="number" class="form-control item-price" placeholder="Price (₹)" value="${price}" min="0" step="any" required oninput="updateLiveTotal()">
    <button type="button" class="btn-icon" onclick="removeBillItemRow(this)" title="Remove item">❌</button>
  `;
  wrapper.appendChild(row);
  updateLiveTotal();
}

function removeBillItemRow(btn) {
  const wrapper = document.getElementById('bill-items-wrapper');
  if (wrapper && wrapper.children.length > 1) {
    btn.closest('.bill-item-row').remove();
    updateLiveTotal();
  } else {
    showToast('At least one item is required.');
  }
}

function toggleCreditFields() {
  const mode = document.getElementById('payment-mode').value;
  const container = document.getElementById('credit-container');
  if (container) {
    container.style.display = mode === 'Credit' ? 'block' : 'none';
  }
  updateLiveTotal();
}

function updateLiveTotal() {
  const rows = document.querySelectorAll('.bill-item-row');
  let total = 0;
  rows.forEach(row => {
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    total += qty * price;
  });

  const mode = document.getElementById('payment-mode')?.value;
  if (mode === 'Credit') {
    const deposit = parseFloat(document.getElementById('credit-deposit')?.value) || 0;
    const remaining = Math.max(0, total - deposit);
    const remEl = document.getElementById('remaining-credit-balance');
    if (remEl) remEl.textContent = '₹' + remaining.toFixed(2);
  }

  const liveTotalEl = document.getElementById('live-bill-total');
  if (liveTotalEl) liveTotalEl.textContent = '₹' + total.toFixed(2);
}

function handleFormSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('cust-name').value.trim();
  const city = document.getElementById('cust-city').value.trim();
  const paymentMode = document.getElementById('payment-mode').value;
  const date = document.getElementById('cust-date').value;

  const rows = document.querySelectorAll('.bill-item-row');
  const items = [];
  let totalAmount = 0;

  rows.forEach(row => {
    const itemName = row.querySelector('.item-name').value.trim();
    const qty = parseFloat(row.querySelector('.item-qty').value) || 1;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const subtotal = qty * price;
    totalAmount += subtotal;
    if (itemName) {
      items.push({ name: itemName, qty, price, subtotal });
    }
  });

  if (items.length === 0) {
    showToast('Please add at least one valid item.');
    return;
  }

  let deposit = 0;
  let remainingCredit = 0;
  if (paymentMode === 'Credit') {
    deposit = parseFloat(document.getElementById('credit-deposit').value) || 0;
    remainingCredit = Math.max(0, totalAmount - deposit);
  }

  const editId = document.getElementById('edit-record-id').value;

  if (editId) {
    const idx = entries.findIndex(r => String(r.id) === String(editId));
    if (idx > -1) {
      entries[idx] = {
        ...entries[idx],
        name,
        city,
        paymentMode,
        date,
        items,
        totalAmount,
        deposit,
        remainingCredit,
        updatedAt: Date.now()
      };
    }
    showToast('Record updated successfully!');
  } else {
    const newRecord = {
      id: Date.now().toString(),
      name,
      city,
      paymentMode,
      date,
      items,
      totalAmount,
      deposit,
      remainingCredit,
      createdAt: Date.now()
    };
    entries.unshift(newRecord);
    showToast('New record added successfully!');
  }

  saveLocalRecords();
  resetForm();
  renderRecords();
  updateDashboard();
  syncToGitHub();
}

function resetForm() {
  const form = document.getElementById('record-form');
  if (form) form.reset();
  document.getElementById('edit-record-id').value = '';
  document.getElementById('cust-date').value = new Date().toISOString().split('T')[0];
  
  const wrapper = document.getElementById('bill-items-wrapper');
  if (wrapper) wrapper.innerHTML = '';
  addBillItemRow();

  toggleCreditFields();
  document.getElementById('save-btn').textContent = '💾 SUBMIT';
  document.getElementById('cancel-edit-btn').style.display = 'none';
  currentEditingId = null;
}

function cancelEditMode() {
  resetForm();
  showToast('Editing cancelled.');
}

function editRecord(id) {
  const record = entries.find(r => String(r.id) === String(id));
  if (!record) return;

  document.getElementById('edit-record-id').value = record.id;
  document.getElementById('cust-name').value = record.name || '';
  document.getElementById('cust-city').value = record.city || '';
  document.getElementById('payment-mode').value = record.paymentMode || 'Cash';
  document.getElementById('cust-date').value = record.date || new Date().toISOString().split('T')[0];

  toggleCreditFields();
  if (record.paymentMode === 'Credit') {
    document.getElementById('credit-deposit').value = record.deposit || 0;
  }

  const wrapper = document.getElementById('bill-items-wrapper');
  if (wrapper) {
    wrapper.innerHTML = '';
    if (record.items && record.items.length > 0) {
      record.items.forEach(item => {
        addBillItemRow(item.name, item.qty, item.price);
      });
    } else {
      addBillItemRow();
    }
  }

  document.getElementById('save-btn').textContent = '💾 UPDATE RECORD';
  document.getElementById('cancel-edit-btn').style.display = 'block';
  currentEditingId = record.id;

  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('Loaded record for editing.');
}

// --- DELETE WITH MODAL ---
let recordToDeleteId = null;

function promptDelete(id) {
  recordToDeleteId = id;
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.add('active');
}

function closeModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.remove('active');
  recordToDeleteId = null;
}

document.addEventListener('DOMContentLoaded', () => {
  const confirmBtn = document.getElementById('confirm-delete-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (recordToDeleteId) {
        entries = entries.filter(r => String(r.id) !== String(recordToDeleteId));
        saveLocalRecords();
        renderRecords();
        updateDashboard();
        syncToGitHub();
        showToast('Record deleted.');
      }
      closeModal();
    });
  }
});

// --- DASHBOARD & STATISTICS ---
function updateDashboard() {
  const todayDateStr = new Date().toISOString().split('T')[0];
  let daySale = 0;
  let totalItemsCount = 0;
  const citiesSet = new Set();

  entries.forEach(r => {
    if (r.date === todayDateStr) {
      daySale += parseFloat(r.totalAmount) || 0;
    }
    if (r.city) citiesSet.add(r.city.trim().toLowerCase());
    if (r.items) {
      r.items.forEach(i => {
        totalItemsCount += parseFloat(i.qty) || 0;
      });
    }
  });

  const daySaleEl = document.getElementById('stat-day-sale');
  const recordsEl = document.getElementById('stat-records');
  const itemsEl = document.getElementById('stat-items');
  const citiesEl = document.getElementById('stat-cities');
  const bannerYearEl = document.getElementById('banner-year');

  if (daySaleEl) daySaleEl.textContent = '₹' + daySale.toFixed(2);
  if (recordsEl) recordsEl.textContent = entries.length;
  if (itemsEl) itemsEl.textContent = totalItemsCount;
  if (citiesEl) citiesEl.textContent = citiesSet.size;
  if (bannerYearEl) bannerYearEl.textContent = new Date().getFullYear();

  renderYearSummary();
  renderHoveringCities();
  updateCustomerDatalist();
}

function renderYearSummary() {
  const container = document.getElementById('year-summary-container');
  if (!container) return;

  const yearMap = {};
  entries.forEach(r => {
    if (!r.date) return;
    const year = r.date.split('-')[0];
    if (!yearMap[year]) yearMap[year] = 0;
    yearMap[year] += parseFloat(r.totalAmount) || 0;
  });

  const years = Object.keys(yearMap).sort().reverse();
  if (years.length === 0) {
    container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color: var(--text-muted); font-size:0.85rem;">No fiscal years recorded yet.</div>';
    return;
  }

  container.innerHTML = years.map(yr => `
    <div class="card-3d year-card">
      <div class="year-card-title">📅 Year ${yr}</div>
      <div class="year-card-total">₹${yearMap[yr].toFixed(2)}</div>
    </div>
  `).join('');
}

function renderHoveringCities() {
  const container = document.getElementById('hovering-cities');
  if (!container) return;

  const cityMap = {};
  entries.forEach(r => {
    if (r.city) {
      const c = r.city.trim();
      cityMap[c] = (cityMap[c] || 0) + 1;
    }
  });

  const cities = Object.keys(cityMap).sort();
  if (cities.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = `<div class="city-hover-pill active" onclick="filterByCity('')">🌍 All Cities</div>`;
  html += cities.map(c => `
    <div class="city-hover-pill" onclick="filterByCity('${escapeHtml(c)}')">📍 ${escapeHtml(c)} (${cityMap[c]})</div>
  `).join('');
  container.innerHTML = html;
}

let activeCityFilter = '';
function filterByCity(cityName) {
  activeCityFilter = cityName;
  document.querySelectorAll('.city-hover-pill').forEach(pill => {
    if (cityName === '' && pill.textContent.includes('All Cities')) {
      pill.classList.add('active');
    } else if (pill.textContent.includes(cityName)) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
  renderRecords();
}

function updateCustomerDatalist() {
  const datalist = document.getElementById('customer-datalist');
  if (!datalist) return;
  const uniqueNames = [...new Set(entries.map(r => r.name).filter(Boolean))];
  datalist.innerHTML = uniqueNames.map(n => `<option value="${escapeHtml(n)}">`).join('');
}

function autoFillCustomerCity() {
  const nameInput = document.getElementById('cust-name');
  const cityInput = document.getElementById('cust-city');
  if (!nameInput || !cityInput) return;

  const val = nameInput.value.trim().toLowerCase();
  const match = entries.find(r => r.name && r.name.trim().toLowerCase() === val);
  if (match && match.city) {
    cityInput.value = match.city;
  }
}

// --- RENDER & SEARCH RECORDS ---
function handleSearchInput() {
  renderRecords();
  updateSearchSuggestions();
}

function updateSearchSuggestions() {
  const searchBar = document.getElementById('search-bar');
  const dropdown = document.getElementById('search-suggestions');
  if (!searchBar || !dropdown) return;

  const q = searchBar.value.trim().toLowerCase();
  if (!q || q.length < 2) {
    dropdown.classList.remove('active');
    return;
  }

  const matches = [];
  entries.forEach(r => {
    if (r.name && r.name.toLowerCase().includes(q) && !matches.includes(r.name)) matches.push(r.name);
    if (r.city && r.city.toLowerCase().includes(q) && !matches.includes(r.city)) matches.push(r.city);
  });

  if (matches.length === 0) {
    dropdown.classList.remove('active');
    return;
  }

  dropdown.innerHTML = matches.slice(0, 5).map(m => `
    <div class="suggestion-item" onclick="selectSuggestion('${escapeHtml(m)}')">
      <span>🔍 ${escapeHtml(m)}</span>
    </div>
  `).join('');
  dropdown.classList.add('active');
}

function selectSuggestion(val) {
  const searchBar = document.getElementById('search-bar');
  const dropdown = document.getElementById('search-suggestions');
  if (searchBar) searchBar.value = val;
  if (dropdown) dropdown.classList.remove('active');
  renderRecords();
}

function renderRecords() {
  const container = document.getElementById('records-container');
  const countEl = document.getElementById('showing-count');
  const searchBar = document.getElementById('search-bar');
  const paymentFilter = document.getElementById('filter-payment');

  if (!container) return;

  const query = searchBar ? searchBar.value.trim().toLowerCase() : '';
  const filterVal = paymentFilter ? paymentFilter.value : 'all';

  let filtered = entries.filter(r => {
    if (activeCityFilter && (!r.city || r.city.trim().toLowerCase() !== activeCityFilter.toLowerCase())) {
      return false;
    }
    if (filterVal === 'Cash' && r.paymentMode !== 'Cash') return false;
    if (filterVal === 'UPI' && r.paymentMode !== 'UPI') return false;
    if (filterVal === 'Credit' && r.paymentMode !== 'Credit') return false;
    if (filterVal === 'PendingCredit' && (r.paymentMode !== 'Credit' || (parseFloat(r.remainingCredit) || 0) <= 0)) return false;

    if (query) {
      const matchName = r.name && r.name.toLowerCase().includes(query);
      const matchCity = r.city && r.city.toLowerCase().includes(query);
      const matchMode = r.paymentMode && r.paymentMode.toLowerCase().includes(query);
      const matchItem = r.items && r.items.some(i => i.name.toLowerCase().includes(query));
      if (!matchName && !matchCity && !matchMode && !matchItem) return false;
    }

    return true;
  });

  if (countEl) countEl.textContent = `📊 Showing ${filtered.length} of ${entries.length} records`;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="card-3d" style="padding:32px; text-align:center; color:var(--text-muted);">No matching sale records found.</div>';
    return;
  }

  container.innerHTML = filtered.map(r => {
    const itemsHtml = r.items && r.items.length > 0 ? `
      <div class="record-items-panel">
        <div class="record-items-title">Purchased Items</div>
        ${r.items.map(i => `
          <div class="record-item-line">
            <span class="record-item-name">${escapeHtml(i.name)}</span>
            <span class="record-item-qty">Qty: ${i.qty} × ₹${i.price}</span>
            <span class="record-item-price">₹${(i.subtotal || (i.qty * i.price)).toFixed(2)}</span>
          </div>
        `).join('')}
      </div>
    ` : '';

    const creditBadge = r.paymentMode === 'Credit' ? `
      <div style="margin-top:8px; font-size:0.75rem; font-weight:700; color:var(--danger);">
        📌 Deposit: ₹${parseFloat(r.deposit || 0).toFixed(2)} | Remaining: ₹${parseFloat(r.remainingCredit || 0).toFixed(2)}
      </div>
    ` : '';

    return `
      <div class="card-3d record-card">
        <div class="record-header">
          <div class="record-date">${escapeHtml(r.date)}</div>
          <div class="record-header-meta">
            <span class="badge record-city" onclick="filterByCity('${escapeHtml(r.city)}')">📍 ${escapeHtml(r.city)}</span>
            <span class="badge record-payment">${escapeHtml(r.paymentMode)}</span>
          </div>
          <div class="record-actions">
            <button class="btn-icon edit" onclick="editRecord('${r.id}')" title="Edit record">✏️</button>
            <button class="btn-icon" onclick="promptDelete('${r.id}')" title="Delete record">🗑️</button>
          </div>
        </div>

        <div class="record-name">${escapeHtml(r.name)}</div>
        ${itemsHtml}
        ${creditBadge}

        <div class="record-details">
          <span class="record-calc">${r.items ? r.items.length : 1} item(s) total</span>
          <span class="record-total">₹${parseFloat(r.totalAmount || 0).toFixed(2)}</span>
        </div>
      </div>
    `;
  }).join('');
}

// --- UTILS & TOASTS ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px) scale(0.9)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}
