const STORAGE_KEY = 'kilas-studio-demo-v2';
const AUTH_STORAGE_KEY = 'kilas-studio-session-v1';
const SUPABASE_URL = 'https://rglyiyqdlzvobglddmqd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_WqvQonmucmniqERcA8m3fQ_-WdcXl0c';
const OVERVIEW_ROW_LIMIT = 6;
const PHONE_PATTERN = /^\+?[0-9\s().-]{8,20}$/;

const VIEWS = {
    overview: { title: 'Ringkasan', subtitle: 'Pantau sesi dan pemasukan studio hari ini.' },
    reservations: { title: 'Reservasi', subtitle: 'Kelola jadwal, data pelanggan, dan status pembayaran.' },
    rooms: { title: 'Ruangan', subtitle: 'Status terkini dan jadwal berikutnya untuk setiap ruangan.' },
    revenue: { title: 'Pendapatan', subtitle: 'Pemasukan dari transaksi lunas, per ruangan dan metode pembayaran.' },
};
const PAYMENT_LABELS = { paid: 'Lunas', pending: 'Belum lunas', refunded: 'Dikembalikan' };
const METHOD_LABELS = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer bank', card: 'Kartu' };

const formatCurrency = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
const formatPhone = (phone) => phone || 'Nomor tidak tersedia';
const dateKey = (date) => {
    const value = new Date(date);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
const timeFormatter = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const $ = (selector) => document.querySelector(selector);
const demoRooms = [
    { id: 'room-classic', code: 'ROOM-01', name: 'Ruang Classic', hourly_rate: 300000, capacity: 5 },
    { id: 'room-bloom', code: 'ROOM-02', name: 'Ruang Bloom', hourly_rate: 500000, capacity: 10 },
    { id: 'room-noir', code: 'ROOM-03', name: 'Ruang Noir', hourly_rate: 1200000, capacity: 30 },
];

function createDemoData() {
    const customers = [
        ['Nadia Putri', '0812 4567 1023', 0, 10, 'room-bloom', 60, 'paid'],
        ['Rafi Mahendra', '0813 2088 7152', 0, 13, 'room-classic', 60, 'pending'],
        ['Salsa Kirana', '0821 7762 4490', 0, 15, 'room-noir', 90, 'paid'],
        ['Dimas Pratama', '0812 9033 2181', -1, 11, 'room-classic', 60, 'paid'],
        ['Alya Ramadhani', '0857 1910 3402', -1, 14, 'room-bloom', 120, 'paid'],
        ['Kevin Aditya', '0819 2440 5638', -2, 16, 'room-noir', 60, 'pending'],
        ['Mira Anggraini', '0822 6025 1830', -3, 10, 'room-classic', 90, 'paid'],
        ['Fajar Nugraha', '0811 8392 6017', -4, 13, 'room-bloom', 60, 'paid'],
    ];
    return customers.map(([name, phone, dayOffset, hour, roomId, duration, paymentStatus], index) => {
        const start = new Date();
        start.setDate(start.getDate() + dayOffset);
        start.setHours(hour, index % 2 ? 30 : 0, 0, 0);
        const room = demoRooms.find((item) => item.id === roomId);
        const total = room.hourly_rate * duration / 60;
        return {
            id: `demo-reservation-${index + 1}`,
            customer_id: `demo-customer-${index + 1}`,
            room_id: roomId,
            starts_at: start.toISOString(),
            duration_minutes: duration,
            total_price: total,
            status: 'confirmed',
            notes: '',
            customer: { id: `demo-customer-${index + 1}`, full_name: name, phone },
            room: { name: room.name, code: room.code },
            payment: {
                id: `demo-payment-${index + 1}`,
                amount: total,
                status: paymentStatus,
                method: paymentStatus === 'paid' ? ['qris', 'cash', 'transfer'][index % 3] : null,
                paid_at: paymentStatus === 'paid' ? start.toISOString() : null,
            },
        };
    });
}

const state = {
    rooms: demoRooms,
    reservations: loadDemoReservations(),
    filter: 'all',
    query: '',
    range: 7,
    view: 'overview',
    live: false,
    editingReservationId: null,
    payingReservationId: null,
    accessToken: null,
    email: '',
};
let toastTimer;

/* ---------- Penyimpanan lokal & sesi ---------- */

function loadDemoReservations() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (Array.isArray(saved) && saved.length) return saved;
    } catch { /* Pakai data contoh jika penyimpanan browser tidak tersedia. */ }
    return createDemoData();
}

function saveDemoReservations() {
    if (state.live) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.reservations));
    } catch { /* Mode demo tetap berjalan walau penyimpanan browser diblokir. */ }
}

function storeSession(session) {
    const expiresAt = Number(session.expires_at || (Date.now() / 1000 + Number(session.expires_in || 0)));
    const savedSession = { accessToken: session.access_token, expiresAt, email: session.user?.email || '' };
    state.accessToken = savedSession.accessToken;
    state.email = savedSession.email;
    try {
        sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(savedSession));
    } catch { /* Sesi tetap berlaku sampai halaman ditutup. */ }
}

function restoreSession() {
    try {
        const session = JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY));
        if (session?.accessToken && Number(session.expiresAt) > Date.now() / 1000 + 30) {
            state.accessToken = session.accessToken;
            state.email = session.email || '';
            return true;
        }
    } catch { /* Mulai dari halaman login jika tidak ada sesi yang valid. */ }
    clearSession();
    return false;
}

function clearSession() {
    state.accessToken = null;
    state.email = '';
    try {
        sessionStorage.removeItem(AUTH_STORAGE_KEY);
    } catch { /* Tidak ada yang perlu dihapus. */ }
}

/* ---------- Koneksi Supabase ---------- */

function friendlyErrorMessage(payload, status) {
    const code = payload?.code;
    const raw = payload?.msg || payload?.message || payload?.error_description || payload?.error || '';
    if (code === '23P01') return 'Jadwal bentrok: ruangan ini sudah dipesan pada rentang waktu tersebut. Pilih jam atau ruangan lain.';
    if (code === '23505') return 'Nomor telepon sudah dipakai pelanggan lain.';
    if (code === '23514') return 'Data tidak memenuhi aturan database (misalnya durasi atau nilai harga).';
    if (/invalid login credentials/i.test(raw)) return 'Email atau password salah.';
    if (/email not confirmed/i.test(raw)) return 'Email belum dikonfirmasi. Konfirmasi user di Supabase Dashboard.';
    if (status === 401 || status === 403) return 'Sesi berakhir atau akses ditolak. Silakan masuk kembali.';
    return raw || 'Permintaan ke Supabase gagal.';
}

async function supabaseFetch(path, options = {}) {
    const { withAuth = true, ...requestOptions } = options;
    const headers = new Headers(requestOptions.headers || {});
    headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
    if (withAuth && state.accessToken) headers.set('Authorization', `Bearer ${state.accessToken}`);
    if (requestOptions.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    let response;
    try {
        response = await fetch(`${SUPABASE_URL}${path}`, {
            ...requestOptions,
            headers,
            body: requestOptions.body && typeof requestOptions.body !== 'string'
                ? JSON.stringify(requestOptions.body)
                : requestOptions.body,
        });
    } catch {
        const error = new Error('Tidak dapat terhubung ke Supabase. Periksa koneksi internet atau status project.');
        error.status = 0;
        throw error;
    }
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!response.ok) {
        const error = new Error(friendlyErrorMessage(payload, response.status));
        error.status = response.status;
        error.code = payload?.code;
        throw error;
    }
    return payload;
}

/* ---------- Login & logout ---------- */

function showLogin(message = '') {
    $('.app-shell').hidden = true;
    $('#login-screen').hidden = false;
    const error = $('#login-error');
    error.textContent = message;
    error.hidden = !message;
}

function showDashboard() {
    $('#login-screen').hidden = true;
    $('.app-shell').hidden = false;
    renderProfile();
}

function renderProfile() {
    const email = state.email || '';
    $('#profile-email').textContent = email || 'Pengelola';
    const initial = (email[0] || 'A').toLocaleUpperCase('id');
    $('#topbar-avatar').textContent = initial;
    $('#profile-avatar').textContent = email ? email.slice(0, 2).toLocaleUpperCase('id') : 'KS';
}

async function submitLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('#login-submit');
    const error = $('#login-error');
    const values = new FormData(form);
    button.disabled = true;
    button.textContent = 'Memeriksa...';
    error.hidden = true;
    try {
        const result = await supabaseFetch('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: { email: String(values.get('email')).trim(), password: values.get('password') },
            withAuth: false,
        });
        if (!result?.access_token) throw new Error('Sesi login tidak diterima. Coba lagi.');
        storeSession(result);
        form.reset();
        showDashboard();
        applyView();
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
    } catch { /* Sesi lokal tetap dihapus walau jaringan tidak tersedia. */ }
    clearSession();
    $('#login-form').reset();
    showLogin();
}

/* ---------- Memuat data ---------- */

function normalizeReservation(row) {
    return {
        ...row,
        customer: Array.isArray(row.customer) ? row.customer[0] : row.customer,
        room: Array.isArray(row.room) ? row.room[0] : row.room,
        payment: Array.isArray(row.payment) ? row.payment[0] : row.payment,
    };
}

function setConnectionState(live) {
    $('#connection-state').classList.toggle('connected', live);
    $('#connection-state span').textContent = live ? 'Supabase terhubung' : 'Demo lokal';
}

async function loadDashboard() {
    try {
        const [rooms, reservations] = await Promise.all([
            supabaseFetch('/rest/v1/studio_rooms?select=id,name,code,hourly_rate,capacity&active=eq.true&order=code.asc'),
            supabaseFetch('/rest/v1/reservations?select=*,customer:customers(id,full_name,phone),room:studio_rooms(id,name,code),payment:payments(id,amount,status,method,paid_at)&order=starts_at.desc&limit=200'),
        ]);
        if (!rooms.length) showToast('Tabel ruangan kosong. Jalankan schema.sql untuk menambahkan data ruangan.');
        state.rooms = rooms;
        state.reservations = reservations.map(normalizeReservation);
        state.live = true;
        setConnectionState(true);
    } catch (error) {
        if (error.status === 401 || error.status === 403) {
            clearSession();
            showLogin('Sesi berakhir atau akses database ditolak. Silakan masuk kembali.');
            return;
        }
        state.live = false;
        state.rooms = demoRooms;
        state.reservations = loadDemoReservations();
        setConnectionState(false);
        showToast('Supabase tidak terjangkau. Menampilkan data demo lokal (tidak tersimpan ke database).');
    }
    render();
}

/* ---------- Helper data ---------- */

const isCancelled = (item) => item.status === 'cancelled';
const isPending = (item) => item.payment?.status === 'pending' && !isCancelled(item);
const amountOf = (item) => Number(item.payment?.amount ?? item.total_price) || 0;
const endOf = (item) => new Date(new Date(item.starts_at).getTime() + Number(item.duration_minutes) * 60000);
const roomOf = (item) => state.rooms.find((room) => room.id === item.room_id) || item.room || {};
const isRunningNow = (item, now = new Date()) => !isCancelled(item) && now >= new Date(item.starts_at) && now < endOf(item);

function todayReservations() {
    const today = dateKey(new Date());
    return state.reservations.filter((item) => dateKey(item.starts_at) === today && !isCancelled(item));
}

function rangeStart() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (Number(state.range) - 1));
    return start;
}

function reservationsInRange() {
    const start = rangeStart();
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return state.reservations.filter((item) => {
        const time = new Date(item.starts_at);
        return time >= start && time <= end;
    });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function durationLabel(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return [hours ? `${hours} jam` : '', rest ? `${rest} menit` : ''].filter(Boolean).join(' ');
}

function dayLabel(date) {
    const value = new Date(date);
    if (dateKey(value) === dateKey(new Date())) return 'Hari ini';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateKey(value) === dateKey(tomorrow)) return 'Besok';
    return new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }).format(value);
}

/* ---------- Navigasi menu ---------- */

function currentViewFromHash() {
    const view = window.location.hash.replace('#', '');
    return VIEWS[view] ? view : 'overview';
}

function applyView() {
    const view = currentViewFromHash();
    const changed = view !== state.view;
    state.view = view;
    const config = VIEWS[view];
    $('.main-content').dataset.view = view;
    document.querySelectorAll('[data-views]').forEach((section) => {
        section.hidden = !section.dataset.views.split(' ').includes(view);
    });
    document.querySelectorAll('.nav-link').forEach((link) => {
        const active = link.dataset.view === view;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    $('#breadcrumb-current').textContent = config.title;
    $('#page-title').textContent = config.title;
    $('#page-subtitle').textContent = config.subtitle;
    $('#reservation-kicker').textContent = view === 'overview' ? 'AKTIVITAS TERBARU' : 'SEMUA RESERVASI';
    $('#show-all-link').hidden = view !== 'overview';
    document.title = `${config.title} · Kilas Studio`;
    renderReservations();
    if (changed) window.scrollTo({ top: 0 });
}

function setFilter(filter) {
    state.filter = filter;
    document.querySelectorAll('.filter-tab').forEach((item) => item.classList.toggle('active', item.dataset.filter === filter));
    renderReservations();
}

/* ---------- Render ---------- */

function renderStats() {
    const today = todayReservations();
    const paidToday = today.filter((item) => item.payment?.status === 'paid');
    const revenue = paidToday.reduce((sum, item) => sum + amountOf(item), 0);
    const average = paidToday.length ? revenue / paidToday.length : 0;
    const roomsBusy = new Set(state.reservations.filter((item) => isRunningNow(item)).map((item) => item.room_id));
    const pendingCount = state.reservations.filter(isPending).length;
    $('#today-revenue').textContent = formatCurrency(revenue);
    $('#today-bookings').textContent = today.length;
    $('#booking-footnote').textContent = `${today.filter(isPending).length} menunggu pembayaran`;
    $('#average-value').textContent = formatCurrency(average);
    $('#available-rooms').textContent = Math.max(0, state.rooms.length - roomsBusy.size);
    $('#total-rooms').textContent = state.rooms.length;
    $('#room-footnote').textContent = roomsBusy.size ? `${roomsBusy.size} ruangan sedang dipakai` : 'Siap menerima sesi';
    $('#nav-count').textContent = today.length;
    $('#pending-count').textContent = pendingCount;
    $('#all-count').textContent = state.reservations.length;
    $('#notification-dot').hidden = pendingCount === 0;
    $('#notification-button').title = pendingCount ? `${pendingCount} tagihan belum lunas` : 'Tidak ada tagihan belum lunas';
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
    for (const reservation of state.reservations) {
        if (reservation.payment?.status !== 'paid') continue;
        const day = byDate.get(dateKey(reservation.starts_at));
        if (day) day.amount += amountOf(reservation);
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
    const isWeek = Number(state.range) === 7;
    const dots = coordinates.map((point, index) => (index === coordinates.length - 1 || (isWeek && point.amount > 0)
        ? `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="3.5"><title>${dateFormatter.format(point.date)}: ${formatCurrency(point.amount)}</title></circle>` : '')).join('');
    const labels = labelIndexes.map((index) => {
        const point = coordinates[index];
        const anchor = index === 0 ? 'start' : index === coordinates.length - 1 ? 'end' : 'middle';
        return `<text class="chart-label" x="${point.x}" y="133" text-anchor="${anchor}">${dateFormatter.format(point.date)}</text>`;
    }).join('');
    $('#period-revenue').textContent = formatCurrency(total);
    $('#period-label').textContent = `${state.range} hari terakhir`;
    $('#revenue-chart').setAttribute('aria-label', `Grafik pendapatan ${state.range} hari terakhir, total ${formatCurrency(total)}`);
    $('#revenue-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#74aa87" stop-opacity=".20"/><stop offset="100%" stop-color="#74aa87" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>${dots}${labels}</svg>`;
}

function renderRooms() {
    $('#room-list').innerHTML = state.rooms.map((room) => {
        const busy = state.reservations.some((item) => item.room_id === room.id && isRunningNow(item));
        return `<div class="room-item"><span class="room-thumb" aria-hidden="true"><span></span></span><span class="room-meta"><strong>${escapeHtml(room.name)}</strong><small>${escapeHtml(room.code)} · ${formatCurrency(room.hourly_rate)}/jam</small></span><span class="room-status${busy ? ' busy' : ''}">${busy ? 'Sedang dipakai' : 'Tersedia'}</span></div>`;
    }).join('') || '<div class="empty-state"><strong>Belum ada ruangan</strong></div>';
    const select = $('#room-select');
    const selected = select.value;
    select.innerHTML = state.rooms.map((room) => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.name)} · ${formatCurrency(room.hourly_rate)}/jam</option>`).join('');
    if (state.rooms.some((room) => room.id === selected)) select.value = selected;
    updateEstimate();
}

function renderRoomDetails() {
    const now = new Date();
    const today = dateKey(now);
    $('#room-detail-list').innerHTML = state.rooms.map((room) => {
        const active = state.reservations.filter((item) => item.room_id === room.id && !isCancelled(item));
        const running = active.find((item) => isRunningNow(item, now));
        const todayItems = active.filter((item) => dateKey(item.starts_at) === today);
        const bookedMinutes = todayItems.reduce((sum, item) => sum + Number(item.duration_minutes), 0);
        const upcoming = active.filter((item) => endOf(item) > now)
            .sort((first, second) => new Date(first.starts_at) - new Date(second.starts_at))
            .slice(0, 4);
        const status = running
            ? `<span class="room-status busy">Sedang dipakai s.d. ${escapeHtml(timeFormatter.format(endOf(running)))}</span>`
            : '<span class="room-status">Tersedia</span>';
        const schedule = upcoming.length
            ? upcoming.map((item) => `<li><span>${escapeHtml(dayLabel(item.starts_at))}, ${escapeHtml(timeFormatter.format(new Date(item.starts_at)))}–${escapeHtml(timeFormatter.format(endOf(item)))}</span><strong>${escapeHtml(item.customer?.full_name || 'Pelanggan')}</strong></li>`).join('')
            : '<li class="muted">Belum ada jadwal berikutnya.</li>';
        return `<article class="room-card">
            <div class="room-card-head"><span class="room-thumb" aria-hidden="true"><span></span></span><div><strong>${escapeHtml(room.name)}</strong><small>${escapeHtml(room.code)} · kapasitas ${escapeHtml(room.capacity ?? '-')} orang</small></div></div>
            <div class="room-card-rate">${formatCurrency(room.hourly_rate)}<small>/jam</small></div>
            ${status}
            <div class="room-card-stats"><span><b>${todayItems.length}</b> sesi hari ini</span><span><b>${escapeHtml(durationLabel(bookedMinutes) || '0 jam')}</b> terpesan</span></div>
            <div class="room-card-label">Jadwal berikutnya</div>
            <ul class="room-schedule">${schedule}</ul>
            <button class="secondary-button room-book-button" type="button" data-book-room="${escapeHtml(room.id)}">+ Pesan ruangan ini</button>
        </article>`;
    }).join('') || '<div class="empty-state"><strong>Belum ada ruangan</strong><span>Jalankan schema.sql untuk menambahkan data ruangan.</span></div>';
}

function breakdownRows(entries, total) {
    if (!entries.length) return '<p class="muted breakdown-empty">Belum ada transaksi lunas pada periode ini.</p>';
    const maximum = Math.max(...entries.map((entry) => entry.amount), 1);
    return entries.map((entry) => {
        const share = total ? Math.round(entry.amount / total * 100) : 0;
        return `<div class="breakdown-row"><div class="breakdown-meta"><span>${escapeHtml(entry.label)}</span><strong>${formatCurrency(entry.amount)}</strong></div><div class="breakdown-bar"><i style="width:${Math.max(2, entry.amount / maximum * 100)}%"></i></div><small>${entry.count} transaksi · ${share}% dari total</small></div>`;
    }).join('');
}

function renderRevenueDetails() {
    const items = reservationsInRange();
    const paid = items.filter((item) => item.payment?.status === 'paid');
    const pending = items.filter(isPending);
    const refunded = items.filter((item) => item.payment?.status === 'refunded');
    const sum = (list) => list.reduce((total, item) => total + amountOf(item), 0);
    const paidTotal = sum(paid);
    $('#revenue-detail-label').textContent = `· ${state.range} hari terakhir`;
    $('#revenue-summary').innerHTML = [
        { label: 'Pendapatan lunas', value: paidTotal, note: `${paid.length} transaksi`, tone: 'paid' },
        { label: 'Belum lunas', value: sum(pending), note: `${pending.length} tagihan`, tone: 'pending' },
        { label: 'Dikembalikan', value: sum(refunded), note: `${refunded.length} transaksi`, tone: 'refunded' },
        { label: 'Rata-rata per transaksi', value: paid.length ? paidTotal / paid.length : 0, note: 'transaksi lunas', tone: '' },
    ].map((card) => `<div class="summary-card ${card.tone}"><span>${card.label}</span><strong>${formatCurrency(card.value)}</strong><small>${card.note}</small></div>`).join('');

    const byRoom = state.rooms.map((room) => {
        const list = paid.filter((item) => item.room_id === room.id);
        return { label: room.name, amount: sum(list), count: list.length };
    }).filter((entry) => entry.count).sort((a, b) => b.amount - a.amount);
    const methods = new Map();
    for (const item of paid) {
        const key = item.payment?.method || 'unknown';
        const entry = methods.get(key) || { label: METHOD_LABELS[key] || 'Tidak tercatat', amount: 0, count: 0 };
        entry.amount += amountOf(item);
        entry.count += 1;
        methods.set(key, entry);
    }
    $('#revenue-by-room').innerHTML = breakdownRows(byRoom, paidTotal);
    $('#revenue-by-method').innerHTML = breakdownRows([...methods.values()].sort((a, b) => b.amount - a.amount), paidTotal);
}

function filteredReservations() {
    const query = state.query.trim().toLocaleLowerCase('id');
    return state.reservations.filter((item) => {
        const haystack = `${item.customer?.full_name || ''} ${item.customer?.phone || ''} ${roomOf(item).name || ''}`.toLocaleLowerCase('id');
        const matchesFilter = state.filter === 'all'
            || (state.filter === 'pending' && isPending(item))
            || (state.filter === 'today' && dateKey(item.starts_at) === dateKey(new Date()));
        return haystack.includes(query) && matchesFilter;
    }).sort((first, second) => new Date(second.starts_at) - new Date(first.starts_at));
}

function renderReservations() {
    const matches = filteredReservations();
    const items = state.view === 'overview' ? matches.slice(0, OVERVIEW_ROW_LIMIT) : matches;
    const now = new Date();
    $('#empty-state').hidden = items.length > 0;
    $('#reservation-rows').innerHTML = items.map((item) => {
        const customer = item.customer || {};
        const room = roomOf(item);
        const start = new Date(item.starts_at);
        const end = endOf(item);
        const cancelled = isCancelled(item);
        const paymentStatus = item.payment?.status || 'pending';
        const badge = cancelled
            ? `<span class="payment-badge cancelled"><i></i>Dibatalkan${paymentStatus === 'refunded' ? ' · dana kembali' : ''}</span>`
            : `<span class="payment-badge ${escapeHtml(paymentStatus)}"><i></i>${escapeHtml(PAYMENT_LABELS[paymentStatus] || paymentStatus)}${paymentStatus === 'paid' && item.payment?.method ? ` · ${escapeHtml(METHOD_LABELS[item.payment.method] || item.payment.method)}` : ''}</span>`;
        const avatar = (customer.full_name || '?').split(/\s+/).slice(0, 2).map((name) => name[0]).join('').toLocaleUpperCase('id');
        const id = escapeHtml(item.id);
        const actions = [];
        if (!cancelled && paymentStatus === 'pending' && item.payment?.id) actions.push(`<button class="table-action" type="button" data-action="pay" data-reservation-id="${id}">Tandai lunas</button>`);
        if (!cancelled && start > now) actions.push(`<button class="table-action" type="button" data-action="edit" data-reservation-id="${id}">Edit</button>`);
        if (!cancelled && end > now) actions.push(`<button class="table-action muted-action" type="button" data-action="cancel" data-reservation-id="${id}">Batalkan</button>`);
        actions.push(`<button class="table-action danger" type="button" data-action="delete" data-reservation-id="${id}">Hapus</button>`);
        return `<tr class="${cancelled ? 'is-cancelled' : ''}"><td><div class="customer-cell"><span class="customer-avatar">${escapeHtml(avatar)}</span><span class="customer-info"><strong>${escapeHtml(customer.full_name || 'Pelanggan')}</strong><small>${escapeHtml(formatPhone(customer.phone))}</small></span></div></td><td><span class="schedule-cell"><strong>${escapeHtml(dayLabel(start))}, ${escapeHtml(timeFormatter.format(start))}–${escapeHtml(timeFormatter.format(end))}</strong><small>${escapeHtml(durationLabel(Number(item.duration_minutes)))} · ${escapeHtml(dateFormatter.format(start))}${item.notes ? ` · ${escapeHtml(item.notes.slice(0, 40))}` : ''}</small></span></td><td><span class="room-cell"><i></i>${escapeHtml(room.name || 'Ruangan')}</span></td><td><span class="amount-cell">${formatCurrency(amountOf(item))}</span></td><td>${badge}</td><td><div class="table-actions">${actions.join('')}</div></td></tr>`;
    }).join('');
    $('#table-summary').textContent = `Menampilkan ${items.length} dari ${matches.length} reservasi${state.filter !== 'all' || state.query ? ' (terfilter)' : ''}`;
}

function render() {
    renderStats();
    renderChart();
    renderRooms();
    renderRoomDetails();
    renderRevenueDetails();
    renderReservations();
}

/* ---------- Form reservasi ---------- */

function updateEstimate() {
    const room = state.rooms.find((item) => item.id === $('#room-select').value) || state.rooms[0];
    const duration = Number($('[name="duration_minutes"]').value || 60);
    $('#price-estimate').textContent = formatCurrency(room ? Number(room.hourly_rate) * duration / 60 : 0);
}

function closeDialogs() {
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
}

function openBookingDialog(reservation = null, roomId = null) {
    const dialog = $('#booking-dialog');
    setBookingDialogMode(reservation);
    if (roomId && state.rooms.some((room) => room.id === roomId)) {
        $('#room-select').value = roomId;
        updateEstimate();
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.querySelector('[name="customer_name"]').focus();
}

function setBookingDialogMode(reservation = null) {
    const form = $('#booking-form');
    const submitButton = $('#submit-booking');
    $('#booking-date').min = dateKey(new Date());
    form.reset();

    if (reservation) {
        const start = new Date(reservation.starts_at);
        $('#dialog-title').textContent = 'Edit reservasi';
        $('#dialog-kicker').textContent = 'UBAH SESI';
        submitButton.innerHTML = 'Perbarui reservasi <span aria-hidden="true">→</span>';
        form.elements.customer_name.value = reservation.customer?.full_name || '';
        form.elements.phone.value = reservation.customer?.phone || '';
        form.elements.room_id.value = reservation.room_id;
        form.elements.date.value = dateKey(start);
        form.elements.time.value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
        form.elements.duration_minutes.value = String(reservation.duration_minutes || 60);
        form.elements.notes.value = reservation.notes || '';
        state.editingReservationId = reservation.id;
    } else {
        $('#dialog-title').textContent = 'Buat reservasi';
        $('#dialog-kicker').textContent = 'SESI BARU';
        submitButton.innerHTML = 'Simpan reservasi <span aria-hidden="true">→</span>';
        form.elements.time.value = '10:00';
        form.elements.date.value = dateKey(new Date());
        form.elements.duration_minutes.value = '60';
        if (state.rooms.length) form.elements.room_id.value = state.rooms[0].id;
        state.editingReservationId = null;
    }
    updateEstimate();
    $('#form-error').hidden = true;
}

function validateBooking(values) {
    const name = String(values.get('customer_name') || '').trim();
    const phone = String(values.get('phone') || '').trim();
    if (name.length < 2 || name.length > 100) return 'Nama pelanggan harus berisi 2–100 karakter.';
    if (!PHONE_PATTERN.test(phone)) return 'Nomor telepon tidak valid (8–20 digit, boleh diawali +).';
    if (!values.get('room_id')) return 'Pilih ruangan.';
    if (!values.get('date') || !values.get('time')) return 'Isi tanggal dan jam mulai.';
    const startsAt = new Date(`${values.get('date')}T${values.get('time')}`);
    if (Number.isNaN(startsAt.getTime())) return 'Tanggal atau jam tidak valid.';
    if (startsAt <= new Date()) return 'Pilih waktu reservasi yang akan datang.';
    return '';
}

async function submitBooking(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = $('#submit-booking');
    const errorMessage = $('#form-error');
    const values = new FormData(form);
    const invalid = validateBooking(values);
    if (invalid) {
        errorMessage.textContent = invalid;
        errorMessage.hidden = false;
        return;
    }
    const startsAt = new Date(`${values.get('date')}T${values.get('time')}`);
    const payload = {
        customer_name: String(values.get('customer_name')).trim(),
        phone: String(values.get('phone')).trim(),
        room_id: values.get('room_id'),
        starts_at: startsAt.toISOString(),
        duration_minutes: Number(values.get('duration_minutes')),
        notes: String(values.get('notes') || '').trim().slice(0, 500),
    };
    const isEditing = Boolean(state.editingReservationId);
    const existing = isEditing ? state.reservations.find((item) => item.id === state.editingReservationId) : null;
    const room = state.rooms.find((item) => item.id === payload.room_id);

    submitButton.disabled = true;
    submitButton.textContent = 'Menyimpan...';
    errorMessage.hidden = true;
    try {
        if (!room) throw new Error('Ruangan tidak ditemukan.');
        if (isEditing && !existing) throw new Error('Reservasi tidak ditemukan. Muat ulang data.');
        const totalPrice = Math.round(Number(room.hourly_rate) * payload.duration_minutes / 60 * 100) / 100;
        const priceChanged = existing && Math.abs(amountOf(existing) - totalPrice) > 0.009;
        if (existing?.payment?.status === 'paid' && priceChanged) {
            throw new Error('Reservasi ini sudah lunas. Perubahan ruangan atau durasi yang mengubah harga tidak diizinkan; batalkan lalu buat reservasi baru.');
        }

        if (state.live) {
            let customerId;
            if (isEditing) {
                customerId = existing.customer?.id || existing.customer_id;
                if (!customerId) throw new Error('Data pelanggan tidak ditemukan untuk reservasi ini.');
                await supabaseFetch(`/rest/v1/customers?id=eq.${encodeURIComponent(customerId)}`, {
                    method: 'PATCH',
                    headers: { Prefer: 'return=minimal' },
                    body: { full_name: payload.customer_name, phone: payload.phone },
                });
            } else {
                const customers = await supabaseFetch('/rest/v1/customers?on_conflict=phone', {
                    method: 'POST',
                    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
                    body: { full_name: payload.customer_name, phone: payload.phone },
                });
                customerId = customers?.[0]?.id;
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
            if (isEditing) {
                await supabaseFetch(`/rest/v1/reservations?id=eq.${encodeURIComponent(existing.id)}`, {
                    method: 'PATCH',
                    headers: { Prefer: 'return=minimal' },
                    body: reservationBody,
                });
                // Trigger pembayaran hanya berjalan saat INSERT, jadi tagihan yang belum lunas disinkronkan di sini.
                if (existing.payment?.id && existing.payment.status === 'pending' && priceChanged) {
                    await supabaseFetch(`/rest/v1/payments?id=eq.${encodeURIComponent(existing.payment.id)}`, {
                        method: 'PATCH',
                        headers: { Prefer: 'return=minimal' },
                        body: { amount: totalPrice },
                    });
                }
            } else {
                await supabaseFetch('/rest/v1/reservations', {
                    method: 'POST',
                    headers: { Prefer: 'return=minimal' },
                    body: reservationBody,
                });
            }
            await loadDashboard();
        } else {
            const overlap = state.reservations.some((item) => item.id !== state.editingReservationId
                && item.room_id === room.id && !isCancelled(item)
                && new Date(item.starts_at) < new Date(startsAt.getTime() + payload.duration_minutes * 60000)
                && endOf(item) > startsAt);
            if (overlap) throw new Error('Jadwal bentrok: ruangan ini sudah dipesan pada rentang waktu tersebut. Pilih jam atau ruangan lain.');
            const base = {
                room_id: room.id,
                starts_at: payload.starts_at,
                duration_minutes: payload.duration_minutes,
                total_price: totalPrice,
                notes: payload.notes,
                room: { id: room.id, name: room.name, code: room.code },
            };
            if (isEditing) {
                const index = state.reservations.findIndex((item) => item.id === existing.id);
                state.reservations[index] = {
                    ...existing,
                    ...base,
                    customer: { ...(existing.customer || {}), full_name: payload.customer_name, phone: payload.phone },
                    payment: { ...(existing.payment || {}), amount: existing.payment?.status === 'pending' ? totalPrice : amountOf(existing) },
                };
            } else {
                state.reservations.unshift({
                    ...base,
                    id: `demo-${crypto.randomUUID()}`,
                    status: 'confirmed',
                    customer: { id: `demo-customer-${crypto.randomUUID()}`, full_name: payload.customer_name, phone: payload.phone },
                    payment: { id: `demo-payment-${crypto.randomUUID()}`, amount: totalPrice, status: 'pending', method: null, paid_at: null },
                });
            }
            saveDemoReservations();
            render();
        }
        $('#booking-dialog').close();
        showToast(isEditing ? 'Reservasi berhasil diperbarui.' : (state.live ? 'Reservasi tersimpan di Supabase.' : 'Reservasi ditambahkan ke demo lokal.'));
    } catch (error) {
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = isEditing
            ? 'Perbarui reservasi <span aria-hidden="true">→</span>'
            : 'Simpan reservasi <span aria-hidden="true">→</span>';
    }
}

/* ---------- Aksi reservasi ---------- */

async function deleteReservation(reservation) {
    const confirmed = window.confirm(`Hapus permanen reservasi milik ${reservation.customer?.full_name || 'pelanggan ini'}? Catatan pembayarannya ikut terhapus.\n\nGunakan "Batalkan" jika ingin tetap menyimpan riwayatnya.`);
    if (!confirmed) return;
    try {
        if (state.live) {
            await supabaseFetch(`/rest/v1/reservations?id=eq.${encodeURIComponent(reservation.id)}`, {
                method: 'DELETE',
                headers: { Prefer: 'return=minimal' },
            });
            await loadDashboard();
        } else {
            state.reservations = state.reservations.filter((item) => item.id !== reservation.id);
            saveDemoReservations();
            render();
        }
        showToast('Reservasi berhasil dihapus.');
    } catch (error) {
        showToast(error.message);
    }
}

async function cancelReservation(reservation) {
    const paid = reservation.payment?.status === 'paid';
    const confirmed = window.confirm(`Batalkan reservasi milik ${reservation.customer?.full_name || 'pelanggan ini'}?${paid ? '\n\nPembayaran yang sudah lunas akan dicatat sebagai dikembalikan (refund).' : ''}\nSlot jadwal akan tersedia kembali.`);
    if (!confirmed) return;
    try {
        if (state.live) {
            await supabaseFetch(`/rest/v1/reservations?id=eq.${encodeURIComponent(reservation.id)}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: { status: 'cancelled' },
            });
            if (paid && reservation.payment?.id) {
                await supabaseFetch(`/rest/v1/payments?id=eq.${encodeURIComponent(reservation.payment.id)}`, {
                    method: 'PATCH',
                    headers: { Prefer: 'return=minimal' },
                    body: { status: 'refunded' },
                });
            }
            await loadDashboard();
        } else {
            reservation.status = 'cancelled';
            if (paid) reservation.payment.status = 'refunded';
            saveDemoReservations();
            render();
        }
        showToast(paid ? 'Reservasi dibatalkan dan pembayaran dicatat sebagai dikembalikan.' : 'Reservasi dibatalkan.');
    } catch (error) {
        showToast(error.message);
    }
}

function openPaymentDialog(reservation) {
    state.payingReservationId = reservation.id;
    const dialog = $('#payment-dialog');
    $('#payment-form').reset();
    $('#payment-error').hidden = true;
    $('#payment-subtitle').textContent = `${reservation.customer?.full_name || 'Pelanggan'} · ${roomOf(reservation).name || 'Ruangan'} · ${dayLabel(reservation.starts_at)}, ${timeFormatter.format(new Date(reservation.starts_at))}`;
    $('#payment-amount').textContent = formatCurrency(amountOf(reservation));
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
}

async function submitPayment(event) {
    event.preventDefault();
    const reservation = state.reservations.find((item) => item.id === state.payingReservationId);
    const method = new FormData(event.currentTarget).get('method');
    const button = $('#submit-payment');
    const errorMessage = $('#payment-error');
    if (!reservation?.payment) {
        errorMessage.textContent = 'Data pembayaran tidak ditemukan. Muat ulang data.';
        errorMessage.hidden = false;
        return;
    }
    button.disabled = true;
    button.textContent = 'Menyimpan...';
    try {
        const paidAt = new Date().toISOString();
        if (state.live) {
            await supabaseFetch(`/rest/v1/payments?id=eq.${encodeURIComponent(reservation.payment.id)}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: { status: 'paid', method, paid_at: paidAt },
            });
            await loadDashboard();
        } else {
            Object.assign(reservation.payment, { status: 'paid', method, paid_at: paidAt });
            saveDemoReservations();
            render();
        }
        $('#payment-dialog').close();
        showToast(`Pembayaran ${METHOD_LABELS[method] || method} berhasil dicatat lunas.`);
    } catch (error) {
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    } finally {
        button.disabled = false;
        button.innerHTML = 'Konfirmasi lunas <span aria-hidden="true">→</span>';
    }
}

function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
}

/* ---------- Inisialisasi ---------- */

function initialize() {
    const today = new Date();
    $('#login-year').textContent = today.getFullYear();
    $('#copyright-year').textContent = today.getFullYear();
    $('#heading-day').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long' }).format(today).toLocaleUpperCase('id');
    $('#heading-date').textContent = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(today).toLocaleUpperCase('id');
    $('#sidebar-date').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }).format(today);

    $('#login-form').addEventListener('submit', submitLogin);
    $('#logout-button').addEventListener('click', signOut);
    $('#new-booking-button').addEventListener('click', () => openBookingDialog());
    $('#table-booking-button').addEventListener('click', () => openBookingDialog());
    $('#booking-form').addEventListener('submit', submitBooking);
    $('#payment-form').addEventListener('submit', submitPayment);
    document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', closeDialogs));
    $('#room-select').addEventListener('change', updateEstimate);
    $('[name="duration_minutes"]').addEventListener('change', updateEstimate);
    $('#chart-range').addEventListener('change', (event) => {
        state.range = Number(event.target.value);
        renderChart();
        renderRevenueDetails();
    });
    $('#reservation-search').addEventListener('input', (event) => {
        state.query = event.target.value;
        renderReservations();
    });
    document.querySelectorAll('.filter-tab').forEach((tab) => tab.addEventListener('click', () => setFilter(tab.dataset.filter)));
    $('#notification-button').addEventListener('click', () => {
        setFilter('pending');
        if (state.view !== 'reservations') window.location.hash = '#reservations';
    });
    $('#reservation-rows').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const reservation = state.reservations.find((item) => item.id === button.dataset.reservationId);
        if (!reservation) return;
        if (button.dataset.action === 'edit') openBookingDialog(reservation);
        else if (button.dataset.action === 'pay') openPaymentDialog(reservation);
        else if (button.dataset.action === 'cancel') await cancelReservation(reservation);
        else if (button.dataset.action === 'delete') await deleteReservation(reservation);
    });
    $('#room-detail-list').addEventListener('click', (event) => {
        const button = event.target.closest('[data-book-room]');
        if (button) openBookingDialog(null, button.dataset.bookRoom);
    });
    $('#reload-button').addEventListener('click', async () => {
        await loadDashboard();
        showToast(state.live ? 'Data dimuat ulang dari Supabase.' : 'Masih memakai data demo lokal.');
    });
    window.addEventListener('hashchange', applyView);
    $('#chart-range').value = String(state.range);
    // Status "sedang dipakai" diperbarui tiap menit tanpa perlu memuat ulang halaman.
    setInterval(() => {
        if (!$('.app-shell').hidden) {
            renderStats();
            renderRooms();
            renderRoomDetails();
        }
    }, 60000);

    if (restoreSession()) {
        showDashboard();
        applyView();
        render();
        loadDashboard();
    } else {
        showLogin();
    }
}

initialize();
window.kilasReady = true;
