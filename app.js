const STORAGE_KEY = 'kilas-studio-demo-v1';
const AUTH_STORAGE_KEY = 'kilas-studio-session-v1';
const SUPABASE_URL = 'https://rglyiyqdlzvobglddmqd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_WqvQonmucmniqERcA8m3fQ_-WdcXl0c';
const formatCurrency = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
const formatPhone = (phone) => phone || 'Nomor tidak tersedia';
const dateKey = (date) => {
    const value = new Date(date);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const localDateTime = (date) => `${dateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
const timeFormatter = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const demoRooms = [
    { id: 'room-classic', code: 'ROOM-01', name: 'Ruang Classic', hourly_rate: 85000, capacity: 4 },
    { id: 'room-bloom', code: 'ROOM-02', name: 'Ruang Bloom', hourly_rate: 100000, capacity: 5 },
    { id: 'room-noir', code: 'ROOM-03', name: 'Ruang Noir', hourly_rate: 120000, capacity: 4 },
];

function createDemoData() {
    const customers = [
        ['Nadia Putri', '0812 4567 1023', 0, 10, 'room-bloom', 60, 100000, 'paid'],
        ['Rafi Mahendra', '0813 2088 7152', 0, 13, 'room-classic', 60, 85000, 'pending'],
        ['Salsa Kirana', '0821 7762 4490', 0, 15, 'room-noir', 90, 180000, 'paid'],
        ['Dimas Pratama', '0812 9033 2181', -1, 11, 'room-classic', 60, 85000, 'paid'],
        ['Alya Ramadhani', '0857 1910 3402', -1, 14, 'room-bloom', 120, 200000, 'paid'],
        ['Kevin Aditya', '0819 2440 5638', -2, 16, 'room-noir', 60, 120000, 'pending'],
        ['Mira Anggraini', '0822 6025 1830', -3, 10, 'room-classic', 90, 127500, 'paid'],
        ['Fajar Nugraha', '0811 8392 6017', -4, 13, 'room-bloom', 60, 100000, 'paid'],
    ];
    return customers.map(([name, phone, dayOffset, hour, roomId, duration, total, paymentStatus], index) => {
        const start = new Date();
        start.setDate(start.getDate() + dayOffset);
        start.setHours(hour, index % 2 ? 30 : 0, 0, 0);
        const room = demoRooms.find((item) => item.id === roomId);
        return {
            id: `demo-reservation-${index + 1}`,
            customer_id: `demo-customer-${index + 1}`,
            room_id: roomId,
            starts_at: start.toISOString(),
            duration_minutes: duration,
            total_price: total,
            status: 'confirmed',
            customer: { full_name: name, phone },
            room: { name: room.name, code: room.code },
            payment: { id: `demo-payment-${index + 1}`, amount: total, status: paymentStatus, method: paymentStatus === 'paid' ? 'qris' : null },
        };
    });
}

const state = {
    rooms: demoRooms,
    reservations: loadDemoReservations(),
    filter: 'all',
    query: '',
    range: 7,
    live: false,
    editingReservationId: null,
    accessToken: null,
};
let toastTimer;

function loadDemoReservations() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (Array.isArray(saved) && saved.length) return saved;
    } catch { /* Use fresh sample data when browser storage is unavailable. */ }
    return createDemoData();
}

function saveDemoReservations() {
    if (!state.live) localStorage.setItem(STORAGE_KEY, JSON.stringify(state.reservations));
}

function storeSession(session) {
    const expiresAt = Number(session.expires_at || (Date.now() / 1000 + Number(session.expires_in || 0)));
    const savedSession = { accessToken: session.access_token, expiresAt };
    state.accessToken = savedSession.accessToken;
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(savedSession));
}

function restoreSession() {
    try {
        const session = JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY));
        if (session?.accessToken && Number(session.expiresAt) > Date.now() / 1000 + 30) {
            state.accessToken = session.accessToken;
            return true;
        }
    } catch { /* Start at login when there is no valid saved session. */ }
    clearSession();
    return false;
}

function clearSession() {
    state.accessToken = null;
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

async function supabaseFetch(path, options = {}) {
    const { withAuth = true, ...requestOptions } = options;
    const headers = new Headers(requestOptions.headers || {});
    headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
    if (withAuth && state.accessToken) {
        headers.set('Authorization', `Bearer ${state.accessToken}`);
    }
    const response = await fetch(`${SUPABASE_URL}${path}`, {
        ...requestOptions,
        headers,
        body: requestOptions.body && typeof requestOptions.body !== 'string'
            ? JSON.stringify(requestOptions.body)
            : requestOptions.body,
    });
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!response.ok) {
        const error = new Error(payload?.msg || payload?.message || payload?.error_description || payload?.error || 'Permintaan ke Supabase gagal.');
        error.status = response.status;
        throw error;
    }
    return payload;
}

function showLogin(message = '') {
    document.querySelector('.app-shell').hidden = true;
    document.querySelector('#login-screen').hidden = false;
    const error = document.querySelector('#login-error');
    error.textContent = message;
    error.hidden = !message;
}

function showDashboard() {
    document.querySelector('#login-screen').hidden = true;
    document.querySelector('.app-shell').hidden = false;
}

async function submitLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.querySelector('#login-submit');
    const error = document.querySelector('#login-error');
    const values = new FormData(form);
    button.disabled = true;
    button.textContent = 'Memeriksa...';
    error.hidden = true;
    try {
        const result = await supabaseFetch('/auth/v1/token?grant_type=password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { email: values.get('email'), password: values.get('password') },
            withAuth: false,
        });
        if (!result.access_token) throw new Error('Sesi login tidak diterima. Coba lagi.');
        storeSession(result);
        showDashboard();
        await loadDashboard();
    } catch (loginError) {
        error.textContent = loginError.message || 'Login gagal. Coba lagi.';
        error.hidden = false;
    } finally {
        button.disabled = false;
        button.innerHTML = 'Masuk <span aria-hidden="true">→</span>';
    }
}

async function signOut() {
    try {
        if (state.accessToken) await supabaseFetch('/auth/v1/logout', { method: 'POST' });
    } catch { /* Clear the local session even if the network is unavailable. */ }
    clearSession();
    document.querySelector('#login-form').reset();
    showLogin();
}

function normalizeReservation(row) {
    return {
        ...row,
        customer: Array.isArray(row.customer) ? row.customer[0] : row.customer,
        room: Array.isArray(row.room) ? row.room[0] : row.room,
        payment: Array.isArray(row.payment) ? row.payment[0] : row.payment,
    };
}

async function loadDashboard() {
    try {
        const [rooms, reservations] = await Promise.all([
            supabaseFetch('/rest/v1/studio_rooms?select=id,name,code,hourly_rate,capacity&active=eq.true&order=code.asc'),
            supabaseFetch('/rest/v1/reservations?select=*,customer:customers(id,full_name,phone),room:studio_rooms(name,code),payment:payments(id,amount,status,method,paid_at)&order=starts_at.desc&limit=100'),
        ]);
        state.rooms = rooms.length ? rooms : demoRooms;
        state.reservations = reservations.map(normalizeReservation);
        state.live = true;
        document.querySelector('#connection-state').classList.add('connected');
        document.querySelector('#connection-state span').textContent = 'Supabase terhubung';
    } catch (error) {
        if (error.status === 401 || error.status === 403) {
            clearSession();
            showLogin('Sesi berakhir atau akses database ditolak. Periksa konfigurasi Supabase lalu masuk kembali.');
            return;
        }
        state.live = false;
        document.querySelector('#connection-state').classList.remove('connected');
        document.querySelector('#connection-state span').textContent = 'Demo lokal';
    }
    render();
}

function todayReservations() {
    const today = dateKey(new Date());
    return state.reservations.filter((item) => dateKey(item.starts_at) === today && item.status !== 'cancelled');
}

function paidReservations() {
    return state.reservations.filter((item) => item.payment?.status === 'paid');
}

function renderStats() {
    const today = todayReservations();
    const paidToday = today.filter((item) => item.payment?.status === 'paid');
    const revenue = paidToday.reduce((sum, item) => sum + Number(item.payment?.amount || item.total_price), 0);
    const average = paidToday.length ? revenue / paidToday.length : 0;
    const now = new Date();
    const roomsBusy = new Set(today.filter((item) => {
        const start = new Date(item.starts_at);
        const end = new Date(start.getTime() + Number(item.duration_minutes) * 60000);
        return now >= start && now < end;
    }).map((item) => item.room_id));
    document.querySelector('#today-revenue').textContent = formatCurrency(revenue);
    document.querySelector('#today-bookings').textContent = today.length;
    document.querySelector('#booking-footnote').textContent = `${today.filter((item) => item.payment?.status === 'pending').length} menunggu pembayaran`;
    document.querySelector('#average-value').textContent = formatCurrency(average);
    document.querySelector('#available-rooms').textContent = Math.max(0, state.rooms.length - roomsBusy.size);
    document.querySelector('#total-rooms').textContent = state.rooms.length;
    document.querySelector('#room-footnote').textContent = roomsBusy.size ? `${roomsBusy.size} ruangan sedang dipakai` : 'Siap menerima sesi';
    document.querySelector('#nav-count').textContent = today.length;
    document.querySelector('#pending-count').textContent = state.reservations.filter((item) => item.payment?.status === 'pending').length;
    document.querySelector('#all-count').textContent = state.reservations.length;
}

function chartData() {
    const dayCount = Number(state.range);
    const today = new Date();
    const values = Array.from({ length: dayCount }, (_, index) => {
        const day = new Date(today);
        day.setDate(today.getDate() - (dayCount - index - 1));
        return { date: day, amount: 0 };
    });
    const byDate = new Map(values.map((item) => [dateKey(item.date), item]));
    for (const reservation of paidReservations()) {
        const day = byDate.get(dateKey(reservation.starts_at));
        if (day) day.amount += Number(reservation.payment?.amount || reservation.total_price);
    }
    return values;
}

function renderChart() {
    const points = chartData();
    const total = points.reduce((sum, item) => sum + item.amount, 0);
    const maximum = Math.max(...points.map((item) => item.amount), 1);
    const width = 620;
    const height = 140;
    const left = 4;
    const right = 8;
    const top = 9;
    const baseline = 111;
    const xStep = points.length > 1 ? (width - left - right) / (points.length - 1) : 0;
    const coordinates = points.map((item, index) => ({
        x: left + index * xStep,
        y: baseline - (item.amount / maximum) * (baseline - top - 8),
        ...item,
    }));
    const line = coordinates.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    const area = `${line} L ${coordinates.at(-1).x} ${baseline} L ${coordinates[0].x} ${baseline} Z`;
    const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    const grid = [0, 1, 2].map((index) => {
        const y = top + index * ((baseline - top) / 2);
        return `<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width}" y2="${y}" />`;
    }).join('');
    const dots = coordinates.map((point, index) => index === coordinates.length - 1 || (dayCountIsWeek() && point.amount > 0)
        ? `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="3.5" />` : '').join('');
    const labels = labelIndexes.map((index) => {
        const point = coordinates[index];
        return `<text class="chart-label" x="${point.x}" y="133" text-anchor="${index === 0 ? 'start' : index === coordinates.length - 1 ? 'end' : 'middle'}">${dateFormatter.format(point.date)}</text>`;
    }).join('');
    document.querySelector('#period-revenue').textContent = formatCurrency(total);
    document.querySelector('#period-label').textContent = `${state.range} hari terakhir`;
    document.querySelector('#revenue-chart').setAttribute('aria-label', `Grafik pendapatan ${state.range} hari terakhir, total ${formatCurrency(total)}`);
    document.querySelector('#revenue-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#74aa87" stop-opacity=".20"/><stop offset="100%" stop-color="#74aa87" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>${dots}${labels}</svg>`;
}

function dayLabel(date) {
    const value = new Date(date);
    if (dateKey(value) === dateKey(new Date())) return 'Hari ini';
    return new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }).format(value);
}

function renderRooms() {
    const now = new Date();
    const today = todayReservations();
    document.querySelector('#room-list').innerHTML = state.rooms.map((room) => {
        const busy = today.some((item) => {
            if (item.room_id !== room.id) return false;
            const start = new Date(item.starts_at);
            return now >= start && now < new Date(start.getTime() + Number(item.duration_minutes) * 60000);
        });
        return `<div class="room-item"><span class="room-thumb" aria-hidden="true"><span></span></span><span class="room-meta"><strong>${escapeHtml(room.name)}</strong><small>${escapeHtml(room.code)} · ${formatCurrency(room.hourly_rate)}/jam</small></span><span class="room-status${busy ? ' busy' : ''}">${busy ? 'Sedang dipakai' : 'Tersedia'}</span></div>`;
    }).join('') || '<div class="empty-state"><strong>Belum ada ruangan</strong></div>';
    document.querySelector('#room-select').innerHTML = state.rooms.map((room) => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.name)} · ${formatCurrency(room.hourly_rate)}/jam</option>`).join('');
    updateEstimate();
}

function filteredReservations() {
    const query = state.query.toLocaleLowerCase('id');
    return state.reservations.filter((item) => {
        const person = item.customer?.full_name || '';
        const room = item.room?.name || state.rooms.find((candidate) => candidate.id === item.room_id)?.name || '';
        const matchesQuery = `${person} ${room}`.toLocaleLowerCase('id').includes(query);
        const matchesFilter = state.filter === 'all'
            || (state.filter === 'pending' && item.payment?.status === 'pending')
            || (state.filter === 'today' && dateKey(item.starts_at) === dateKey(new Date()));
        return matchesQuery && matchesFilter;
    }).sort((first, second) => new Date(second.starts_at) - new Date(first.starts_at));
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderReservations() {
    const items = filteredReservations();
    const rows = document.querySelector('#reservation-rows');
    document.querySelector('#empty-state').hidden = items.length > 0;
    rows.innerHTML = items.map((item) => {
        const customer = item.customer || {};
        const room = item.room || state.rooms.find((candidate) => candidate.id === item.room_id) || {};
        const start = new Date(item.starts_at);
        const end = new Date(start.getTime() + Number(item.duration_minutes) * 60000);
        const paymentStatus = item.payment?.status || 'pending';
        const statusLabel = { paid: 'Lunas', pending: 'Belum lunas', refunded: 'Dikembalikan' }[paymentStatus] || paymentStatus;
        const avatar = (customer.full_name || '?').split(/\s+/).slice(0, 2).map((name) => name[0]).join('').toLocaleUpperCase('id');
        const paymentAction = paymentStatus === 'pending'
            ? `<button class="table-action" type="button" data-payment-id="${escapeHtml(item.payment?.id || '')}" data-reservation-id="${escapeHtml(item.id)}">Tandai lunas</button>`
            : '';
        const editAction = `<button class="table-action" type="button" data-action="edit" data-reservation-id="${escapeHtml(item.id)}">Edit</button>`;
        const deleteAction = `<button class="table-action danger" type="button" data-action="delete" data-reservation-id="${escapeHtml(item.id)}">Hapus</button>`;
        return `<tr><td><div class="customer-cell"><span class="customer-avatar">${escapeHtml(avatar)}</span><span class="customer-info"><strong>${escapeHtml(customer.full_name || 'Pelanggan')}</strong><small>${escapeHtml(formatPhone(customer.phone))}</small></span></div></td><td><span class="schedule-cell"><strong>${escapeHtml(dayLabel(start))}, ${escapeHtml(timeFormatter.format(start))}–${escapeHtml(timeFormatter.format(end))}</strong><small>${Number(item.duration_minutes) / 60} jam · ${escapeHtml(dateFormatter.format(start))}</small></span></td><td><span class="room-cell"><i></i>${escapeHtml(room.name || 'Ruangan')}</span></td><td><span class="amount-cell">${formatCurrency(item.payment?.amount || item.total_price)}</span></td><td><span class="payment-badge ${paymentStatus}"><i></i>${escapeHtml(statusLabel)}</span></td><td><div class="table-actions">${paymentAction}${editAction}${deleteAction}</div></td></tr>`;
    }).join('');
    document.querySelector('#table-summary').textContent = `Menampilkan ${items.length} dari ${state.reservations.length} reservasi`;
}

function render() {
    renderStats();
    renderChart();
    renderRooms();
    renderReservations();
}

function updateEstimate() {
    const room = state.rooms.find((item) => item.id === document.querySelector('#room-select').value) || state.rooms[0];
    const duration = Number(document.querySelector('[name="duration_minutes"]').value || 60);
    document.querySelector('#price-estimate').textContent = formatCurrency(room ? Number(room.hourly_rate) * duration / 60 : 0);
}

function openDialog(reservation = null) {
    const dialog = document.querySelector('#booking-dialog');
    setBookingDialogMode(reservation);
    if (typeof dialog.showModal === 'function') dialog.showModal();
}

function showToast(message) {
    const toast = document.querySelector('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function setBookingDialogMode(reservation = null) {
    const form = document.querySelector('#booking-form');
    const title = document.querySelector('#dialog-title');
    const submitButton = document.querySelector('#submit-booking');
    const dateInput = document.querySelector('#booking-date');
    dateInput.min = dateKey(new Date());

    if (reservation) {
        const start = new Date(reservation.starts_at);
        const room = reservation.room || state.rooms.find((item) => item.id === reservation.room_id) || state.rooms[0];
        title.textContent = 'Edit reservasi';
        submitButton.innerHTML = 'Perbarui reservasi <span aria-hidden="true">→</span>';
        form.elements.customer_name.value = reservation.customer?.full_name || '';
        form.elements.phone.value = reservation.customer?.phone || '';
        form.elements.room_id.value = room ? room.id : '';
        form.elements.date.value = dateKey(start);
        form.elements.time.value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
        form.elements.duration_minutes.value = String(reservation.duration_minutes || 60);
        form.elements.notes.value = reservation.notes || '';
        state.editingReservationId = reservation.id;
    } else {
        title.textContent = 'Buat reservasi';
        submitButton.innerHTML = 'Simpan reservasi <span aria-hidden="true">→</span>';
        form.reset();
        form.elements.time.value = '10:00';
        form.elements.date.value = dateKey(new Date());
        form.elements.duration_minutes.value = '60';
        if (state.rooms.length) form.elements.room_id.value = state.rooms[0].id;
        state.editingReservationId = null;
    }
    updateEstimate();
    document.querySelector('#form-error').hidden = true;
}

async function submitBooking(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = document.querySelector('#submit-booking');
    const errorMessage = document.querySelector('#form-error');
    const values = new FormData(form);
    const startsAt = new Date(`${values.get('date')}T${values.get('time')}`);
    const payload = {
        customer_name: values.get('customer_name').trim(),
        phone: values.get('phone').trim(),
        room_id: values.get('room_id'),
        starts_at: startsAt.toISOString(),
        duration_minutes: Number(values.get('duration_minutes')),
        notes: values.get('notes').trim(),
    };
    if (startsAt <= new Date()) {
        errorMessage.textContent = 'Pilih waktu reservasi yang akan datang.';
        errorMessage.hidden = false;
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Menyimpan...';
    errorMessage.hidden = true;
    try {
        const isEditing = Boolean(state.editingReservationId);
        if (state.live) {
            const room = state.rooms.find((item) => item.id === payload.room_id);
            if (!room) throw new Error('Ruangan tidak ditemukan.');
            const totalPrice = Math.round(Number(room.hourly_rate) * payload.duration_minutes / 60 * 100) / 100;
            const headers = { 'Content-Type': 'application/json', Prefer: 'return=representation' };
            let customerId;

            if (isEditing) {
                const existing = state.reservations.find((item) => item.id === state.editingReservationId);
                customerId = existing?.customer?.id;
                if (!customerId) throw new Error('Data pelanggan tidak ditemukan untuk reservasi ini.');
                await supabaseFetch(`/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}`, {
                    method: 'PATCH',
                    headers,
                    body: { full_name: payload.customer_name, phone: payload.phone },
                });
            } else {
                const customers = await supabaseFetch('/rest/v1/customers?on_conflict=phone', {
                    method: 'POST',
                    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
                    body: { full_name: payload.customer_name, phone: payload.phone },
                });
                customerId = customers[0]?.id;
                if (!customerId) throw new Error('Data pelanggan gagal disimpan.');
            }

            const reservationBody = {
                customer_id: customerId,
                room_id: payload.room_id,
                starts_at: payload.starts_at,
                duration_minutes: payload.duration_minutes,
                total_price: totalPrice,
                notes: payload.notes,
            };
            const reservationPath = isEditing
                ? `/rest/v1/reservations?id=eq.${encodeURIComponent(state.editingReservationId)}`
                : '/rest/v1/reservations';
            await supabaseFetch(reservationPath, {
                method: isEditing ? 'PATCH' : 'POST',
                headers,
                body: reservationBody,
            });
            await loadDashboard();
        } else {
            const room = state.rooms.find((item) => item.id === payload.room_id);
            if (!room) throw new Error('Ruangan tidak ditemukan.');
            const totalPrice = Number(room.hourly_rate) * payload.duration_minutes / 60;
            if (isEditing) {
                const index = state.reservations.findIndex((item) => item.id === state.editingReservationId);
                if (index >= 0) {
                    state.reservations[index] = {
                        ...state.reservations[index],
                        room_id: room.id,
                        starts_at: startsAt.toISOString(),
                        duration_minutes: payload.duration_minutes,
                        total_price: totalPrice,
                        notes: payload.notes,
                        customer: { full_name: payload.customer_name, phone: payload.phone },
                        room: { name: room.name, code: room.code },
                        payment: {
                            ...(state.reservations[index].payment || {}),
                            amount: totalPrice,
                            status: state.reservations[index].payment?.status || 'pending',
                            method: state.reservations[index].payment?.method || null,
                        },
                    };
                }
            } else {
                state.reservations.unshift({
                    id: `demo-${crypto.randomUUID()}`,
                    room_id: room.id,
                    starts_at: startsAt.toISOString(),
                    duration_minutes: payload.duration_minutes,
                    total_price: totalPrice,
                    status: 'confirmed',
                    customer: { full_name: payload.customer_name, phone: payload.phone },
                    room: { name: room.name, code: room.code },
                    payment: { id: `demo-payment-${crypto.randomUUID()}`, amount: totalPrice, status: 'pending', method: null },
                });
            }
            saveDemoReservations();
            render();
        }
        document.querySelector('#booking-dialog').close();
        form.reset();
        setBookingDialogMode();
        showToast(isEditing ? 'Reservasi berhasil diperbarui.' : (state.live ? 'Reservasi tersimpan di Supabase.' : 'Reservasi ditambahkan ke demo lokal.'));
    } catch (error) {
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = state.editingReservationId
            ? 'Perbarui reservasi <span aria-hidden="true">→</span>'
            : 'Simpan reservasi <span aria-hidden="true">→</span>';
    }
}

async function deleteReservation(button) {
    const reservationId = button.dataset.reservationId;
    const reservation = state.reservations.find((item) => item.id === reservationId);
    if (!reservation) return;

    const confirmed = window.confirm(`Hapus reservasi milik ${reservation.customer?.full_name || 'pelanggan ini'}?`);
    if (!confirmed) return;

    try {
        if (state.live) {
            await supabaseFetch(`/rest/v1/reservations?id=eq.${encodeURIComponent(reservationId)}`, {
                method: 'DELETE',
                headers: { Prefer: 'return=representation' },
            });
            await loadDashboard();
        } else {
            state.reservations = state.reservations.filter((item) => item.id !== reservationId);
            saveDemoReservations();
            render();
        }
        showToast('Reservasi berhasil dihapus.');
    } catch (error) {
        showToast(error.message);
    }
}

async function markPaid(button) {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Menyimpan';
    try {
        if (state.live) {
            await supabaseFetch(`/rest/v1/payments?id=eq.${encodeURIComponent(button.dataset.paymentId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
                body: { status: 'paid', method: 'qris', paid_at: new Date().toISOString() },
            });
            await loadDashboard();
        } else {
            const reservation = state.reservations.find((item) => item.id === button.dataset.reservationId);
            if (reservation) reservation.payment.status = 'paid';
            saveDemoReservations();
            render();
        }
        showToast('Pembayaran berhasil ditandai lunas.');
    } catch (error) {
        button.disabled = false;
        button.textContent = originalLabel;
        showToast(error.message);
    }
}

function initialize() {
    const today = new Date();
    document.querySelector('#login-year').textContent = today.getFullYear();
    const headingDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(today);
    document.querySelector('#heading-date').textContent = headingDate.toLocaleUpperCase('id');
    document.querySelector('#sidebar-date').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }).format(today);
    document.querySelector('#copyright-year').textContent = today.getFullYear();
    document.querySelector('.heading-eyebrow').childNodes[0].textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long' }).format(today).toLocaleUpperCase('id') + ', ';
    document.querySelector('#new-booking-button').addEventListener('click', openDialog);
    document.querySelector('#login-form').addEventListener('submit', submitLogin);
    document.querySelector('#logout-button').addEventListener('click', signOut);
    document.querySelector('#table-booking-button').addEventListener('click', openDialog);
    document.querySelector('#close-dialog').addEventListener('click', () => document.querySelector('#booking-dialog').close());
    document.querySelector('#cancel-dialog').addEventListener('click', () => document.querySelector('#booking-dialog').close());
    document.querySelector('#booking-form').addEventListener('submit', submitBooking);
    document.querySelector('#room-select').addEventListener('change', updateEstimate);
    document.querySelector('[name="duration_minutes"]').addEventListener('change', updateEstimate);
    document.querySelector('#chart-range').addEventListener('change', (event) => { state.range = Number(event.target.value); renderChart(); });
    document.querySelector('#reservation-search').addEventListener('input', (event) => { state.query = event.target.value; renderReservations(); });
    document.querySelectorAll('.filter-tab').forEach((tab) => tab.addEventListener('click', () => {
        state.filter = tab.dataset.filter;
        document.querySelectorAll('.filter-tab').forEach((item) => item.classList.toggle('active', item === tab));
        renderReservations();
    }));
    document.querySelector('#reservation-rows').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-reservation-id]');
        if (!button) return;

        if (button.dataset.action === 'edit') {
            const reservation = state.reservations.find((item) => item.id === button.dataset.reservationId);
            if (reservation) openDialog(reservation);
            return;
        }

        if (button.dataset.action === 'delete') {
            await deleteReservation(button);
            return;
        }

        if (button.dataset.paymentId) markPaid(button);
    });
    document.querySelector('#show-all-button').addEventListener('click', loadDashboard);
    document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => {
        document.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item === link));
    }));
    document.querySelector('#chart-range').value = String(state.range);
    if (restoreSession()) {
        showDashboard();
        render();
        loadDashboard();
    } else {
        showLogin();
    }
}

function dayCountIsWeek() {
    return Number(state.range) === 7;
}

initialize();
