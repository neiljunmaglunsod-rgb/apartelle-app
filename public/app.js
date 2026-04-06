/* ══════════════════════════════════════════════════
   J&J APARTELLE — Frontend Application
   ══════════════════════════════════════════════════ */

const API = '';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ROOM_CONFIG = {
  1: { rate: 2700, maxGuests: 6 },
  2: { rate: 2400, maxGuests: 5 },
  3: { rate: 1600, maxGuests: 3 },
  4: { rate: 2800, maxGuests: 8 }
};

/* ── UTILITIES ── */
function fmt(n) { return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d) { if (!d) return '—'; const dt = new Date(d); return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }); }
function fmtDateInput(d) { if (!d) return ''; const dt = new Date(d); return dt.toISOString().slice(0, 10); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function qs(sel, ctx = document) { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return ctx.querySelectorAll(sel); }

function toast(msg, type = 'success') {
  const c = qs('#toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function confirm(title, message) {
  return new Promise(resolve => {
    qs('#confirm-title').textContent = title;
    qs('#confirm-message').textContent = message;
    qs('#confirm-overlay').classList.add('open');
    const ok = qs('#confirm-ok');
    const cancel = qs('#confirm-cancel');
    const cleanup = () => { qs('#confirm-overlay').classList.remove('open'); };
    ok.onclick = () => { cleanup(); resolve(true); };
    cancel.onclick = () => { cleanup(); resolve(false); };
  });
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ── MODALS ── */
function openModal(id) { qs('#' + id).classList.add('open'); }
function closeModal(id) { qs('#' + id).classList.remove('open'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
});

/* ── NAVIGATION ── */
const pages = { dashboard: 'Dashboard', calendar: 'Availability Calendar', bookings: 'Bookings', finances: 'Income & Expenses', guests: 'Guests' };

function navigate(page) {
  qsa('.page').forEach(p => p.classList.remove('active'));
  qsa('.nav-link').forEach(a => a.classList.remove('active'));
  qs('#page-' + page).classList.add('active');
  qs(`.nav-link[data-page="${page}"]`).classList.add('active');
  qs('#topbar-title').textContent = pages[page] || '';
  if (page === 'dashboard') loadDashboard();
  if (page === 'calendar') renderCalendar();
  if (page === 'bookings') loadBookings();
  if (page === 'finances') loadFinances();
  if (page === 'guests') loadGuests();
}

qsa('.nav-link').forEach(a => {
  a.addEventListener('click', () => navigate(a.dataset.page));
});

// Topbar date
function updateDate() {
  const now = new Date();
  qs('#topbar-date').textContent = now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
updateDate();

/* ══════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════ */
async function loadDashboard() {
  try {
    const d = await api('GET', '/api/dashboard');
    qs('#stat-available').textContent = d.availableDoors.length;
    qs('#stat-occupied').textContent = d.occupiedDoors.length;
    qs('#stat-checkins').textContent = d.todayCheckIns;
    qs('#stat-checkouts').textContent = d.todayCheckOuts;
    qs('#stat-income').textContent = fmt(d.monthIncome);
    qs('#stat-expense').textContent = fmt(d.monthExpense);
    qs('#stat-net').textContent = fmt(d.monthNet);
    qs('#stat-net').className = 'stat-value ' + (d.monthNet >= 0 ? 'income-val' : 'expense-val');
    qs('#stat-guests').textContent = d.totalGuests;

    // Room status cards
    const grid = qs('#rooms-status');
    grid.innerHTML = '';
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's check-outs
    const checkoutBookings = await api('GET', `/api/bookings/availability?start=${todayISO()}&end=${fmtDateInput(tomorrow)}`);
    const checkoutDoors = checkoutBookings.filter(b => {
      const co = new Date(b.checkOut); co.setHours(0,0,0,0);
      return co.getTime() === today.getTime();
    }).map(b => b.doorNumber);

    [1,2,3,4].forEach(door => {
      const isOccupied = d.occupiedDoors.includes(door);
      const isDeparture = checkoutDoors.includes(door);
      const cls = isDeparture ? 'departure' : (isOccupied ? 'occupied' : 'available');
      const label = isDeparture ? 'Check-out Today' : (isOccupied ? 'Occupied' : 'Available');
      const conf = ROOM_CONFIG[door];
      grid.innerHTML += `
        <div class="room-card ${cls}" onclick="navigate('calendar')">
          <div class="room-door">Door ${door}</div>
          <div class="room-rate">${fmt(conf.rate)}/night &bull; max ${conf.maxGuests} guests</div>
          <div class="room-status-badge">${label}</div>
        </div>`;
    });

    // Recent bookings
    const bookings = await api('GET', '/api/bookings?');
    const tbody = qs('#recent-bookings-body');
    const recent = bookings.slice(0, 8);
    if (!recent.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📭</div><p>No bookings yet</p></div></td></tr>`;
    } else {
      tbody.innerHTML = recent.map(b => `
        <tr>
          <td><strong>${escHtml(b.guestName)}</strong></td>
          <td>Door ${b.doorNumber}</td>
          <td>${fmtDate(b.checkIn)}</td>
          <td>${fmtDate(b.checkOut)}</td>
          <td>${fmt(b.totalPrice)}</td>
          <td><span class="badge badge-${b.source.toLowerCase().replace('-','')}">${b.source}</span></td>
          <td><span class="badge badge-${b.status}">${b.status}</span></td>
        </tr>`).join('');
    }
  } catch (err) {
    toast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ══════════════════════════════════════════════
   CALENDAR
   ══════════════════════════════════════════════ */
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed

async function renderCalendar() {
  const label = qs('#cal-month-label');
  label.textContent = `${MONTHS[calMonth]} ${calYear}`;

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startDate = new Date(calYear, calMonth, 1);
  const endDate = new Date(calYear, calMonth + 1, 1);

  // Fetch bookings that overlap this month
  const bookings = await api('GET', `/api/bookings/availability?start=${fmtDateInput(startDate)}&end=${fmtDateInput(endDate)}`);

  const grid = qs('#calendar-grid');
  const today = new Date(); today.setHours(0,0,0,0);

  // Header row
  let html = `<div class="cal-header">
    <div>Date</div>
    <div>Door 1<br/><small style="font-size:10px;opacity:0.7">₱2,700 · max 6</small></div>
    <div>Door 2<br/><small style="font-size:10px;opacity:0.7">₱2,400 · max 5</small></div>
    <div>Door 3<br/><small style="font-size:10px;opacity:0.7">₱1,600 · max 3</small></div>
    <div>Door 4<br/><small style="font-size:10px;opacity:0.7">₱2,800 · max 8</small></div>
  </div>`;

  // Day rows
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(calYear, calMonth, day);
    date.setHours(0,0,0,0);
    const isToday = date.getTime() === today.getTime();
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayName = dayNames[date.getDay()];

    html += `<div class="cal-row">
      <div class="cal-date-label ${isToday ? 'today' : ''}">
        ${isToday ? '▶ ' : ''}${day} <span style="font-size:10px">${dayName}</span>
      </div>`;

    for (let door = 1; door <= 4; door++) {
      // Find booking occupying this door on this day
      const booking = bookings.find(b => {
        const ci = new Date(b.checkIn); ci.setHours(0,0,0,0);
        const co = new Date(b.checkOut); co.setHours(0,0,0,0);
        return b.doorNumber === door && ci <= date && co > date;
      });

      if (booking) {
        html += `<div class="cal-cell">
          <div class="cal-booking-block ${booking.status}"
               onclick="editBookingById('${booking._id}')"
               title="${escHtml(booking.guestName)} | Check-in: ${fmtDate(booking.checkIn)} | Check-out: ${fmtDate(booking.checkOut)}">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(booking.guestName.split(' ')[0])}</span>
          </div>
        </div>`;
      } else {
        html += `<div class="cal-cell" onclick="openNewBookingForDoor(${door}, '${fmtDateInput(date)}')"
                      title="Click to book Door ${door} on ${fmtDate(date)}"
                      style="cursor:pointer;background:transparent"></div>`;
      }
    }
    html += `</div>`;
  }

  grid.innerHTML = html;
}

qs('#cal-prev').addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar();
});
qs('#cal-next').addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar();
});
qs('#cal-today').addEventListener('click', () => {
  calYear = new Date().getFullYear(); calMonth = new Date().getMonth(); renderCalendar();
});

function openNewBookingForDoor(door, date) {
  openBookingModal();
  qs('#booking-door').value = door;
  qs('#booking-checkin').value = date;
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  qs('#booking-checkout').value = fmtDateInput(nextDay);
  updatePricePreview();
}

/* ══════════════════════════════════════════════
   BOOKINGS
   ══════════════════════════════════════════════ */
async function loadBookings() {
  const status = qs('#booking-filter-status').value;
  const door = qs('#booking-filter-door').value;
  const month = qs('#booking-filter-month').value;
  const year = qs('#booking-filter-year').value;

  let params = new URLSearchParams();
  if (status) params.set('status', status);
  if (door) params.set('door', door);
  if (month) params.set('month', month);
  if (year) params.set('year', year);

  try {
    const bookings = await api('GET', '/api/bookings?' + params.toString());
    const tbody = qs('#bookings-body');

    if (!bookings.length) {
      tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">📭</div><p>No bookings found</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = bookings.map(b => `
      <tr>
        <td><strong>${escHtml(b.guestName)}</strong></td>
        <td>${escHtml(b.guestContact || '—')}</td>
        <td><strong>Door ${b.doorNumber}</strong></td>
        <td>${fmtDate(b.checkIn)}</td>
        <td>${fmtDate(b.checkOut)}</td>
        <td>${b.nights}</td>
        <td>${b.guestCount}${b.extraBeds > 0 ? ` <small style="color:var(--warning)">(+${b.extraBeds} extra)</small>` : ''}</td>
        <td><span class="badge badge-${b.source.toLowerCase().replace(/[^a-z]/g,'')}">${b.source}</span></td>
        <td>
          <strong>${fmt(b.totalPrice)}</strong>
          ${b.extraCharge > 0 ? `<br/><small style="color:var(--warning)">+${fmt(b.extraCharge)} extra</small>` : ''}
        </td>
        <td>
          <select class="form-control" style="padding:4px 8px;font-size:12px;width:120px" onchange="updateBookingStatus('${b._id}', this.value)">
            <option value="confirmed" ${b.status==='confirmed'?'selected':''}>Confirmed</option>
            <option value="checked-in" ${b.status==='checked-in'?'selected':''}>Checked-in</option>
            <option value="checked-out" ${b.status==='checked-out'?'selected':''}>Checked-out</option>
            <option value="cancelled" ${b.status==='cancelled'?'selected':''}>Cancelled</option>
          </select>
        </td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="editBookingById('${b._id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBooking('${b._id}', '${escHtml(b.guestName)}')">🗑️</button>
        </td>
      </tr>`).join('');
  } catch (err) {
    toast('Failed to load bookings: ' + err.message, 'error');
  }
}

qs('#booking-filter-apply').addEventListener('click', loadBookings);
qs('#booking-filter-clear').addEventListener('click', () => {
  qs('#booking-filter-status').value = '';
  qs('#booking-filter-door').value = '';
  qs('#booking-filter-month').value = '';
  qs('#booking-filter-year').value = '';
  loadBookings();
});

async function updateBookingStatus(id, status) {
  try {
    await api('PUT', `/api/bookings/${id}`, { status });
    toast('Status updated');
    loadBookings();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
    loadBookings();
  }
}

async function deleteBooking(id, name) {
  const ok = await confirm('Delete Booking', `Delete booking for "${name}"? This will also remove the linked income record.`);
  if (!ok) return;
  try {
    await api('DELETE', `/api/bookings/${id}`);
    toast('Booking deleted');
    loadBookings();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

/* ── BOOKING MODAL ── */
function openBookingModal(booking = null) {
  qs('#booking-modal-title').textContent = booking ? 'Edit Booking' : 'New Booking';
  qs('#booking-id').value = booking?._id || '';
  qs('#booking-guest-name').value = booking?.guestName || '';
  qs('#booking-guest-contact').value = booking?.guestContact || '';
  qs('#booking-guest-id').value = booking?.guestId || '';
  qs('#booking-door').value = booking?.doorNumber || '';
  qs('#booking-source').value = booking?.source || 'Walk-in';
  qs('#booking-checkin').value = booking ? fmtDateInput(booking.checkIn) : todayISO();
  qs('#booking-checkout').value = booking ? fmtDateInput(booking.checkOut) : '';
  qs('#booking-guests').value = booking?.guestCount || 1;
  qs('#booking-status').value = booking?.status || 'confirmed';
  qs('#booking-notes').value = booking?.notes || '';
  updatePricePreview();
  openModal('booking-modal');
  qs('#booking-guest-name').focus();
}

qs('#new-booking-btn').addEventListener('click', () => openBookingModal());

async function editBookingById(id) {
  try {
    const booking = await api('GET', `/api/bookings/${id}`);
    openBookingModal(booking);
    navigate('bookings');
  } catch (err) {
    toast('Failed to load booking: ' + err.message, 'error');
  }
}

// Price preview
function updatePricePreview() {
  const door = parseInt(qs('#booking-door').value);
  const ci = qs('#booking-checkin').value;
  const co = qs('#booking-checkout').value;
  const gc = parseInt(qs('#booking-guests').value) || 0;
  const box = qs('#price-preview-box');

  if (!door || !ci || !co || !gc) { box.style.display = 'none'; return; }

  const config = ROOM_CONFIG[door];
  if (!config) { box.style.display = 'none'; return; }

  const nights = Math.round((new Date(co) - new Date(ci)) / 86400000);
  if (nights < 1) { box.style.display = 'none'; return; }

  const extraBeds = Math.max(0, gc - config.maxGuests);
  const extraCharge = extraBeds * 250 * nights;
  const total = config.rate * nights + extraCharge;

  qs('#prev-base').textContent = `${fmt(config.rate)} × ${nights} night${nights>1?'s':''}`;
  qs('#prev-nights').textContent = nights + ' night' + (nights > 1 ? 's' : '');
  qs('#prev-extra').textContent = extraBeds > 0 ? `${extraBeds} × ${fmt(250)} × ${nights} = ${fmt(extraCharge)}` : 'None';
  qs('#prev-total').textContent = fmt(total);
  box.style.display = 'block';
}

['#booking-door','#booking-checkin','#booking-checkout','#booking-guests'].forEach(sel => {
  qs(sel).addEventListener('change', updatePricePreview);
  qs(sel).addEventListener('input', updatePricePreview);
});

// Guest autocomplete
let guestSuggestTimeout;
qs('#booking-guest-name').addEventListener('input', () => {
  clearTimeout(guestSuggestTimeout);
  guestSuggestTimeout = setTimeout(async () => {
    const q = qs('#booking-guest-name').value.trim();
    if (!q || q.length < 2) { qs('#guest-suggestions').innerHTML = ''; return; }
    try {
      const guests = await api('GET', `/api/guests?search=${encodeURIComponent(q)}`);
      const box = qs('#guest-suggestions');
      if (!guests.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<div style="position:absolute;background:#fff;border:1px solid var(--border);border-radius:6px;z-index:100;width:100%;box-shadow:var(--shadow-md);max-height:180px;overflow-y:auto">
        ${guests.map(g => `<div class="suggest-item" style="padding:9px 12px;cursor:pointer;font-size:13.5px;border-bottom:1px solid #f1f5f9"
            onmousedown="selectGuest('${g._id}','${escHtml(g.name)}','${escHtml(g.contact||'')}')">
          <strong>${escHtml(g.name)}</strong>${g.contact ? ' · ' + escHtml(g.contact) : ''}
        </div>`).join('')}
      </div>`;
    } catch {}
  }, 250);
});

function selectGuest(id, name, contact) {
  qs('#booking-guest-id').value = id;
  qs('#booking-guest-name').value = name;
  qs('#booking-guest-contact').value = contact;
  qs('#guest-suggestions').innerHTML = '';
}

qs('#booking-guest-name').addEventListener('blur', () => {
  setTimeout(() => { qs('#guest-suggestions').innerHTML = ''; }, 200);
});

qs('#save-booking-btn').addEventListener('click', async () => {
  const id = qs('#booking-id').value;
  const guestName = qs('#booking-guest-name').value.trim();
  const doorNumber = parseInt(qs('#booking-door').value);
  const checkIn = qs('#booking-checkin').value;
  const checkOut = qs('#booking-checkout').value;
  const guestCount = parseInt(qs('#booking-guests').value);

  if (!guestName || !doorNumber || !checkIn || !checkOut || !guestCount) {
    toast('Please fill in all required fields', 'error'); return;
  }
  if (new Date(checkOut) <= new Date(checkIn)) {
    toast('Check-out must be after check-in', 'error'); return;
  }

  const payload = {
    guestId: qs('#booking-guest-id').value || undefined,
    guestName,
    guestContact: qs('#booking-guest-contact').value.trim(),
    doorNumber,
    checkIn,
    checkOut,
    guestCount,
    source: qs('#booking-source').value,
    status: qs('#booking-status').value,
    notes: qs('#booking-notes').value.trim()
  };

  try {
    if (id) {
      await api('PUT', `/api/bookings/${id}`, payload);
      toast('Booking updated');
    } else {
      await api('POST', '/api/bookings', payload);
      toast('Booking created');
    }
    closeModal('booking-modal');
    loadBookings();
    if (qs('#page-dashboard').classList.contains('active')) loadDashboard();
    if (qs('#page-calendar').classList.contains('active')) renderCalendar();
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ══════════════════════════════════════════════
   FINANCES
   ══════════════════════════════════════════════ */
async function loadFinances() {
  const month = qs('#finance-month').value;
  const year = qs('#finance-year').value;

  let params = new URLSearchParams();
  if (month) params.set('month', month);
  if (year) params.set('year', year);

  try {
    const transactions = await api('GET', '/api/transactions?' + params.toString());

    // Compute totals
    let totalIncome = 0, totalExpense = 0;
    transactions.forEach(t => {
      if (t.type === 'income') totalIncome += t.amount;
      else totalExpense += t.amount;
    });
    const net = totalIncome - totalExpense;

    qs('#fin-income').textContent = fmt(totalIncome);
    qs('#fin-expense').textContent = fmt(totalExpense);
    qs('#fin-net').textContent = fmt(net);
    qs('#fin-net').className = 'stat-value ' + (net >= 0 ? 'net-positive' : 'net-negative');

    const tbody = qs('#transactions-body');
    if (!transactions.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📭</div><p>No transactions found</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = transactions.map(t => `
      <tr>
        <td>${fmtDate(t.date)}</td>
        <td><span class="badge badge-${t.type}">${t.type}</span></td>
        <td>${escHtml(t.category)}</td>
        <td>${escHtml(t.description || '—')}</td>
        <td class="${t.type === 'income' ? 'income-val' : 'expense-val'}"><strong>${fmt(t.amount)}</strong></td>
        <td style="white-space:nowrap">
          ${!t.bookingId ? `<button class="btn btn-ghost btn-sm" onclick="editTransaction('${t._id}')">✏️</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteTransaction('${t._id}')">🗑️</button>
        </td>
      </tr>`).join('');
  } catch (err) {
    toast('Failed to load transactions: ' + err.message, 'error');
  }
}

// Set current month/year defaults
qs('#finance-month').value = new Date().getMonth() + 1;
qs('#finance-year').value = new Date().getFullYear();

qs('#finance-filter-btn').addEventListener('click', loadFinances);

qs('#annual-report-btn').addEventListener('click', async () => {
  const year = qs('#finance-year').value || new Date().getFullYear();
  try {
    const report = await api('GET', `/api/transactions/report/monthly?year=${year}`);
    qs('#annual-report-title').textContent = `Annual Report — ${year}`;
    const tbody = qs('#annual-report-body');
    tbody.innerHTML = report.months.map(m => `
      <tr class="month-row">
        <td>${MONTHS[m.month - 1]}</td>
        <td style="text-align:right" class="income-val">${fmt(m.income)}</td>
        <td style="text-align:right" class="expense-val">${fmt(m.expense)}</td>
        <td style="text-align:right" class="${m.net >= 0 ? 'net-positive' : 'net-negative'}">${fmt(m.net)}</td>
      </tr>`).join('') +
      `<tr class="totals-row">
        <td>TOTAL</td>
        <td style="text-align:right" class="income-val">${fmt(report.totals.income)}</td>
        <td style="text-align:right" class="expense-val">${fmt(report.totals.expense)}</td>
        <td style="text-align:right" class="${report.totals.net >= 0 ? 'net-positive' : 'net-negative'}">${fmt(report.totals.net)}</td>
      </tr>`;
    openModal('annual-report-modal');
  } catch (err) {
    toast('Failed to load report: ' + err.message, 'error');
  }
});

/* ── TRANSACTION MODAL ── */
function openTransactionModal(t = null) {
  qs('#transaction-modal-title').textContent = t ? 'Edit Transaction' : 'Add Transaction';
  qs('#transaction-id').value = t?._id || '';
  qs('#transaction-type').value = t?.type || 'income';
  qs('#transaction-date').value = t ? fmtDateInput(t.date) : todayISO();
  qs('#transaction-category').value = t?.category || '';
  qs('#transaction-amount').value = t?.amount || '';
  qs('#transaction-desc').value = t?.description || '';
  openModal('transaction-modal');
}

qs('#new-transaction-btn').addEventListener('click', () => openTransactionModal());

async function editTransaction(id) {
  try {
    const all = await api('GET', '/api/transactions');
    const t = all.find(x => x._id === id);
    if (t) openTransactionModal(t);
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

async function deleteTransaction(id) {
  const ok = await confirm('Delete Transaction', 'Delete this transaction?');
  if (!ok) return;
  try {
    await api('DELETE', `/api/transactions/${id}`);
    toast('Transaction deleted');
    loadFinances();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

qs('#save-transaction-btn').addEventListener('click', async () => {
  const id = qs('#transaction-id').value;
  const type = qs('#transaction-type').value;
  const date = qs('#transaction-date').value;
  const category = qs('#transaction-category').value.trim();
  const amount = parseFloat(qs('#transaction-amount').value);

  if (!date || !category || isNaN(amount) || amount < 0) {
    toast('Please fill in all required fields', 'error'); return;
  }

  const payload = {
    type, date, category, amount,
    description: qs('#transaction-desc').value.trim()
  };

  try {
    if (id) {
      await api('PUT', `/api/transactions/${id}`, payload);
      toast('Transaction updated');
    } else {
      await api('POST', '/api/transactions', payload);
      toast('Transaction added');
    }
    closeModal('transaction-modal');
    loadFinances();
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ══════════════════════════════════════════════
   GUESTS
   ══════════════════════════════════════════════ */
async function loadGuests(search = '') {
  try {
    const url = search ? `/api/guests?search=${encodeURIComponent(search)}` : '/api/guests';
    const guests = await api('GET', url);
    const tbody = qs('#guests-body');

    if (!guests.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">👤</div><p>No guests found</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = guests.map(g => `
      <tr>
        <td><strong>${escHtml(g.name)}</strong></td>
        <td>${escHtml(g.contact || '—')}</td>
        <td>${escHtml(g.address || '—')}</td>
        <td>${escHtml(g.notes || '—')}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-info btn-sm" onclick="viewGuestHistory('${g._id}', '${escHtml(g.name)}')">📜 History</button>
          <button class="btn btn-ghost btn-sm" onclick="editGuest('${g._id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteGuest('${g._id}', '${escHtml(g.name)}')">🗑️</button>
        </td>
      </tr>`).join('');
  } catch (err) {
    toast('Failed to load guests: ' + err.message, 'error');
  }
}

qs('#guest-search-btn').addEventListener('click', () => loadGuests(qs('#guest-search').value.trim()));
qs('#guest-search').addEventListener('keydown', e => { if (e.key === 'Enter') loadGuests(qs('#guest-search').value.trim()); });
qs('#guest-search-clear').addEventListener('click', () => { qs('#guest-search').value = ''; loadGuests(); });

/* ── GUEST MODAL ── */
function openGuestModal(guest = null) {
  qs('#guest-modal-title').textContent = guest ? 'Edit Guest' : 'Add Guest';
  qs('#guest-id').value = guest?._id || '';
  qs('#guest-name').value = guest?.name || '';
  qs('#guest-contact').value = guest?.contact || '';
  qs('#guest-address').value = guest?.address || '';
  qs('#guest-notes').value = guest?.notes || '';
  openModal('guest-modal');
  qs('#guest-name').focus();
}

qs('#new-guest-btn').addEventListener('click', () => openGuestModal());

async function editGuest(id) {
  try {
    const { guest } = await api('GET', `/api/guests/${id}`);
    openGuestModal(guest);
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

async function deleteGuest(id, name) {
  const ok = await confirm('Delete Guest', `Delete guest "${name}"?`);
  if (!ok) return;
  try {
    await api('DELETE', `/api/guests/${id}`);
    toast('Guest deleted');
    loadGuests();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

async function viewGuestHistory(id, name) {
  try {
    const { guest, bookings } = await api('GET', `/api/guests/${id}`);
    qs('#guest-history-title').textContent = `History — ${name}`;
    qs('#guest-history-info').innerHTML = `
      <strong>${escHtml(guest.name)}</strong>
      ${guest.contact ? ` · 📞 ${escHtml(guest.contact)}` : ''}
      ${guest.address ? ` · 📍 ${escHtml(guest.address)}` : ''}
      <span style="float:right;color:var(--text-muted)">${bookings.length} booking${bookings.length !== 1 ? 's' : ''}</span>`;

    const tbody = qs('#guest-history-body');
    if (!bookings.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>No bookings yet</p></div></td></tr>`;
    } else {
      tbody.innerHTML = bookings.map(b => `
        <tr>
          <td>Door ${b.doorNumber}</td>
          <td>${fmtDate(b.checkIn)}</td>
          <td>${fmtDate(b.checkOut)}</td>
          <td>${b.nights}</td>
          <td>${b.guestCount}</td>
          <td>${fmt(b.totalPrice)}</td>
          <td><span class="badge badge-${b.source.toLowerCase().replace(/[^a-z]/g,'')}">${b.source}</span></td>
          <td><span class="badge badge-${b.status}">${b.status}</span></td>
        </tr>`).join('');
    }
    openModal('guest-history-modal');
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

qs('#save-guest-btn').addEventListener('click', async () => {
  const id = qs('#guest-id').value;
  const name = qs('#guest-name').value.trim();
  if (!name) { toast('Guest name is required', 'error'); return; }

  const payload = {
    name,
    contact: qs('#guest-contact').value.trim(),
    address: qs('#guest-address').value.trim(),
    notes: qs('#guest-notes').value.trim()
  };

  try {
    if (id) {
      await api('PUT', `/api/guests/${id}`, payload);
      toast('Guest updated');
    } else {
      await api('POST', '/api/guests', payload);
      toast('Guest added');
    }
    closeModal('guest-modal');
    loadGuests();
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ══════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════ */
loadDashboard();
