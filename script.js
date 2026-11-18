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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startLiveSync);
} else {
  startLiveSync();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}
