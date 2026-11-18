// Kabir Emporium Customer & Sales Directory System - script.js

let records = [];
let editIndex = null;
let currentFiscalYear = "2026";
let syncInterval = null;

document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

function initApp() {
  checkBankHoliday();
  setupEventListeners();
  addBillItemRow(); // Start with at least one bill item row
  loadData();
  startLiveSync();
}

function setupEventListeners() {
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", handleSearchInput);
  }

  const paymentModeSelect = document.getElementById("payment-mode");
  if (paymentModeSelect) {
    paymentModeSelect.addEventListener("change", toggleCreditFields);
  }

  const form = document.getElementById("customer-form");
  if (form) {
    form.addEventListener("submit", handleFormSubmit);
  }
}

// --- Bank Holiday / Status Check ---
function checkBankHoliday() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
  const dateNum = today.getDate();

  const isSunday = dayOfWeek === 0;
  const isSecondOrFourthSaturday = dayOfWeek === 6 && ((dateNum > 7 && dateNum <= 14) || (dateNum > 21 && dateNum <= 28));
  
  const pill = document.getElementById("bank-holiday-pill");
  const icon = document.getElementById("bank-status-icon");
  const text = document.getElementById("bank-status-text");

  if (pill && icon && text) {
    if (isSunday || isSecondOrFourthSaturday) {
      icon.textContent = "🔴";
      text.textContent = "Bank Holiday / Weekend";
      pill.style.background = "#fee2e2";
      pill.style.color = "#991b1b";
    } else {
      icon.textContent = "🟢";
      text.textContent = "Working Day";
      pill.style.background = "#dcfce7";
      pill.style.color = "#166534";
    }
  }
}

// --- Data Loading with Robust Local Fallback ---
async function loadData() {
  updateStatus("Connecting...", "connecting");
  try {
    const res = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) {
      throw new Error("data.json not found or inaccessible");
    }
    const data = await res.json();
    records = Array.isArray(data) ? data : (data.records || []);
    localStorage.setItem("kabir_records", JSON.stringify(records));
    updateDashboard();
    renderRecords();
    updateStatus("Connected", "online");
  } catch (err) {
    console.warn("Falling back to local storage:", err);
    const local = localStorage.getItem("kabir_records");
    if (local) {
      records = JSON.parse(local);
      updateDashboard();
      renderRecords();
      updateStatus("Connected (Local)", "online");
    } else {
      records = [];
      updateDashboard();
      renderRecords();
      updateStatus("Ready (New)", "online");
    }
  }
}

// --- Live Sync Polling ---
function startLiveSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    try {
      const res = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const remoteRecords = Array.isArray(data) ? data : (data.records || []);
        if (JSON.stringify(remoteRecords) !== JSON.stringify(records)) {
          records = remoteRecords;
          localStorage.setItem("kabir_records", JSON.stringify(records));
          updateDashboard();
          renderRecords();
        }
      }
    } catch (e) {
      // Silent background poll fail
    }
  }, 5000);
}

function updateStatus(text, statusClass) {
  const badge = document.getElementById("connection-status");
  if (badge) {
    badge.textContent = text;
    badge.className = `status-badge ${statusClass}`;
  }
}

// --- Dashboard & Metrics ---
function updateDashboard() {
  const totalRecordsEl = document.getElementById("total-records");
  const totalItemsEl = document.getElementById("total-items");
  const totalCitiesEl = document.getElementById("total-cities");
  const daySaleEl = document.getElementById("day-sale");
  const yearTotalsEl = document.getElementById("year-totals");

  const todayStr = new Date().toISOString().split("T")[0];
  let totalItemsCount = 0;
  let daySale = 0;
  const cities = new Set();
  const yearTotals = {};

  records.forEach(r => {
    if (r.city) cities.add(r.city.trim().toLowerCase());
    
    if (Array.isArray(r.items)) {
      r.items.forEach(item => {
        totalItemsCount += Number(item.qty || 1);
      });
    }

    if (r.date === todayStr) {
      daySale += Number(r.total || 0);
    }

    const yr = (r.date || "").split("-")[0] || currentFiscalYear;
    yearTotals[yr] = (yearTotals[yr] || 0) + Number(r.total || 0);
  });

  if (totalRecordsEl) totalRecordsEl.textContent = records.length;
  if (totalItemsEl) totalItemsEl.textContent = totalItemsCount;
  if (totalCitiesEl) totalCitiesEl.textContent = cities.size;
  if (daySaleEl) daySaleEl.textContent = `₹${daySale.toFixed(2)}`;

  if (yearTotalsEl) {
    yearTotalsEl.innerHTML = Object.entries(yearTotals)
      .map(([yr, amt]) => `<span class="year-pill"><b>${yr}</b>: ₹${amt.toFixed(2)}</span>`)
      .join(" ");
  }
}

// --- Bill Items & Calculations ---
function addBillItemRow(name = "", qty = 1, price = 0) {
  const container = document.getElementById("bill-items-container");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "bill-item-row";
  row.innerHTML = `
    <input type="text" placeholder="Item name" class="item-name" value="${name}" required oninput="updateLiveTotal()">
    <input type="number" placeholder="Qty" class="item-qty" value="${qty}" min="1" required oninput="updateLiveTotal()">
    <input type="number" placeholder="Price (₹)" class="item-price" value="${price}" min="0" step="0.01" required oninput="updateLiveTotal()">
    <button type="button" class="btn-remove-item" onclick="removeBillItemRow(this)">✕</button>
  `;
  container.appendChild(row);
  updateLiveTotal();
}

function removeBillItemRow(btn) {
  const container = document.getElementById("bill-items-container");
  if (container && container.children.length > 1) {
    btn.closest(".bill-item-row").remove();
    updateLiveTotal();
  }
}

function updateLiveTotal() {
  let total = 0;
  document.querySelectorAll(".bill-item-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".item-qty").value) || 0;
    const price = parseFloat(row.querySelector(".item-price").value) || 0;
    total += qty * price;
  });

  const preview = document.getElementById("bill-total-preview");
  if (preview) {
    preview.textContent = `₹${total.toFixed(2)}`;
  }
}

function toggleCreditFields() {
  const mode = document.getElementById("payment-mode").value;
  const creditBox = document.getElementById("credit-due-box");
  if (creditBox) {
    creditBox.style.display = mode === "Credit" ? "block" : "none";
  }
}

// --- Form Submit & Saving ---
async function handleFormSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("customer-name").value.trim();
  const city = document.getElementById("customer-city").value.trim();
  const paymentMode = document.getElementById("payment-mode").value;
  const date = document.getElementById("record-date").value || new Date().toISOString().split("T")[0];

  const items = [];
  document.querySelectorAll(".bill-item-row").forEach(row => {
    items.push({
      name: row.querySelector(".item-name").value.trim(),
      qty: parseFloat(row.querySelector(".item-qty").value) || 1,
      price: parseFloat(row.querySelector(".item-price").value) || 0
    });
  });

  const total = items.reduce((sum, item) => sum + (item.qty * item.price), 0);

  const newRecord = {
    id: editIndex !== null && records[editIndex] ? records[editIndex].id : Date.now(),
    name,
    city,
    items,
    paymentMode,
    total,
    date,
    createdAt: new Date().toISOString()
  };

  if (editIndex !== null) {
    records[editIndex] = newRecord;
    editIndex = null;
  } else {
    records.unshift(newRecord);
  }

  saveRecordsToGitHub();
  resetForm();
}

function resetForm() {
  const form = document.getElementById("customer-form");
  if (form) form.reset();
  const container = document.getElementById("bill-items-container");
  if (container) {
    container.innerHTML = "";
    addBillItemRow();
  }
  const dateInput = document.getElementById("record-date");
  if (dateInput) dateInput.value = new Date().toISOString().split("T")[0];
  const preview = document.getElementById("bill-total-preview");
  if (preview) preview.textContent = "₹0.00";
  editIndex = null;
  const submitBtn = document.getElementById("submit-btn");
  if (submitBtn) submitBtn.textContent = "💾 SUBMIT";
}

// --- Record Rendering & Search ---
function renderRecords(filterRecords = records) {
  const listEl = document.getElementById("records-list");
  const countEl = document.getElementById("record-count");
  if (!listEl) return;

  if (countEl) countEl.textContent = `${filterRecords.length} records`;

  if (filterRecords.length === 0) {
    listEl.innerHTML = `<p class="no-records">No transaction records found.</p>`;
    return;
  }

  listEl.innerHTML = filterRecords.map((r, idx) => `
    <div class="record-card">
      <div class="record-header">
        <strong>${r.name}</strong>
        <span class="pill ${r.paymentMode === 'Credit' ? 'pill-credit' : 'pill-cash'}">${r.paymentMode}</span>
      </div>
      <div class="record-details">
        <span>📍 ${r.city}</span>
        <span>📅 ${r.date}</span>
      </div>
      <div class="record-items">
        ${(r.items || []).map(i => `<div>• ${i.name} (${i.qty} x ₹${i.price})</div>`).join("")}
      </div>
      <div class="record-footer">
        <span class="record-total">Total: ₹${Number(r.total).toFixed(2)}</span>
        <div class="record-actions">
          <button onclick="editRecord(${idx})" class="btn-sm">✏️ Edit</button>
          <button onclick="deleteRecord(${idx})" class="btn-sm btn-danger">🗑️ Delete</button>
        </div>
      </div>
    </div>
  `).join("");
}

function handleSearchInput(e) {
  const query = e.target.value.toLowerCase();
  const filtered = records.filter(r => 
    r.name.toLowerCase().includes(query) ||
    r.city.toLowerCase().includes(query) ||
    r.paymentMode.toLowerCase().includes(query)
  );
  renderRecords(filtered);
}

function filterRecordsByMode(mode) {
  if (mode === 'All') {
    renderRecords(records);
  } else {
    const filtered = records.filter(r => r.paymentMode === mode);
    renderRecords(filtered);
  }
}

function editRecord(index) {
  const r = records[index];
  if (!r) return;
  document.getElementById("customer-name").value = r.name;
  document.getElementById("customer-city").value = r.city;
  document.getElementById("payment-mode").value = r.paymentMode;
  document.getElementById("record-date").value = r.date;

  const container = document.getElementById("bill-items-container");
  container.innerHTML = "";
  if (r.items && r.items.length > 0) {
    r.items.forEach(i => addBillItemRow(i.name, i.qty, i.price));
  } else {
    addBillItemRow();
  }

  updateLiveTotal();
  editIndex = index;
  const submitBtn = document.getElementById("submit-btn");
  if (submitBtn) submitBtn.textContent = "💾 UPDATE RECORD";
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteRecord(index) {
  if (confirm("Are you sure you want to delete this record?")) {
    records.splice(index, 1);
    saveRecordsToGitHub();
  }
}

// --- Sync to Local Storage & GitHub ---
function saveRecordsToGitHub() {
  localStorage.setItem("kabir_records", JSON.stringify(records));
  updateDashboard();
  renderRecords();
  updateStatus("Saved locally", "online");

  const token = localStorage.getItem("github_pat");
  if (token) {
    pushDataToGitHub(token);
  }
}

async function pushDataToGitHub(token) {
  const owner = "playtv02";
  const repo = "Customer-directory";
  const path = "data.json";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  try {
    const getRes = await fetch(url, {
      headers: { Authorization: `token ${token}` }
    });
    let sha = "";
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify({ records }, null, 2))));
    const putRes = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Save customer records (${new Date().toLocaleString()})`,
        content: content,
        sha: sha
      })
    });

    if (putRes.ok) {
      updateStatus("Synced with GitHub", "online");
    }
  } catch (err) {
    console.error("GitHub sync error:", err);
  }
}
