-- Data contoh untuk demo presentasi Kilas Studio.
-- Jalankan di Supabase SQL Editor SETELAH schema.sql.
-- Tanggal dihitung relatif terhadap hari ini (WIB), jadi grafik 7 & 30 hari selalu terisi.
-- Aman dijalankan ulang: pelanggan diperbarui, jadwal yang bentrok dilewati.

-- 1) Daftar data contoh (dipakai oleh dua perintah di bawah).
create temporary table if not exists demo_data (
    full_name text, phone text, day_offset int, start_time time,
    room_code text, duration_minutes int, pay_status text, pay_method text
) on commit preserve rows;
truncate demo_data;

insert into demo_data values
    ('Nadia Putri',       '081245671023',   0, '09:00', 'ROOM-02',  60, 'paid',    'qris'),
    ('Rafi Mahendra',     '081320887152',   0, '10:00', 'ROOM-01',  60, 'paid',    'cash'),
    ('Salsa Kirana',      '082177624490',   0, '15:00', 'ROOM-03',  90, 'pending', null),
    ('Dimas Pratama',     '081290332181',  -1, '11:00', 'ROOM-01',  60, 'paid',    'transfer'),
    ('Alya Ramadhani',    '085719103402',  -1, '14:00', 'ROOM-02', 120, 'paid',    'qris'),
    ('Kevin Aditya',      '081924405638',  -2, '16:00', 'ROOM-03',  60, 'paid',    'card'),
    ('Mira Anggraini',    '082260251830',  -3, '10:00', 'ROOM-01',  90, 'paid',    'cash'),
    ('Fajar Nugraha',     '081183926017',  -4, '15:00', 'ROOM-02',  60, 'paid',    'qris'),
    ('Putri Ayuningtyas', '081377889900',  -5, '13:00', 'ROOM-03', 120, 'paid',    'transfer'),
    ('Galih Saputra',     '085600112233',  -6, '17:00', 'ROOM-01',  60, 'pending', null),
    ('Rina Oktaviani',    '081299887766', -10, '11:00', 'ROOM-02',  90, 'paid',    'qris'),
    ('Yoga Pratama',      '082144556677', -15, '14:00', 'ROOM-03',  60, 'paid',    'cash'),
    ('Laras Wening',      '081566778899', -20, '10:00', 'ROOM-01', 120, 'paid',    'transfer'),
    ('Bima Aditama',      '081211223344',   1, '10:00', 'ROOM-02',  60, 'pending', null),
    ('Citra Lestari',     '081255667788',   2, '13:00', 'ROOM-03',  90, 'pending', null);

-- 2) Pelanggan.
insert into public.customers (full_name, phone)
select full_name, phone from demo_data
on conflict (phone) do update set full_name = excluded.full_name;

-- 3) Reservasi (trigger otomatis mengisi ends_at dan membuat tagihan pending).
insert into public.reservations (customer_id, room_id, starts_at, duration_minutes, total_price)
select c.id,
       r.id,
       (((now() at time zone 'Asia/Jakarta')::date + d.day_offset) + d.start_time) at time zone 'Asia/Jakarta',
       d.duration_minutes,
       round(r.hourly_rate * d.duration_minutes / 60.0, 2)
from demo_data d
join public.customers c on c.phone = d.phone
join public.studio_rooms r on r.code = d.room_code
on conflict do nothing;

-- 4) Tandai lunas sesuai data contoh.
update public.payments p
set status = 'paid', method = d.pay_method, paid_at = res.starts_at
from demo_data d
join public.customers c on c.phone = d.phone
join public.reservations res on res.customer_id = c.id
    and res.starts_at = (((now() at time zone 'Asia/Jakarta')::date + d.day_offset) + d.start_time) at time zone 'Asia/Jakarta'
where p.reservation_id = res.id
  and d.pay_status = 'paid'
  and p.status = 'pending';

-- 5) Ringkasan hasil.
select count(*) filter (where p.status = 'paid')    as lunas,
       count(*) filter (where p.status = 'pending') as belum_lunas,
       sum(p.amount) filter (where p.status = 'paid') as total_lunas
from public.payments p
join public.reservations res on res.id = p.reservation_id
join public.customers c on c.id = res.customer_id
where c.phone in (select phone from demo_data);

-- Untuk menghapus data contoh ini nanti:
-- delete from public.reservations where customer_id in
--   (select id from public.customers where phone in ('081245671023','081320887152','082177624490','081290332181','085719103402','081924405638','082260251830','081183926017','081377889900','085600112233','081299887766','082144556677','081566778899','081211223344','081255667788'));
-- delete from public.customers where phone in ('081245671023','081320887152','082177624490','081290332181','085719103402','081924405638','082260251830','081183926017','081377889900','085600112233','081299887766','082144556677','081566778899','081211223344','081255667788');
