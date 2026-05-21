/* ══════════════════════════════════════════════════
   J&J APARTELLE — Frontend Application
   ══════════════════════════════════════════════════ */

const API = '';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
let ROOM_CONFIG = {
  1: { rate: 2700, maxGuests: 6 },
  2: { rate: 2400, maxGuests: 5 },
  3: { rate: 1600, maxGuests: 3 },
  4: { rate: 2800, maxGuests: 8 }
};

// Session-scoped map of recently checked-out bookings → fee IDs (for undo)
// Map<bookingId, { cleaningFeeId, laundryFeeId, guestName, doorNumber }>
const checkoutFeeMap = new Map();

// PDF state — populated by loadFinances() so PDF functions can read current data
let _currentTransactions = [];
let _currentPeriodLabel  = '';
let _logoBase64Cache     = undefined; // undefined=not fetched, ''=failed, else data URL

const BIZ = {
  name:    'J&J Apartelle',
  address: 'Cagayan de Oro City, Northern Mindanao',
  tin:     'XXX-XXX-XXX-000'
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
const pages = { dashboard: 'Dashboard', calendar: 'Availability Calendar', bookings: 'Bookings', finances: 'Income & Expenses', guests: 'Guests', reports: 'Financial Reports', settings: 'Settings' };

function navigate(page) {
  qsa('.page').forEach(p => p.classList.remove('active'));
  qsa('.nav-link').forEach(a => a.classList.remove('active'));
  qs('#page-' + page).classList.add('active');
  qs(`.nav-link[data-page="${page}"]`).classList.add('active');
  qs('#topbar-title').textContent = pages[page] || '';
  if (page === 'dashboard') loadDashboard();
  if (page === 'calendar') renderCalendar();
  if (page === 'bookings') loadBookings();
  if (page === 'finances') {
    // Always reset to Transactions tab on navigation
    qsa('.fin-tab').forEach(t => t.classList.remove('active'));
    qs('.fin-tab[data-fintab="transactions"]').classList.add('active');
    qsa('.fin-panel').forEach(p => p.style.display = 'none');
    qs('#fin-panel-transactions').style.display = '';
    loadFinances();
  }
  if (page === 'guests') loadGuests();
  if (page === 'reports') loadReports();
  if (page === 'settings') loadSettings();
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
    const [d, bookings] = await Promise.all([
      api('GET', '/api/dashboard'),
      api('GET', '/api/bookings?')
    ]);

    // ── Stats ──
    qs('#stat-available').textContent = d.availableDoors.length;
    qs('#stat-occupied').textContent = d.occupiedDoors.length;
    qs('#stat-checkins').textContent = d.todayCheckIns;
    qs('#stat-checkouts').textContent = d.todayCheckOuts;
    qs('#stat-income').textContent = fmt(d.monthIncome);
    qs('#stat-expense').textContent = fmt(d.monthExpense);
    qs('#stat-net').textContent = fmt(d.monthNet);
    qs('#stat-net').className = 'stat-value ' + (d.monthNet >= 0 ? 'net-positive' : 'net-negative');
    qs('#stat-guests').textContent = d.totalGuests;

    // ── Door cards ──
    const grid = qs('#rooms-status');
    grid.innerHTML = '';
    [1,2,3,4].forEach(door => {
      const booking = d.activeBookingsByDoor?.[door] || null;
      const conf = ROOM_CONFIG[door];

      let cls, label;
      if (!booking) {
        cls = 'available'; label = '● Available';
      } else if (booking.isCheckingOutToday) {
        cls = 'checking-out'; label = '● Checking out today';
      } else if (booking.isCheckingInToday) {
        cls = 'checking-in'; label = '● Checking in today';
      } else {
        cls = 'occupied'; label = '● Occupied';
      }

      let bodyHtml = `<div class="room-rate-row">${fmt(conf.rate)}/night · max ${conf.maxGuests} guests</div>`;
      if (booking) {
        const nights = Math.round((new Date(booking.checkOut) - new Date(booking.checkIn)) / 86400000);
        bodyHtml += `
          <div class="room-guest-name">👤 ${escHtml(booking.guestName)}</div>
          <div class="room-dates">
            In: ${fmtDate(booking.checkIn)}<br/>
            Out: ${fmtDate(booking.checkOut)}<br/>
            <span class="nights-tag">${nights} night${nights !== 1 ? 's' : ''} · ${booking.guestCount} guest${booking.guestCount !== 1 ? 's' : ''}</span>
          </div>`;
        if (cls === 'checking-in') {
          bodyHtml += `<button class="btn-checkin" onclick="event.stopPropagation();checkInDoor('${booking._id}',${door})">✓ Check In</button>`;
        }
      } else {
        bodyHtml += `<div class="room-available-hint">✓ Ready for booking</div>`;
      }

      grid.innerHTML += `
        <div class="room-card ${cls}" onclick="navigate('calendar')">
          <div class="room-card-header">
            <div class="room-door-label">Door ${door}</div>
            <div class="room-status-badge">${label}</div>
          </div>
          <div class="room-card-body">${bodyHtml}</div>
        </div>`;
    });

    // ── Quick Reports Summary ──
    const maxVal = Math.max(d.monthIncome, 1);
    qs('#qs-income').textContent = fmt(d.monthIncome);
    qs('#qs-expense').textContent = fmt(d.monthExpense);
    qs('#qs-net').textContent = fmt(d.monthNet);
    qs('#qs-net').className = 'rsrow-value ' + (d.monthNet >= 0 ? 'green' : 'red');
    setTimeout(() => {
      qs('#qs-income-bar').style.width = Math.min(100, (d.monthIncome / maxVal) * 100) + '%';
      qs('#qs-expense-bar').style.width = Math.min(100, (d.monthExpense / maxVal) * 100) + '%';
      qs('#qs-net-bar').style.width = d.monthNet > 0 ? Math.min(100, (d.monthNet / maxVal) * 100) + '%' : '0%';
    }, 100);

    // Occupancy bars
    const occ = d.occupancyByDoor || {};
    qs('#qs-occupancy-bars').innerHTML = [1,2,3,4].map(door => `
      <div class="occupancy-row">
        <div class="occupancy-door-label">Door ${door}</div>
        <div class="occupancy-bar-wrap">
          <div class="occupancy-bar-fill" style="width:0%" data-target="${occ[door] || 0}%"></div>
        </div>
        <div class="occupancy-pct">${occ[door] || 0}%</div>
      </div>`).join('');
    setTimeout(() => {
      qsa('#qs-occupancy-bars .occupancy-bar-fill').forEach(el => {
        el.style.width = el.dataset.target;
      });
    }, 120);

    // ── Today's Activity ──
    const ciList = qs('#today-checkins-list');
    const coList = qs('#today-checkouts-list');

    const ciItems = d.todayCheckInDetails || [];
    const coItems = d.todayCheckOutDetails || [];

    // Sort: pending (confirmed) first, already checked-in last
    const ciPending = ciItems.filter(b => b.status !== 'checked-in');
    const ciDone    = ciItems.filter(b => b.status === 'checked-in');
    const ciSorted  = [...ciPending, ...ciDone];
    ciList.innerHTML = ciSorted.length ? ciSorted.map(b => {
      const done = b.status === 'checked-in';
      return `
      <div class="activity-item checkin" style="${done ? 'opacity:0.55' : ''}">
        <div class="activity-icon">${done ? '✅' : '📥'}</div>
        <div class="activity-info">
          <div class="activity-name">${escHtml(b.guestName)}${done ? ' <span style="font-size:11px;color:var(--success);font-weight:600">Checked in</span>' : ''}</div>
          <div class="activity-detail">${escHtml(b.guestContact || '—')} · ${b.guestCount} guest${b.guestCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="activity-door">Door ${b.doorNumber}</div>
      </div>`;
    }).join('') : `<div class="activity-empty">No check-ins today</div>`;

    coList.innerHTML = coItems.length ? coItems.map(b => `
      <div class="activity-item checkout">
        <div class="activity-icon">📤</div>
        <div class="activity-info">
          <div class="activity-name">${escHtml(b.guestName)}</div>
          <div class="activity-detail">${escHtml(b.guestContact || '—')} · ${b.guestCount} guest${b.guestCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="activity-door">Door ${b.doorNumber}</div>
      </div>`).join('') : `<div class="activity-empty">No check-outs today</div>`;

    // ── Recent Bookings ──
    const tbody = qs('#recent-bookings-body');
    const recent = bookings.slice(0, 8);
    tbody.innerHTML = recent.length ? recent.map(b => `
      <tr>
        <td><strong>${escHtml(b.guestName)}</strong></td>
        <td>Door ${b.doorNumber}</td>
        <td>${fmtDate(b.checkIn)}</td>
        <td>${fmtDate(b.checkOut)}</td>
        <td>${fmt(b.totalPrice)}</td>
        <td><span class="badge badge-${b.source.toLowerCase().replace(/[^a-z]/g,'')}">${b.source}</span></td>
        <td><span class="badge badge-${b.status}">${b.status}</span></td>
      </tr>`).join('')
    : `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📭</div><p>No bookings yet</p></div></td></tr>`;

  } catch (err) {
    toast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function checkInDoor(bookingId, door) {
  try {
    await api('PUT', `/api/bookings/${bookingId}`, { status: 'checked-in' });
    toast(`Door ${door} — guest checked in`);
    loadDashboard();
  } catch (err) {
    toast('Check-in failed: ' + err.message, 'error');
  }
}

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
          <button class="btn btn-info btn-sm" onclick="printReceipt('${b._id}')" title="Download PDF Receipt">🧾</button>
          ${checkoutFeeMap.has(b._id) ? `<button class="btn btn-warning btn-sm" onclick="undoCheckout('${b._id}')" title="Undo checkout &amp; remove auto fees">↩ Undo</button>` : ''}
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
    if (status === 'checked-out') {
      const result = await api('POST', `/api/bookings/${id}/checkout`);
      if (!result.skipped && result.cleaningFeeId) {
        checkoutFeeMap.set(id, {
          cleaningFeeId: result.cleaningFeeId,
          laundryFeeId:  result.laundryFeeId,
          guestName:     result.booking.guestName,
          doorNumber:    result.booking.doorNumber
        });
        const door  = result.booking.doorNumber;
        const loads = { 1: 2, 2: 1, 3: 1, 4: 2 }[door] || 1;
        toast(`Checked out — cleaning ₱300 + laundry ₱${loads * 200} posted`);
      } else {
        toast('Status updated to checked-out');
      }
    } else {
      await api('PUT', `/api/bookings/${id}`, { status });
      toast('Status updated');
    }
    loadBookings();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
    loadBookings();
  }
}

async function undoCheckout(id) {
  const entry = checkoutFeeMap.get(id);
  if (!entry) { toast('Nothing to undo', 'error'); return; }
  try {
    await api('POST', `/api/bookings/${id}/undo-checkout`, {
      cleaningFeeId: entry.cleaningFeeId,
      laundryFeeId:  entry.laundryFeeId
    });
    checkoutFeeMap.delete(id);
    toast(`Checkout reversed — fees removed for ${entry.guestName}`);
    loadBookings();
  } catch (err) {
    toast('Undo failed: ' + err.message, 'error');
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

    // Cache for PDF generation
    _currentTransactions = transactions;
    const monthName = MONTHS[(parseInt(qs('#finance-month').value) || new Date().getMonth() + 1) - 1];
    _currentPeriodLabel = `${monthName} ${qs('#finance-year').value || new Date().getFullYear()}`;

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
          ${t.type === 'income' ? `<button class="btn btn-info btn-sm" onclick="downloadTransactionReceipt('${t._id}')" title="Download Receipt">🧾</button>` : ''}
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

/* ── FINANCES TAB SWITCHING ── */
qsa('.fin-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    qsa('.fin-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.fintab;
    qsa('.fin-panel').forEach(p => p.style.display = 'none');
    qs('#fin-panel-' + tab).style.display = '';
    if (tab === 'stafffees') loadStaffFees();
  });
});

/* ══════════════════════════════════════════════
   STAFF FEES TAB
   ══════════════════════════════════════════════ */
async function loadStaffFees() {
  const door = qs('#sf-door').value;
  const from = qs('#sf-from').value;
  const to   = qs('#sf-to').value;

  const params = new URLSearchParams();
  if (door) params.set('door', door);
  if (from) params.set('from', from);
  if (to)   params.set('to',   to);

  try {
    const data = await api('GET', '/api/transactions/report/staff-fees?' + params.toString());

    // Summary cards
    qs('#sf-total').textContent    = fmt(data.summary.totalFees);
    qs('#sf-cleaning').textContent = fmt(data.summary.cleaningTotal);
    qs('#sf-laundry').textContent  = fmt(data.summary.laundryTotal);

    // Per-door table
    const doorBody = qs('#sf-door-body');
    doorBody.innerHTML = data.byDoor.map(d => `
      <tr>
        <td><strong>Door ${d.door}</strong></td>
        <td style="text-align:right">${fmt(d.cleaning)}</td>
        <td style="text-align:right">${fmt(d.laundry)}</td>
        <td style="text-align:right"><strong>${fmt(d.total)}</strong></td>
        <td style="text-align:right">${d.checkouts}</td>
      </tr>`).join('');

    // Fee log
    const logBody = qs('#sf-log-body');
    if (!data.log.length) {
      logBody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📭</div><p>No fee records for selected filters</p></div></td></tr>`;
      return;
    }
    logBody.innerHTML = data.log.map(f => `
      <tr>
        <td>${fmtDate(f.date)}</td>
        <td><strong>Door ${f.doorNumber || '—'}</strong></td>
        <td>${escHtml(f.guestName || '—')}</td>
        <td><span class="badge badge-expense">${escHtml(f.category)}</span></td>
        <td style="color:var(--text-muted);font-size:12.5px">${escHtml(f.description || '—')}</td>
        <td style="text-align:right" class="expense-val"><strong>${fmt(f.amount)}</strong></td>
      </tr>`).join('');
  } catch (err) {
    toast('Failed to load staff fees: ' + err.message, 'error');
  }
}

qs('#sf-filter-btn').addEventListener('click', loadStaffFees);
qs('#sf-clear-btn').addEventListener('click', () => {
  qs('#sf-door').value = '';
  qs('#sf-from').value = '';
  qs('#sf-to').value   = '';
  loadStaffFees();
});

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
   SETTINGS
   ══════════════════════════════════════════════ */
async function loadRoomRates() {
  try {
    const rooms = await api('GET', '/api/rooms');
    rooms.forEach(r => { ROOM_CONFIG[r.door] = { rate: r.rate, maxGuests: r.maxGuests }; });
    renderRateList(rooms);
  } catch (err) {
    const el = qs('#door-rates-list');
    if (el) el.innerHTML = `<div style="color:var(--danger);font-size:13px">Failed to load rates.</div>`;
  }
}

function renderRateList(rooms) {
  const el = qs('#door-rates-list');
  if (!el) return;
  el.innerHTML = rooms.map((r, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;${i < rooms.length - 1 ? 'border-bottom:1px solid var(--border)' : ''}">
      <span style="font-weight:500">Door ${r.door} <span style="color:var(--text-muted);font-size:12px;font-weight:400">(max ${r.maxGuests} guests)</span></span>
      <span class="rate-editable" data-door="${r.door}" data-rate="${r.rate}" title="Click to edit rate" style="cursor:pointer;color:var(--primary);font-weight:600;text-decoration:underline dotted;text-underline-offset:3px">${fmt(r.rate)}/night <span style="font-size:11px;opacity:0.6;margin-left:2px">✏</span></span>
    </div>`).join('');
  el.querySelectorAll('.rate-editable').forEach(span => {
    span.addEventListener('click', () => startRateEdit(span));
  });
}

function startRateEdit(span) {
  const door = parseInt(span.dataset.door);
  const currentRate = parseInt(span.dataset.rate);
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.value = currentRate;
  input.style.cssText = 'width:110px;padding:4px 8px;border:1.5px solid var(--primary);border-radius:6px;font-size:14px;font-weight:600;text-align:right';
  span.replaceWith(input);
  input.focus();
  input.select();

  async function saveRate() {
    const newRate = parseInt(input.value);
    if (!newRate || newRate <= 0) { cancelEdit(); return; }
    try {
      await api('PUT', `/api/rooms/${door}`, { rate: newRate });
      ROOM_CONFIG[door].rate = newRate;
      toast(`Door ${door} rate updated to ${fmt(newRate)}`);
      await loadRoomRates();
      loadDashboard();
    } catch (err) {
      toast('Failed to save rate: ' + err.message, 'error');
      cancelEdit();
    }
  }

  function cancelEdit() {
    loadRoomRates();
  }

  input.addEventListener('blur', saveRate);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', saveRate); cancelEdit(); }
  });
}

async function loadSettings() {
  try {
    const settings = await api('GET', '/api/settings');
    qs('#webhook-url').value = settings.webhookUrl || '';
    qs('#webhook-status').textContent = settings.webhookUrl ? '✅ Webhook URL is saved.' : '';
    qs('#webhook-status').style.color = 'var(--success)';
  } catch (err) {
    toast('Failed to load settings: ' + err.message, 'error');
  }
  await loadRoomRates();
}

qs('#save-webhook-btn').addEventListener('click', async () => {
  const url = qs('#webhook-url').value.trim();
  const statusEl = qs('#webhook-status');
  try {
    await api('PUT', '/api/settings/webhookUrl', { value: url });
    statusEl.textContent = url ? '✅ Webhook URL saved successfully.' : '✅ Webhook URL cleared.';
    statusEl.style.color = 'var(--success)';
    toast('Webhook URL saved');
  } catch (err) {
    statusEl.textContent = '❌ Failed to save.';
    statusEl.style.color = 'var(--danger)';
    toast('Failed: ' + err.message, 'error');
  }
});

qs('#test-webhook-btn').addEventListener('click', async () => {
  const url = qs('#webhook-url').value.trim();
  const statusEl = qs('#webhook-status');
  if (!url) { toast('Enter a webhook URL first', 'error'); return; }
  try {
    await api('PUT', '/api/settings/webhookUrl', { value: url });
    // Send test payload
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestName: 'Test Guest',
        guestContact: '09171234567',
        doorNumber: 1,
        checkIn: new Date().toISOString(),
        checkOut: new Date(Date.now() + 86400000).toISOString(),
        nights: 1,
        guestCount: 2,
        totalPrice: 2700,
        source: 'Walk-in'
      })
    });
    statusEl.textContent = '✅ Test payload sent!';
    statusEl.style.color = 'var(--success)';
    toast('Test webhook sent');
  } catch (err) {
    statusEl.textContent = '❌ Test failed — check your URL.';
    statusEl.style.color = 'var(--danger)';
    toast('Test failed: ' + err.message, 'error');
  }
});

/* ══════════════════════════════════════════════
   REPORTS
   ══════════════════════════════════════════════ */
let chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

// Populate year dropdown
(function populateReportYears() {
  const sel = qs('#report-year');
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= currentYear - 4; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    sel.appendChild(opt);
  }
})();

qs('#load-reports-btn').addEventListener('click', loadReports);

async function loadReports() {
  const year = qs('#report-year').value;
  try {
    const [monthly, byDoor, bySource, occupancy, last6] = await Promise.all([
      api('GET', `/api/transactions/report/monthly?year=${year}`),
      api('GET', `/api/transactions/report/by-door?year=${year}`),
      api('GET', `/api/transactions/report/by-source?year=${year}`),
      api('GET', `/api/transactions/report/occupancy?year=${year}`),
      api('GET', '/api/transactions/report/last6months')
    ]);

    renderPnlTable(monthly);
    renderLast6Chart(last6);
    renderSourceChart(bySource);
    renderDoorChart(byDoor);
    renderOccupancyChart(occupancy);
  } catch (err) {
    toast('Failed to load reports: ' + err.message, 'error');
  }
}

function renderPnlTable(data) {
  const tbody = qs('#pnl-body');
  tbody.innerHTML = data.months.map(m => `
    <tr>
      <td>${MONTHS[m.month - 1]}</td>
      <td style="text-align:right" class="income-val">${fmt(m.income)}</td>
      <td style="text-align:right" class="expense-val">${fmt(m.expense)}</td>
      <td style="text-align:right" class="${m.net >= 0 ? 'net-positive' : 'net-negative'}">${fmt(m.net)}</td>
    </tr>`).join('') +
    `<tr class="totals-row">
      <td><strong>TOTAL</strong></td>
      <td style="text-align:right" class="income-val"><strong>${fmt(data.totals.income)}</strong></td>
      <td style="text-align:right" class="expense-val"><strong>${fmt(data.totals.expense)}</strong></td>
      <td style="text-align:right" class="${data.totals.net >= 0 ? 'net-positive' : 'net-negative'}"><strong>${fmt(data.totals.net)}</strong></td>
    </tr>`;
}

function renderLast6Chart(data) {
  destroyChart('chart-6months');
  const ctx = qs('#chart-6months').getContext('2d');
  chartInstances['chart-6months'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.label),
      datasets: [
        { label: 'Income', data: data.map(d => d.income), backgroundColor: 'rgba(22,163,74,0.75)', borderRadius: 5 },
        { label: 'Expenses', data: data.map(d => d.expense), backgroundColor: 'rgba(220,38,38,0.7)', borderRadius: 5 },
        { label: 'Net', data: data.map(d => d.net), backgroundColor: 'rgba(37,99,168,0.7)', borderRadius: 5 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { ticks: { callback: v => '₱' + v.toLocaleString() } }
      }
    }
  });
}

function renderSourceChart(data) {
  destroyChart('chart-source');
  if (!data.length) return;
  const colors = ['#2563a8','#16a34a','#1877f2','#d97706','#7c3aed'];
  const ctx = qs('#chart-source').getContext('2d');
  chartInstances['chart-source'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d._id),
      datasets: [{ data: data.map(d => d.totalIncome), backgroundColor: colors, borderWidth: 2 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });

  const total = data.reduce((s, d) => s + d.totalIncome, 0);
  qs('#source-legend').innerHTML = data.map((d, i) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <div style="width:12px;height:12px;border-radius:3px;background:${colors[i]};flex-shrink:0"></div>
      <div>
        <strong>${escHtml(d._id)}</strong><br/>
        <span style="color:var(--text-muted)">${fmt(d.totalIncome)} &bull; ${d.bookingCount} booking${d.bookingCount !== 1 ? 's' : ''}</span><br/>
        <span style="color:var(--text-muted)">${total > 0 ? ((d.totalIncome / total) * 100).toFixed(1) : 0}%</span>
      </div>
    </div>`).join('');
}

function renderDoorChart(data) {
  destroyChart('chart-door');
  const doorColors = ['#2563a8','#16a34a','#d97706','#7c3aed'];
  const labels = [1,2,3,4].map(d => `Door ${d}`);
  const values = [1,2,3,4].map(d => { const f = data.find(x => x._id === d); return f ? f.totalIncome : 0; });
  const counts = [1,2,3,4].map(d => { const f = data.find(x => x._id === d); return f ? f.bookingCount : 0; });

  const ctx = qs('#chart-door').getContext('2d');
  chartInstances['chart-door'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Income', data: values, backgroundColor: doorColors, borderRadius: 6 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: v => '₱' + v.toLocaleString() } } }
    }
  });

  qs('#door-income-table').innerHTML = `<table style="width:100%;font-size:12.5px">
    <tr><th style="text-align:left;padding:4px 6px;color:var(--text-muted)">Door</th><th style="text-align:right;padding:4px 6px;color:var(--text-muted)">Income</th><th style="text-align:right;padding:4px 6px;color:var(--text-muted)">Bookings</th></tr>
    ${[1,2,3,4].map((d,i) => `<tr><td style="padding:4px 6px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${doorColors[i]};margin-right:6px"></span>Door ${d}</td><td style="text-align:right;padding:4px 6px" class="income-val">${fmt(values[i])}</td><td style="text-align:right;padding:4px 6px;color:var(--text-muted)">${counts[i]}</td></tr>`).join('')}
  </table>`;
}

function renderOccupancyChart(data) {
  destroyChart('chart-occupancy');
  const colors = ['#2563a8','#16a34a','#d97706','#7c3aed'];
  const ctx = qs('#chart-occupancy').getContext('2d');
  chartInstances['chart-occupancy'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => `Door ${d.door}`),
      datasets: [{ label: 'Occupancy %', data: data.map(d => d.rate), backgroundColor: colors, borderRadius: 6 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { max: 100, ticks: { callback: v => v + '%' } } }
    }
  });

  qs('#occupancy-table').innerHTML = `<table style="width:100%;font-size:12.5px">
    <tr><th style="text-align:left;padding:4px 6px;color:var(--text-muted)">Door</th><th style="text-align:right;padding:4px 6px;color:var(--text-muted)">Occupied Days</th><th style="text-align:right;padding:4px 6px;color:var(--text-muted)">Rate</th></tr>
    ${data.map((d,i) => `<tr><td style="padding:4px 6px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colors[i]};margin-right:6px"></span>Door ${d.door}</td><td style="text-align:right;padding:4px 6px;color:var(--text-muted)">${d.occupiedDays} / ${d.totalDays} days</td><td style="text-align:right;padding:4px 6px;font-weight:700">${d.rate}%</td></tr>`).join('')}
  </table>`;
}

/* ══════════════════════════════════════════════
   PDF RECEIPT GENERATOR
   ══════════════════════════════════════════════ */
async function printReceipt(bookingId) {
  try {
    const b = await api('GET', `/api/bookings/${bookingId}`);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a5' });
    const W = 148; // A5 width mm
    const margin = 14;
    let y = 16;

    const line = () => { doc.setDrawColor(220,220,220); doc.line(margin, y, W - margin, y); y += 4; };
    // ── HEADER ──
    const _logo = await _getLogoBase64();
    const LOGO_W = 20, LOGO_H = 20, LOGO_X = 8, LOGO_Y = 5;
    const TEXT_X = _logo ? LOGO_X + LOGO_W + 4 : margin;
    doc.setFillColor(15, 47, 77);
    doc.rect(0, 0, W, 32, 'F');
    if (_logo) {
      try { doc.addImage(_logo, 'PNG', LOGO_X, LOGO_Y, LOGO_W, LOGO_H); } catch (_) {}
    }
    doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(245,200,74);
    doc.text('J&J Apartelle', TEXT_X, 13);
    doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(180,200,220);
    doc.text('Apartelle Management System', TEXT_X, 21);
    doc.setFontSize(8); doc.setTextColor(140,165,190);
    doc.text('Official Acknowledgement Receipt', W - margin, 27, { align: 'right' });
    y = 40;

    // ── RECEIPT TITLE ──
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(15,47,77);
    doc.text('BOOKING RECEIPT', W / 2, y, { align: 'center' });
    y += 5;
    doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139);
    doc.text(`Receipt #: ${b._id.toString().slice(-8).toUpperCase()}`, W / 2, y, { align: 'center' });
    y += 3;
    doc.text(`Issued: ${new Date().toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' })}`, W / 2, y, { align: 'center' });
    y += 6;
    line();

    // ── GUEST INFO ──
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139);
    doc.text('GUEST INFORMATION', margin, y); y += 5;

    const infoLeft = (label, val) => {
      doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139);
      doc.text(label, margin, y);
      doc.setFont('helvetica','bold'); doc.setTextColor(30,41,59);
      doc.text(val || '—', margin + 28, y);
      y += 5.5;
    };
    infoLeft('Guest Name:', b.guestName);
    infoLeft('Contact:', b.guestContact || '—');
    infoLeft('No. of Guests:', String(b.guestCount));
    infoLeft('Booking Source:', b.source);
    y += 1; line();

    // ── BOOKING DETAILS ──
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139);
    doc.text('BOOKING DETAILS', margin, y); y += 5;
    infoLeft('Door:', `Door ${b.doorNumber}`);
    infoLeft('Check-in:', new Date(b.checkIn).toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }));
    infoLeft('Check-out:', new Date(b.checkOut).toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }));
    infoLeft('No. of Nights:', String(b.nights));
    infoLeft('Status:', b.status.toUpperCase());
    y += 1; line();

    // ── CHARGES ──
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139);
    doc.text('CHARGES', margin, y); y += 5;

    const chargeRow = (label, amount, bold = false) => {
      doc.setFontSize(9.5);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(bold ? 15 : 30, bold ? 47 : 41, bold ? 77 : 59);
      doc.text(label, margin, y);
      const amtStr = _pdfFmtMoney(amount);
      doc.text(amtStr, W - margin, y, { align: 'right' });
      y += 5.5;
    };

    chargeRow(`Base Rate: PHP ${Number(b.baseRate).toLocaleString()} x ${b.nights} night${b.nights>1?'s':''}`, b.baseRate * b.nights);
    if (b.extraBeds > 0) {
      chargeRow(`Extra Guests: ${b.extraBeds} x PHP 250 x ${b.nights} night${b.nights>1?'s':''}`, b.extraCharge);
    }

    y += 1;
    doc.setDrawColor(15,47,77); doc.setLineWidth(0.4);
    doc.line(margin, y, W - margin, y); y += 5;

    doc.setFillColor(240, 247, 255);
    doc.roundedRect(margin, y - 3, W - margin*2, 10, 2, 2, 'F');
    chargeRow('TOTAL AMOUNT', b.totalPrice, true);

    y += 6;

    // ── FOOTER ──
    doc.setDrawColor(220,220,220); doc.setLineWidth(0.3);
    doc.line(margin, y, W - margin, y); y += 5;
    doc.setFontSize(8.5); doc.setFont('helvetica','italic'); doc.setTextColor(100,116,139);
    doc.text('Thank you for choosing J&J Apartelle!', W / 2, y, { align: 'center' }); y += 4.5;
    doc.setFontSize(7.5); doc.setFont('helvetica','normal');
    doc.text('We hope you had a wonderful stay. See you again!', W / 2, y, { align: 'center' });

    doc.save(`JJ-Receipt-${b.guestName.replace(/\s+/g,'-')}-Door${b.doorNumber}.pdf`);
    toast('Receipt downloaded');
  } catch (err) {
    toast('Failed to generate receipt: ' + err.message, 'error');
  }
}

/* ══════════════════════════════════════════════
   PDF — HELPERS
   ══════════════════════════════════════════════ */
const VAT_RATE = 0.12;

// Fetches the logo once and caches it as a base64 data URL.
// Returns '' on failure so callers can safely skip addImage().
async function _getLogoBase64() {
  if (_logoBase64Cache !== undefined) return _logoBase64Cache;
  try {
    const res = await fetch('/images/jj-logo.png');
    if (!res.ok) { _logoBase64Cache = ''; return ''; }
    const blob = await res.blob();
    _logoBase64Cache = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result || '');
      reader.onerror  = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch (_) {
    _logoBase64Cache = '';
  }
  return _logoBase64Cache;
}

function _pdfFmtMoney(n) {
  return 'PHP ' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _pdfFmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Draws the standard business header and returns the Y position to continue from.
// logo: base64 data URL (or '' to skip)
function _pdfBizHeader(doc, title, logo) {
  const W        = doc.internal.pageSize.getWidth();
  const LOGO_W   = 22;   // mm
  const LOGO_H   = 22;
  const LOGO_X   = 8;
  const LOGO_Y   = 5;
  const BANNER_H = 33;
  const TEXT_X   = logo ? LOGO_X + LOGO_W + 4 : 14;

  // Dark banner
  doc.setFillColor(15, 47, 77);
  doc.rect(0, 0, W, BANNER_H, 'F');

  // Logo (left side of banner)
  if (logo) {
    try { doc.addImage(logo, 'PNG', LOGO_X, LOGO_Y, LOGO_W, LOGO_H); } catch (_) {}
  }

  // Business name + address
  doc.setFontSize(17); doc.setFont('helvetica', 'bold'); doc.setTextColor(245, 200, 74);
  doc.text(BIZ.name, TEXT_X, 14);
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(180, 200, 220);
  doc.text(BIZ.address, TEXT_X, 22);
  doc.text('TIN: ' + BIZ.tin, TEXT_X, 28);

  // Document title on white area
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 47, 77);
  doc.text(title, W / 2, 45, { align: 'center' });

  // Gold rule
  doc.setDrawColor(180, 150, 60); doc.setLineWidth(0.8);
  doc.line(14, 49, W - 14, 49);

  return 55; // next Y
}

/* ══════════════════════════════════════════════
   PDF — PROFIT & LOSS REPORT
   ══════════════════════════════════════════════ */
async function downloadPnLReport() {
  if (!_currentTransactions.length) {
    toast('No transactions loaded — click View first', 'error');
    return;
  }

  const logo = await _getLogoBase64();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();

  let y = _pdfBizHeader(doc, 'Profit & Loss Report', logo);

  // Period + generated date
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
  doc.text('Period: ' + _currentPeriodLabel, W / 2, y, { align: 'center' });
  doc.text('Generated: ' + _pdfFmtDate(new Date()), W / 2, y + 5, { align: 'center' });
  doc.setTextColor(0);
  y += 13;

  // Totals
  let totalIncome = 0, totalExpense = 0;
  _currentTransactions.forEach(t => {
    if (t.type === 'income') totalIncome += t.amount;
    else totalExpense += t.amount;
  });
  const net      = totalIncome - totalExpense;
  const vatOut   = totalIncome  * VAT_RATE / (1 + VAT_RATE); // VAT inclusive
  const netOfVat = totalIncome  - vatOut;
  const margin   = totalIncome > 0 ? ((net / totalIncome) * 100).toFixed(1) : '0.0';

  // Summary stat boxes
  const boxW = (W - 28 - 8) / 3;
  [
    { label: 'Total Income',   value: _pdfFmtMoney(totalIncome),  color: [22, 163, 74]  },
    { label: 'Total Expenses', value: _pdfFmtMoney(totalExpense), color: [220, 38, 38]  },
    { label: 'Net Profit',     value: _pdfFmtMoney(net),          color: net >= 0 ? [37, 99, 235] : [220, 38, 38] }
  ].forEach((box, i) => {
    const bx = 14 + i * (boxW + 4);
    doc.setFillColor(248, 250, 252); doc.setDrawColor(220, 225, 230);
    doc.roundedRect(bx, y, boxW, 18, 2, 2, 'FD');
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
    doc.text(box.label, bx + boxW / 2, y + 6.5, { align: 'center' });
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...box.color);
    doc.text(box.value, bx + boxW / 2, y + 14, { align: 'center' });
  });
  doc.setTextColor(0);
  y += 24;

  // VAT & margin callout box
  doc.setFillColor(255, 251, 235); doc.setDrawColor(217, 119, 6); doc.setLineWidth(0.5);
  doc.roundedRect(14, y, W - 28, 24, 2, 2, 'FD');
  doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(120, 70, 0);
  doc.text('VAT & Margin Summary (12% VAT-Inclusive on Income)', 18, y + 7);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 50, 0);
  const mid = W / 2 + 4;
  doc.text('Net of VAT (Income):',  18, y + 14); doc.text(_pdfFmtMoney(netOfVat),  90, y + 14, { align: 'right' });
  doc.text('Output VAT (12%):',     18, y + 20); doc.text(_pdfFmtMoney(vatOut),    90, y + 20, { align: 'right' });
  doc.text('Net Profit Margin:',   mid, y + 14); doc.text(margin + '%',            W - 14, y + 14, { align: 'right' });
  doc.text('(Net ÷ Total Income)', mid, y + 20); doc.setTextColor(0);
  y += 30;

  // Itemized transactions table
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 47, 77);
  doc.text('Itemized Transactions', 14, y);
  y += 2;

  doc.autoTable({
    startY: y,
    head: [['Date', 'Type', 'Category', 'Description', 'Amount']],
    body: _currentTransactions.map(t => [
      _pdfFmtDate(t.date),
      t.type.charAt(0).toUpperCase() + t.type.slice(1),
      t.category,
      t.description || '—',
      _pdfFmtMoney(t.amount)
    ]),
    foot: [
      ['', '', '', 'Total Income',   _pdfFmtMoney(totalIncome)],
      ['', '', '', 'Total Expenses', _pdfFmtMoney(totalExpense)],
      ['', '', '', 'Net Profit',     _pdfFmtMoney(net)]
    ],
    styles:      { fontSize: 8, cellPadding: 2.5 },
    headStyles:  { fillColor: [15, 47, 77], textColor: 255, fontStyle: 'bold' },
    footStyles:  { fontStyle: 'bold', fillColor: [240, 244, 248], textColor: [15, 47, 77] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 20 },
      2: { cellWidth: 38 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 32, halign: 'right' }
    },
    didParseCell(data) {
      if (data.section !== 'body') return;
      if (data.column.index === 1) {
        data.cell.styles.textColor = data.cell.raw === 'Income' ? [22, 163, 74] : [220, 38, 38];
      }
      if (data.column.index === 4) {
        // colour amount same as type
        const typeRaw = data.row.cells[1]?.raw || '';
        data.cell.styles.textColor = typeRaw === 'Income' ? [22, 163, 74] : [220, 38, 38];
      }
    },
    margin: { left: 14, right: 14 }
  });

  // Page footers
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(150);
    doc.text(
      `Page ${i} of ${pages}  —  ${BIZ.name}  —  Confidential`,
      W / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' }
    );
  }

  doc.save(`JJ_PnL_${_currentPeriodLabel.replace(/\s+/g, '_')}.pdf`);
  toast('P&L Report downloaded');
}

qs('#pnl-pdf-btn').addEventListener('click', downloadPnLReport);

/* ══════════════════════════════════════════════
   PDF — ACKNOWLEDGEMENT RECEIPT (per income row)
   ══════════════════════════════════════════════ */
async function downloadTransactionReceipt(txId) {
  const t = _currentTransactions.find(x => x._id === txId);
  if (!t) { toast('Transaction not found', 'error'); return; }

  // Fetch linked booking if available
  let booking = null;
  if (t.bookingId) {
    try { booking = await api('GET', `/api/bookings/${t.bookingId}`); } catch (_) {}
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  const W  = doc.internal.pageSize.getWidth();
  const H  = doc.internal.pageSize.getHeight();
  const M  = 14; // margin

  // ── Header ──
  const _rLogo = await _getLogoBase64();
  const R_LOGO_W = 20, R_LOGO_H = 20, R_LOGO_X = 8, R_LOGO_Y = 5;
  const R_TEXT_X = _rLogo ? R_LOGO_X + R_LOGO_W + 4 : M;
  doc.setFillColor(15, 47, 77);
  doc.rect(0, 0, W, 32, 'F');
  if (_rLogo) {
    try { doc.addImage(_rLogo, 'PNG', R_LOGO_X, R_LOGO_Y, R_LOGO_W, R_LOGO_H); } catch (_) {}
  }
  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(245, 200, 74);
  doc.text(BIZ.name, R_TEXT_X, 13);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(180, 200, 220);
  doc.text(BIZ.address, R_TEXT_X, 21);
  doc.text('TIN: ' + BIZ.tin, R_TEXT_X, 27);

  // ── Title ──
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 47, 77);
  doc.text('ACKNOWLEDGEMENT RECEIPT', W / 2, 40, { align: 'center' });

  const receiptNo = txId.slice(-8).toUpperCase();
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
  doc.text('Receipt No: ' + receiptNo,     M,        47);
  doc.text('Date: ' + _pdfFmtDate(t.date), W - M, 47, { align: 'right' });

  doc.setDrawColor(180, 150, 60); doc.setLineWidth(0.6);
  doc.line(M, 50, W - M, 50);

  let y = 58;

  // ── Detail rows helper ──
  const detailRow = (label, value, idx) => {
    if (idx % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M, y - 5, W - M * 2, 8, 'F'); }
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(100, 116, 139);
    doc.text(label + ':', M + 2, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59);
    doc.text(String(value), W / 2 + 2, y);
    y += 8;
  };

  // ── Guest / booking details ──
  const details = booking ? [
    ['Guest Name',       booking.guestName],
    ['Contact',         booking.guestContact || '—'],
    ['Room / Door',     'Door ' + booking.doorNumber],
    ['Check-in',        _pdfFmtDate(booking.checkIn)],
    ['Check-out',       _pdfFmtDate(booking.checkOut)],
    ['No. of Nights',   String(booking.nights)],
    ['Rate per Night',  _pdfFmtMoney(booking.baseRate)],
    ...(booking.extraBeds > 0 ? [['Extra Beds', `${booking.extraBeds} × PHP 250/night`]] : []),
    ['Booking Source',  booking.source]
  ] : [
    ['Category',    t.category],
    ['Description', t.description || '—']
  ];

  details.forEach((d, i) => detailRow(d[0], d[1], i));
  y += 4;

  // ── Amount breakdown box ──
  const gross  = t.amount;
  const vatAmt = gross * VAT_RATE / (1 + VAT_RATE);
  const netAmt = gross - vatAmt;

  doc.setFillColor(240, 248, 255); doc.setDrawColor(180, 210, 240); doc.setLineWidth(0.4);
  doc.roundedRect(M, y, W - M * 2, 30, 2, 2, 'FD');

  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(60);
  doc.text('Net Amount (excl. VAT):',  M + 4, y + 8);
  doc.text(_pdfFmtMoney(netAmt),       W - M - 2, y + 8, { align: 'right' });
  doc.text('VAT 12% (output):',        M + 4, y + 15);
  doc.text(_pdfFmtMoney(vatAmt),       W - M - 2, y + 15, { align: 'right' });

  doc.setDrawColor(150); doc.line(M + 4, y + 18, W - M - 4, y + 18);

  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 47, 77);
  doc.text('TOTAL AMOUNT:',   M + 4,     y + 26);
  doc.text(_pdfFmtMoney(gross), W - M - 2, y + 26, { align: 'right' });
  y += 36;

  // ── Payment Confirmed stamp ──
  doc.setFillColor(220, 252, 231); doc.setDrawColor(34, 197, 94); doc.setLineWidth(1.2);
  doc.roundedRect(W / 2 - 36, y, 72, 13, 3, 3, 'FD');
  doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(21, 128, 61);
  doc.text('✓  PAYMENT CONFIRMED', W / 2, y + 8.5, { align: 'center' });
  doc.setTextColor(0);
  y += 20;

  // ── Signature lines ──
  const sigW = 52;
  doc.setDrawColor(100); doc.setLineWidth(0.4);
  doc.line(M,                 y + 14, M + sigW,          y + 14);
  doc.line(W - M - sigW,      y + 14, W - M,             y + 14);
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
  doc.text('Guest Signature',          M + sigW / 2,          y + 19, { align: 'center' });
  doc.text('Staff / Owner Signature',  W - M - sigW / 2,      y + 19, { align: 'center' });

  // ── Footer ──
  doc.setFontSize(7); doc.setTextColor(150);
  doc.text(
    'This receipt is computer-generated and valid without a wet signature unless signed above.',
    W / 2, H - 7, { align: 'center' }
  );

  const guestLabel = (booking?.guestName || t.category).replace(/\s+/g, '_');
  doc.save(`JJ_Receipt_${receiptNo}_${guestLabel}.pdf`);
  toast('Receipt downloaded');
}

/* ══════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════ */
(async () => {
  await loadRoomRates();
  loadDashboard();
})();
