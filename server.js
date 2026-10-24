// Server Node.js alternatif untuk Kilas Studio.
// Tidak diperlukan untuk GitHub Pages atau Live Server, karena frontend (app.js) memanggil Supabase langsung.
// Jalankan dengan: node server.js  (Node.js 18+ karena memakai fetch bawaan)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_DIR = __dirname;
const PRIVATE_FILES = new Set(['server.js', '.gitignore']);
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://rglyiyqdlzvobglddmqd.supabase.co').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_WqvQonmucmniqERcA8m3fQ_-WdcXl0c';
const SUPABASE_CONFIGURED = SUPABASE_URL.startsWith('https://')
    && SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_');
const PHONE_PATTERN = /^\+?[0-9\s().-]{8,20}$/;
const PAYMENT_METHODS = ['cash', 'qris', 'transfer', 'card'];
const RESERVATION_SELECT = 'select=*,customer:customers(id,full_name,phone),room:studio_rooms(id,name,code),payment:payments(id,amount,status,method,paid_at)';
const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
};

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function sendJson(response, status, payload) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(payload));
}

async function readJson(request) {
    let body = '';
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 1_000_000) throw new HttpError(413, 'Ukuran permintaan terlalu besar.');
    }
    try {
        return JSON.parse(body || '{}');
    } catch {
        throw new HttpError(400, 'Format JSON tidak valid.');
    }
}

async function parseResponse(response) {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

async function supabaseFetch(url, init) {
    try {
        return await fetch(url, init);
    } catch {
        throw new HttpError(503, 'Tidak dapat terhubung ke Supabase. Periksa koneksi atau status project.');
    }
}

async function supabaseRequest(table, query = '', options = {}) {
    if (!SUPABASE_CONFIGURED) throw new HttpError(503, 'Supabase belum dikonfigurasi.');

    const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        method: options.method || 'GET',
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
            ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
            ...(options.prefer ? { Prefer: options.prefer } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = await parseResponse(response);

    if (!response.ok) {
        if (payload?.code === '23P01') throw new HttpError(409, 'Jadwal bentrok: ruangan ini sudah dipesan pada rentang waktu tersebut.');
        if (payload?.code === '23505') throw new HttpError(409, 'Nomor telepon sudah dipakai pelanggan lain.');
        if (payload?.code === 'P0001') throw new HttpError(409, payload.message);
        throw new HttpError(response.status, payload?.message || 'Permintaan ke Supabase gagal.');
    }
    return payload;
}

async function supabaseAuthRequest(pathname, options = {}) {
    if (!SUPABASE_CONFIGURED) throw new HttpError(503, 'Supabase belum dikonfigurasi.');
    const response = await supabaseFetch(`${SUPABASE_URL}/auth/v1/${pathname}`, {
        method: options.method || 'POST',
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
            ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
        const raw = payload?.msg || payload?.message || payload?.error_description || '';
        if (/invalid login credentials/i.test(raw)) throw new HttpError(response.status, 'Email atau password salah.');
        throw new HttpError(response.status, raw || 'Autentikasi gagal.');
    }
    return payload;
}

function requireAccessToken(request) {
    const match = request.headers.authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new HttpError(401, 'Silakan login terlebih dahulu.');
    return match[1];
}

function requireUuid(value, fieldName) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')) {
        throw new HttpError(400, `${fieldName} tidak valid.`);
    }
}

// Validasi yang sama dipakai untuk membuat dan mengubah reservasi.
function readReservationInput(body) {
    const customerName = String(body.customer_name || '').trim();
    const phone = String(body.phone || '').trim();
    const startsAt = new Date(body.starts_at);
    const duration = Number(body.duration_minutes);
    requireUuid(body.room_id, 'Ruangan');
    if (customerName.length < 2 || customerName.length > 100) {
        throw new HttpError(400, 'Nama pelanggan harus berisi 2-100 karakter.');
    }
    if (!PHONE_PATTERN.test(phone)) throw new HttpError(400, 'Nomor telepon tidak valid.');
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
        throw new HttpError(400, 'Waktu reservasi harus berada di masa depan.');
    }
    if (!Number.isInteger(duration) || duration < 30 || duration > 240 || duration % 30 !== 0) {
        throw new HttpError(400, 'Durasi harus 30-240 menit dengan kelipatan 30 menit.');
    }
    return {
        customerName,
        phone,
        roomId: body.room_id,
        startsAt,
        duration,
        notes: String(body.notes || '').trim().slice(0, 500),
    };
}

const firstOf = (value) => (Array.isArray(value) ? value[0] : value);

async function handleApi(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(response, 200, { ok: true, supabaseConfigured: SUPABASE_CONFIGURED });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const body = await readJson(request);
        const email = String(body.email || '').trim();
        const password = String(body.password || '');
        if (!email || !password) throw new HttpError(400, 'Email dan password wajib diisi.');
        const session = await supabaseAuthRequest('token?grant_type=password', { body: { email, password } });
        return sendJson(response, 200, session);
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        const accessToken = requireAccessToken(request);
        await supabaseAuthRequest('logout', { accessToken });
        return sendJson(response, 200, { success: true });
    }

    const accessToken = requireAccessToken(request);
    const db = (table, query = '', options = {}) => supabaseRequest(table, query, { ...options, accessToken });
    const findRoom = async (roomId) => {
        const rows = await db('studio_rooms', `?id=eq.${encodeURIComponent(roomId)}&active=eq.true&select=id,hourly_rate`);
        if (!rows.length) throw new HttpError(404, 'Ruangan tidak ditemukan atau sedang nonaktif.');
        return rows[0];
    };
    const priceFor = (room, duration) => Math.round(Number(room.hourly_rate) * duration / 60 * 100) / 100;
    const findReservation = async (id) => {
        const rows = await db('reservations', `?id=eq.${encodeURIComponent(id)}&${RESERVATION_SELECT}`);
        if (!rows.length) throw new HttpError(404, 'Reservasi tidak ditemukan.');
        const row = rows[0];
        return { ...row, customer: firstOf(row.customer), room: firstOf(row.room), payment: firstOf(row.payment) };
    };

    if (request.method === 'GET' && url.pathname === '/api/dashboard') {
        const [rooms, reservations] = await Promise.all([
            db('studio_rooms', '?select=id,name,code,hourly_rate,capacity&active=eq.true&order=code.asc'),
            db('reservations', `?${RESERVATION_SELECT}&order=starts_at.desc&limit=200`),
        ]);
        return sendJson(response, 200, { rooms, reservations });
    }

    if (request.method === 'POST' && url.pathname === '/api/reservations') {
        const input = readReservationInput(await readJson(request));
        const room = await findRoom(input.roomId);
        const customers = await db('customers?on_conflict=phone', '', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: { full_name: input.customerName, phone: input.phone },
        });
        const rows = await db('reservations', '', {
            method: 'POST',
            prefer: 'return=representation',
            body: {
                customer_id: customers[0].id,
                room_id: input.roomId,
                starts_at: input.startsAt.toISOString(),
                duration_minutes: input.duration,
                total_price: priceFor(room, input.duration),
                notes: input.notes,
            },
        });
        return sendJson(response, 201, rows[0]);
    }

    const cancelMatch = url.pathname.match(/^\/api\/reservations\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && cancelMatch) {
        requireUuid(cancelMatch[1], 'Reservasi');
        const reservation = await findReservation(cancelMatch[1]);
        if (reservation.status === 'cancelled') throw new HttpError(409, 'Reservasi sudah dibatalkan.');
        await db(`reservations?id=eq.${encodeURIComponent(reservation.id)}`, '', {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: { status: 'cancelled' },
        });
        // Trigger database juga melakukan ini; langkah ini menjaga hasil tetap benar bila trigger belum dipasang.
        if (reservation.payment?.status === 'paid') {
            await db(`payments?id=eq.${encodeURIComponent(reservation.payment.id)}`, '', {
                method: 'PATCH',
                prefer: 'return=minimal',
                body: { status: 'refunded' },
            });
        }
        return sendJson(response, 200, await findReservation(reservation.id));
    }

    const reservationMatch = url.pathname.match(/^\/api\/reservations\/([^/]+)$/);
    if (request.method === 'GET' && reservationMatch) {
        requireUuid(reservationMatch[1], 'Reservasi');
        return sendJson(response, 200, await findReservation(reservationMatch[1]));
    }

    if (request.method === 'PATCH' && reservationMatch) {
        requireUuid(reservationMatch[1], 'Reservasi');
        const input = readReservationInput(await readJson(request));
        const existing = await findReservation(reservationMatch[1]);
        if (existing.status === 'cancelled') throw new HttpError(409, 'Reservasi yang dibatalkan tidak dapat diubah.');
        const room = await findRoom(input.roomId);
        const totalPrice = priceFor(room, input.duration);
        const currentAmount = Number(existing.payment?.amount ?? existing.total_price);
        const priceChanged = Math.abs(currentAmount - totalPrice) > 0.009;
        if (existing.payment?.status === 'paid' && priceChanged) {
            throw new HttpError(409, 'Reservasi ini sudah lunas, sehingga harganya tidak dapat diubah. Batalkan lalu buat reservasi baru.');
        }

        const customerId = existing.customer?.id || existing.customer_id;
        await db(`customers?id=eq.${encodeURIComponent(customerId)}`, '', {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: { full_name: input.customerName, phone: input.phone },
        });
        await db(`reservations?id=eq.${encodeURIComponent(existing.id)}`, '', {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: {
                room_id: input.roomId,
                starts_at: input.startsAt.toISOString(),
                duration_minutes: input.duration,
                total_price: totalPrice,
                notes: input.notes,
            },
        });
        if (existing.payment?.status === 'pending' && priceChanged) {
            await db(`payments?id=eq.${encodeURIComponent(existing.payment.id)}`, '', {
                method: 'PATCH',
                prefer: 'return=minimal',
                body: { amount: totalPrice },
            });
        }
        return sendJson(response, 200, await findReservation(existing.id));
    }

    if (request.method === 'DELETE' && reservationMatch) {
        requireUuid(reservationMatch[1], 'Reservasi');
        const rows = await db(`reservations?id=eq.${encodeURIComponent(reservationMatch[1])}`, '', {
            method: 'DELETE',
            prefer: 'return=representation',
        });
        if (!rows.length) throw new HttpError(404, 'Reservasi tidak ditemukan.');
        return sendJson(response, 200, { success: true, deleted: rows[0] });
    }

    const paymentMatch = url.pathname.match(/^\/api\/payments\/([^/]+)$/);
    if (request.method === 'PATCH' && paymentMatch) {
        requireUuid(paymentMatch[1], 'Pembayaran');
        const body = await readJson(request);
        if (!['pending', 'paid', 'refunded'].includes(body.status)) throw new HttpError(400, 'Status pembayaran tidak valid.');
        if (body.method && !PAYMENT_METHODS.includes(body.method)) throw new HttpError(400, 'Metode pembayaran tidak valid.');
        if (body.status === 'paid' && !body.method) throw new HttpError(400, 'Pilih metode pembayaran untuk pembayaran lunas.');
        const rows = await db(`payments?id=eq.${encodeURIComponent(paymentMatch[1])}`, '', {
            method: 'PATCH',
            prefer: 'return=representation',
            body: {
                status: body.status,
                method: body.method || null,
                paid_at: body.status === 'paid' ? new Date().toISOString() : null,
            },
        });
        if (!rows.length) throw new HttpError(404, 'Pembayaran tidak ditemukan.');
        return sendJson(response, 200, rows[0]);
    }

    sendJson(response, 404, { error: 'Endpoint tidak ditemukan.' });
}

function serveFrontend(request, response, pathname) {
    const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const filePath = path.resolve(FRONTEND_DIR, relativePath);
    if (PRIVATE_FILES.has(path.basename(filePath)) || relativePath.startsWith('.')) {
        return sendJson(response, 404, { error: 'Halaman tidak ditemukan.' });
    }
    if (filePath !== FRONTEND_DIR && !filePath.startsWith(`${FRONTEND_DIR}${path.sep}`)) {
        return sendJson(response, 403, { error: 'Akses ditolak.' });
    }
    fs.readFile(filePath, (error, content) => {
        if (error) return sendJson(response, 404, { error: 'Halaman tidak ditemukan.' });
        response.writeHead(200, {
            'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        response.end(request.method === 'HEAD' ? undefined : content);
    });
}

const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        if (url.pathname.startsWith('/api/')) {
            await handleApi(request, response, url);
            return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return sendJson(response, 405, { error: 'Metode tidak didukung.' });
        }
        serveFrontend(request, response, url.pathname);
    } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        if (status >= 500) console.error(error);
        sendJson(response, status, { error: error.message || 'Terjadi kesalahan pada server.' });
    }
});

server.listen(PORT, () => {
    console.log(`Studio dashboard berjalan di http://localhost:${PORT}`);
    if (!SUPABASE_CONFIGURED) {
        console.log('Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY.');
    }
});
