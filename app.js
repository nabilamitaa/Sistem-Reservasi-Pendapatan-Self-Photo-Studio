const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://rglyiyqdlzvobglddmqd.supabase.co').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_WqvQonmucmniqERcA8m3fQ_-WdcXl0c';
const SUPABASE_CONFIGURED = SUPABASE_URL.startsWith('https://')
    && SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_');
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

async function supabaseRequest(table, query = '', options = {}) {
    if (!SUPABASE_CONFIGURED) {
        throw new HttpError(503, 'Supabase belum dikonfigurasi.');
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        method: options.method || 'GET',
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
            ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
            ...(options.prefer ? { Prefer: options.prefer } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }

    if (!response.ok) {
        if (payload?.code === '23P01') {
            throw new HttpError(409, 'Jadwal ruangan bentrok dengan reservasi lain.');
        }
        if (payload?.code === '23505') {
            throw new HttpError(409, 'Data tersebut sudah terdaftar.');
        }
        throw new HttpError(response.status, payload?.message || 'Permintaan ke Supabase gagal.');
    }
    return payload;
}

async function supabaseAuthRequest(pathname, options = {}) {
    if (!SUPABASE_CONFIGURED) throw new HttpError(503, 'Supabase belum dikonfigurasi.');
    const response = await fetch(`${SUPABASE_URL}/auth/v1/${pathname}`, {
        method: options.method || 'POST',
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
            ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!response.ok) {
        throw new HttpError(response.status, payload?.msg || payload?.message || payload?.error_description || 'Autentikasi gagal.');
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

async function handleApi(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(response, 200, {
            ok: true,
            supabaseConfigured: SUPABASE_CONFIGURED,
        });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const body = await readJson(request);
        const email = String(body.email || '').trim();
        const password = String(body.password || '');
        if (!email || !password) throw new HttpError(400, 'Email dan password wajib diisi.');
        const session = await supabaseAuthRequest('token?grant_type=password', {
            body: { email, password },
        });
        return sendJson(response, 200, session);
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        const accessToken = requireAccessToken(request);
        await supabaseAuthRequest('logout', { accessToken });
        return sendJson(response, 200, { success: true });
    }

    const accessToken = requireAccessToken(request);
    const databaseRequest = (table, query = '', options = {}) => supabaseRequest(table, query, {
        ...options,
        accessToken,
    });

    if (request.method === 'GET' && url.pathname === '/api/dashboard') {
        const reservationsQuery = '?select=*,customer:customers(full_name,phone),room:studio_rooms(name,code),payment:payments(id,amount,status,method,paid_at)&order=starts_at.desc&limit=100';
        const [rooms, reservations] = await Promise.all([
            databaseRequest('studio_rooms', '?select=id,name,code,hourly_rate,capacity&active=eq.true&order=code.asc'),
            databaseRequest('reservations', reservationsQuery),
        ]);
        return sendJson(response, 200, { rooms, reservations });
    }

    if (request.method === 'POST' && url.pathname === '/api/reservations') {
        const body = await readJson(request);
        const customerName = String(body.customer_name || '').trim();
        const phone = String(body.phone || '').trim();
        const startsAt = new Date(body.starts_at);
        const duration = Number(body.duration_minutes);
        requireUuid(body.room_id, 'Ruangan');
        if (customerName.length < 2 || customerName.length > 100) {
            throw new HttpError(400, 'Nama pelanggan harus berisi 2-100 karakter.');
        }
        if (!/^\+?[0-9\s().-]{8,20}$/.test(phone)) {
            throw new HttpError(400, 'Nomor telepon tidak valid.');
        }
        if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
            throw new HttpError(400, 'Waktu reservasi harus berada di masa depan.');
        }
        if (!Number.isInteger(duration) || duration < 30 || duration > 240 || duration % 30 !== 0) {
            throw new HttpError(400, 'Durasi harus 30-240 menit dengan kelipatan 30 menit.');
        }

        const roomRows = await databaseRequest(
            'studio_rooms',
            `?id=eq.${encodeURIComponent(body.room_id)}&active=eq.true&select=id,hourly_rate`,
        );
        if (!roomRows.length) throw new HttpError(404, 'Ruangan tidak ditemukan atau sedang nonaktif.');
        const customerRows = await databaseRequest('customers?on_conflict=phone', '', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: { full_name: customerName, phone },
        });
        const hourlyRate = Number(roomRows[0].hourly_rate);
        const totalPrice = Math.round(hourlyRate * duration / 60 * 100) / 100;
        const reservations = await databaseRequest('reservations', '', {
            method: 'POST',
            prefer: 'return=representation',
            body: {
                customer_id: customerRows[0].id,
                room_id: body.room_id,
                starts_at: startsAt.toISOString(),
                duration_minutes: duration,
                total_price: totalPrice,
                notes: String(body.notes || '').trim().slice(0, 500),
            },
        });
        return sendJson(response, 201, reservations[0]);
    }

    const reservationMatch = url.pathname.match(/^\/api\/reservations\/([^/]+)$/);
    if (request.method === 'GET' && reservationMatch) {
        requireUuid(reservationMatch[1], 'Reservasi');
        const rows = await databaseRequest(
            `reservations?id=eq.${encodeURIComponent(reservationMatch[1])}&select=*,customer:customers(full_name,phone),room:studio_rooms(name,code),payment:payments(id,amount,status,method,paid_at)`,
        );
        if (!rows.length) throw new HttpError(404, 'Reservasi tidak ditemukan.');
        return sendJson(response, 200, rows[0]);
    }

    if (request.method === 'PATCH' && reservationMatch) {
        requireUuid(reservationMatch[1], 'Reservasi');
        const body = await readJson(request);
        const customerName = String(body.customer_name || '').trim();
        const phone = String(body.phone || '').trim();
        const startsAt = new Date(body.starts_at);
        const duration = Number(body.duration_minutes);
        requireUuid(body.room_id, 'Ruangan');

        if (customerName.length < 2 || customerName.length > 100) {
            throw new HttpError(400, 'Nama pelanggan harus berisi 2-100 karakter.');
        }
        if (!/^\+?[0-9\s().-]{8,20}$/.test(phone)) {
            throw new HttpError(400, 'Nomor telepon tidak valid.');
        }
        if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
            throw new HttpError(400, 'Waktu reservasi harus berada di masa depan.');
        }
        if (!Number.isInteger(duration) || duration < 30 || duration > 240 || duration % 30 !== 0) {
            throw new HttpError(400, 'Durasi harus 30-240 menit dengan kelipatan 30 menit.');
        }

        const reservationRows = await databaseRequest(
            `reservations?id=eq.${encodeURIComponent(reservationMatch[1])}&select=*,customer:customers(id,phone)`,
        );
        if (!reservationRows.length) throw new HttpError(404, 'Reservasi tidak ditemukan.');

        const roomRows = await databaseRequest(
            'studio_rooms',
            `?id=eq.${encodeURIComponent(body.room_id)}&active=eq.true&select=id,hourly_rate`,
        );
        if (!roomRows.length) throw new HttpError(404, 'Ruangan tidak ditemukan atau sedang nonaktif.');

        const customerId = reservationRows[0].customer?.id || reservationRows[0].customer_id;
        const customerRows = await databaseRequest(`customers?id=eq.${encodeURIComponent(customerId)}`, '', {
            method: 'PATCH',
            prefer: 'return=representation',
            body: { full_name: customerName, phone },
        });
        if (!customerRows.length) throw new HttpError(404, 'Pelanggan tidak ditemukan.');

        const hourlyRate = Number(roomRows[0].hourly_rate);
        const totalPrice = Math.round(hourlyRate * duration / 60 * 100) / 100;
        const rows = await databaseRequest(`reservations?id=eq.${encodeURIComponent(reservationMatch[1])}`, '', {
            method: 'PATCH',
            prefer: 'return=representation',
            body: {
                customer_id: customerId,
                room_id: body.room_id,
                starts_at: startsAt.toISOString(),
                duration_minutes: duration,
                total_price: totalPrice,
                notes: String(body.notes || '').trim().slice(0, 500),
            },
        });
        if (!rows.length) throw new HttpError(404, 'Reservasi tidak ditemukan.');
        return sendJson(response, 200, rows[0]);
    }

    if (request.method === 'DELETE' && reservationMatch) {
        requireUuid(reservationMatch[1], 'Reservasi');
        const rows = await databaseRequest(`reservations?id=eq.${encodeURIComponent(reservationMatch[1])}`, '', {
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
        if (!['pending', 'paid', 'refunded'].includes(body.status)) {
            throw new HttpError(400, 'Status pembayaran tidak valid.');
        }
        if (body.method && !['cash', 'qris', 'transfer', 'card'].includes(body.method)) {
            throw new HttpError(400, 'Metode pembayaran tidak valid.');
        }
        const rows = await databaseRequest(`payments?id=eq.${encodeURIComponent(paymentMatch[1])}`, '', {
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
        console.log('Mode demo aktif. Isi Project URL dan Publishable key di app.js untuk memakai database.');
    }
});
