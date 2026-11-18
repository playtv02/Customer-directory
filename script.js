const GITHUB_OWNER = 'playtv02';
const GITHUB_REPO = 'Customer-directory';
const FILE_PATH = 'data.json';

let records = [];
let fileSha = null;
let deleteTargetId = null;

function getRecordTotals(r) {
  if (r.itemList && r.itemList.length > 0) {
    let bill = 0, qty = 0;
    r.itemList.forEach(i => {
      bill += (i.qty * i.price);
      qty += i.qty;
    });
    return { bill, qty };
  }
  return { bill: r.totalBill || 0, qty: r.totalQty || 0 };
}

function getLocalTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addBillItemRow(item = {}) {
  const container = document.getElementById('bill-items-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'bill-item-row flex gap-2 items-center mb-2';
  div.innerHTML = `
    <input type="text" class="item-name border p-2 rounded flex-1 dark:bg-gray-700 dark:text-white" placeholder="Item Name" value="${item.name || ''}" required>
    <input type="number" class="item-qty border p-2 rounded w-20 dark:bg-gray-700 dark:text-white" placeholder="Qty" value="${item.qty !== undefined ? item.qty : ''}" min="1" oninput="updateLiveTotal()">
    <input type="number" class="item-price border p-2 rounded w-24 dark:bg-gray-700 dark:text-white" placeholder="Price" value="${item.price !== undefined ? item.price : ''}" min="0" step="0.01" oninput="updateLiveTotal()">
    <button type="button" onclick="removeBillItemRow(this)" class="text-red-500 hover:text-red-700 px-2 font-bold">X</button>
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

function checkBankHoliday() {
  const dateInput = document.getElementById('cust-date');
  const warning = document.getElementById('holiday-warning');
  if (!dateInput || !warning) return;
  const d = new Date(dateInput.value);
  if (!isNaN(d.getTime())) {
    const day = d.getDay();
    if (day === 0) {
      warning.classList.remove('hidden');
      return;
    }
  }
  warning.classList.add('hidden');
}

function updateLiveTotal() {
  const rows = document.querySelectorAll('.bill-item-row');
  let totalBill = 0;
  let totalQty = 0;
  rows.forEach(row => {
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    totalBill += (qty * price);
    totalQty += qty;
  });
  const totalBillEl = document.getElementById('live-total-bill');
  const totalQtyEl = document.getElementById('live-total-qty');
  if (totalBillEl) totalBillEl.textContent = totalBill.toFixed(2);
  if (totalQtyEl) totalQtyEl.textContent = totalQty;
}

function toggleCreditFields() {
  const paymentType = document.getElementById('cust-payment-type');
  const creditFields = document.getElementById('credit-fields');
  if (paymentType && creditFields) {
    if (paymentType.value === 'Credit') {
      creditFields.classList.remove('hidden');
    } else {
      creditFields.classList.add('hidden');
    }
  }
}

function populateCustomerDatalist() {
  const datalist = document.getElementById('customer-names-list');
  if (!datalist) return;
  datalist.innerHTML = '';
  const names = [...new Set(records.map(r => r.name).filter(Boolean))];
  names.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    datalist.appendChild(opt);
  });
}

function autoFillCustomerCity() {
  const nameInput = document.getElementById('cust-name');
  const cityInput = document.getElementById('cust-city');
  if (!nameInput || !cityInput) return;
  const match = records.find(r => r.name && r.name.toLowerCase() === nameInput.value.toLowerCase().trim());
  if (match && match.city) {
    cityInput.value = match.city;
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded shadow-lg text-white z-50 ${type === 'error' ? 'bg-red-600' : 'bg-green-600'}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function toggleSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.classList.toggle('hidden');
}

function openModal() {
  const modal = document.getElementById('record-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeModal() {
  const modal = document.getElementById('record-modal');
  if (modal) modal.classList.add('hidden');
  cancelEditMode();
}

function updateStatus(msg, type = 'info') {
  const el = document.getElementById('status-message');
  if (el) {
    el.textContent = msg;
    el.className = `text-sm font-medium ${type === 'error' ? 'text-red-500' : 'text-green-500'}`;
  }
}

function saveToken() {
  const tokenInput = document.getElementById('github-token');
  if (tokenInput && tokenInput.value) {
    localStorage.setItem('gh_pat', tokenInput.value.trim());
    showToast('Token saved successfully');
    checkTokenAndLoad();
  }
}

function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function decodeBase64(str) {
  return decodeURIComponent(escape(atob(str.replace(/\s/g, ''))));
}

async function checkTokenAndLoad() {
  await loadData();
  await loadEmployees();
}

async function fetchDataFromGitHub() {
  await loadData();
}

async function pushDataToGitHub(data, commitMsg = 'Update customer records') {
  const token = localStorage.getItem('gh_pat');
  if (!token) {
    showToast('GitHub token missing. Please set token in settings.', 'error');
    return false;
  }
  try {
    const getRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`, {
      headers: { 'Authorization': `token ${token}` }
    });
    let sha = null;
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }
    const content = encodeBase64(JSON.stringify(data, null, 2));
    const putBody = {
      message: commitMsg,
      content: content
    };
    if (sha) putBody.sha = sha;
    const putRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(putBody)
    });
    if (putRes.ok) {
      showToast('Saved to GitHub successfully');
      return true;
    } else {
      const err = await putRes.json();
      showToast(`GitHub save failed: ${err.message}`, 'error');
      return false;
    }
  } catch (e) {
    showToast(`Error saving to GitHub: ${e.message}`, 'error');
    return false;
  }
}

async function saveCustomerRecord(e) {
  if (e) e.preventDefault();
  const idInput = document.getElementById('edit-record-id');
  const nameInput = document.getElementById('cust-name');
  const cityInput = document.getElementById('cust-city');
  const dateInput = document.getElementById('cust-date');
  const paymentTypeInput = document.getElementById('cust-payment-type');
  const creditDaysInput = document.getElementById('credit-days');
  const isPaidInput = document.getElementById('cust-is-paid');

  const rows = document.querySelectorAll('.bill-item-row');
  const itemList = [];
  rows.forEach(row => {
    const name = row.querySelector('.item-name').value.trim();
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    if (name) {
      itemList.push({ name, qty, price });
    }
  });

  const totals = itemList.reduce((acc, i) => {
    acc.bill += (i.qty * i.price);
    acc.qty += i.qty;
    return acc;
  }, { bill: 0, qty: 0 });

  const recordId = idInput && idInput.value ? parseInt(idInput.value) : Date.now();

  const newRecord = {
    id: recordId,
    name: nameInput ? nameInput.value.trim() : '',
    city: cityInput ? cityInput.value.trim() : '',
    date: dateInput ? dateInput.value : getLocalTodayDate(),
    paymentType: paymentTypeInput ? paymentTypeInput.value : 'Cash',
    creditDays: paymentTypeInput && paymentTypeInput.value === 'Credit' ? (parseInt(creditDaysInput.value) || 0) : 0,
    isPaid: isPaidInput ? isPaidInput.checked : false,
    itemList: itemList,
    totalBill: totals.bill,
    totalQty: totals.qty
  };

  const existingIndex = records.findIndex(r => r.id === recordId);
  if (existingIndex >= 0) {
    records[existingIndex] = newRecord;
  } else {
    records.push(newRecord);
  }

  renderRecords();
  closeModal();
  await pushDataToGitHub(records, 'Save customer record');
}

function startEditRecord(id) {
  const record = records.find(r => r.id === id);
  if (!record) return;
  openModal();
  document.getElementById('edit-record-id').value = record.id;
  document.getElementById('cust-name').value = record.name || '';
  document.getElementById('cust-city').value = record.city || '';
  document.getElementById('cust-date').value = record.date || getLocalTodayDate();
  document.getElementById('cust-payment-type').value = record.paymentType || 'Cash';
  toggleCreditFields();
  if (record.paymentType === 'Credit') {
    document.getElementById('credit-days').value = record.creditDays || 0;
  }
  document.getElementById('cust-is-paid').checked = record.isPaid || false;

  const container = document.getElementById('bill-items-container');
  if (container) {
    container.innerHTML = '';
    if (record.itemList && record.itemList.length > 0) {
      record.itemList.forEach(item => addBillItemRow(item));
    } else {
      addBillItemRow({ name: 'Default Item', qty: record.totalQty || 1, price: record.totalBill || 0 });
    }
  }
  updateLiveTotal();
}

function cancelEditMode() {
  const idInput = document.getElementById('edit-record-id');
  if (idInput) idInput.value = '';
  const form = document.getElementById('record-form');
  if (form) form.reset();
  const container = document.getElementById('bill-items-container');
  if (container) container.innerHTML = '';
  const dateInput = document.getElementById('cust-date');
  if (dateInput) dateInput.value = getLocalTodayDate();
  toggleCreditFields();
  updateLiveTotal();
}

function handleSearchInput() {
  renderRecords();
}

function selectSuggestion(val) {
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = val;
  renderRecords();
}

function renderHoveringCities() {
  const container = document.getElementById('city-pills-container');
  if (!container) return;
  container.innerHTML = '';
  const cities = [...new Set(records.map(r => r.city).filter(Boolean))];
  cities.forEach(city => {
    const pill = document.createElement('button');
    pill.className = 'px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded-full text-xs hover:bg-blue-500 hover:text-white transition';
    pill.textContent = city;
    pill.onclick = () => filterByCity(city);
    container.appendChild(pill);
  });
}

function filterByCity(city) {
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = city;
  renderRecords();
}

function renderRecords() {
  populateCustomerDatalist();
  renderHoveringCities();
  updateDashboard();

  const container = document.getElementById('records-list');
  if (!container) return;
  container.innerHTML = '';

  const searchInput = document.getElementById('search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = records.filter(r => {
    if (!query) return true;
    return (r.name && r.name.toLowerCase().includes(query)) ||
           (r.city && r.city.toLowerCase().includes(query)) ||
           (r.date && r.date.includes(query));
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="text-center py-8 text-gray-500">No records found.</div>';
    return;
  }

  filtered.forEach(r => {
    const totals = getRecordTotals(r);
    const card = document.createElement('div');
    card.className = 'bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4 flex flex-col justify-between';
    card.innerHTML = `
      <div class="flex justify-between items-start mb-2">
        <div>
          <h3 class="text-lg font-bold text-gray-900 dark:text-white">${r.name || 'Unnamed'}</h3>
          <p class="text-xs text-gray-500">${r.city || 'No City'} • ${r.date || ''}</p>
        </div>
        <span class="px-2 py-1 text-xs rounded ${r.isPaid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
          ${r.isPaid ? 'Paid' : 'Unpaid'} (${r.paymentType || 'Cash'})
        </span>
      </div>
      <div class="text-sm my-2 text-gray-700 dark:text-gray-300">
        <p>Total Items: <span class="font-semibold">${totals.qty}</span></p>
        <p>Total Bill: <span class="font-semibold">₹${totals.bill.toFixed(2)}</span></p>
      </div>
      <div class="flex gap-2 justify-end mt-2">
        <button onclick="startEditRecord(${r.id})" class="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Edit</button>
        <button onclick="deleteRecord(${r.id})" class="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700">Delete</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateDashboard() {
  let totalSales = 0;
  let totalQty = 0;
  let pendingAmount = 0;

  records.forEach(r => {
    const totals = getRecordTotals(r);
    totalSales += totals.bill;
    totalQty += totals.qty;
    if (!r.isPaid) {
      pendingAmount += totals.bill;
    }
  });

  const totalSalesEl = document.getElementById('dash-total-sales');
  const totalQtyEl = document.getElementById('dash-total-qty');
  const pendingEl = document.getElementById('dash-pending-amount');
  const recordCountEl = document.getElementById('dash-record-count');

  if (totalSalesEl) totalSalesEl.textContent = `₹${totalSales.toFixed(2)}`;
  if (totalQtyEl) totalQtyEl.textContent = totalQty;
  if (pendingEl) pendingEl.textContent = `₹${pendingAmount.toFixed(2)}`;
  if (recordCountEl) recordCountEl.textContent = records.length;

  renderYearSummary();
}

function renderYearSummary() {
  const el = document.getElementById('year-summary-container');
  if (!el) return;
  const yearlyData = {};
  records.forEach(r => {
    const year = r.date ? r.date.split('-')[0] : 'Unknown';
    const totals = getRecordTotals(r);
    yearlyData[year] = (yearlyData[year] || 0) + totals.bill;
  });
  el.innerHTML = Object.entries(yearlyData).map(([yr, amt]) => `
    <div class="flex justify-between text-xs py-1 border-b dark:border-gray-700">
      <span>${yr}</span>
      <span class="font-semibold">₹${amt.toFixed(2)}</span>
    </div>
  `).join('');
}

function deleteRecord(id) {
  deleteTargetId = id;
  const modal = document.getElementById('delete-modal');
  if (modal) modal.classList.remove('hidden');
}

async function confirmDeleteRecord() {
  if (deleteTargetId !== null) {
    records = records.filter(r => r.id !== deleteTargetId);
    deleteTargetId = null;
    cancelDeleteModal();
    renderRecords();
    await pushDataToGitHub(records, 'Delete customer record');
  }
}

function cancelDeleteModal() {
  deleteTargetId = null;
  const modal = document.getElementById('delete-modal');
  if (modal) modal.classList.add('hidden');
}

async function saveRecordsToGitHub() {
  await pushDataToGitHub(records, 'Update records');
}

function renderEmployees(employees) {
  const container = document.getElementById('employee-list');
  if (!container || !Array.isArray(employees)) return;
  container.innerHTML = employees.map(emp => `
    <div class="p-2 border-b dark:border-gray-700 flex justify-between items-center text-sm">
      <span>${emp.name || emp.title}</span>
      <span class="text-xs text-gray-500">${emp.role || ''}</span>
    </div>
  `).join('');
}

async function loadData() {
  try {
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      records = await res.json();
      if (typeof renderRecords === 'function') renderRecords();
    }
  } catch (e) {
    console.error("Failed to load data.json", e);
  }
}

async function loadEmployees() {
  try {
    const res = await fetch(`employees.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const employees = await res.json();
      if (typeof renderEmployees === 'function') renderEmployees(employees);
    }
  } catch (e) {
    console.error("Failed to load employees.json", e);
  }
}

function startLiveSync() {
  loadData();
  loadEmployees();
  setInterval(() => {
    loadData();
    loadEmployees();
  }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
  const todayStr = getLocalTodayDate();
  const dateEl = document.getElementById('cust-date');
  if (dateEl) dateEl.value = todayStr;
  const bannerYear = document.getElementById('banner-year');
  if (bannerYear) bannerYear.textContent = new Date().getFullYear();
  addBillItemRow();
  checkBankHoliday();
  startLiveSync();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}
