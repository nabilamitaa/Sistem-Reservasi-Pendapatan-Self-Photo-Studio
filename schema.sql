create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists public.customers (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (char_length(trim(full_name)) >= 2),
    phone text not null unique,
    created_at timestamptz not null default now()
);

create table if not exists public.studio_rooms (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null unique,
    hourly_rate numeric(12, 2) not null check (hourly_rate > 0),
    capacity smallint not null default 4 check (capacity > 0),
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.reservations (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references public.customers(id),
    room_id uuid not null references public.studio_rooms(id),
    starts_at timestamptz not null,
    duration_minutes integer not null check (duration_minutes between 30 and 240 and duration_minutes % 30 = 0),
    ends_at timestamptz not null,
    total_price numeric(12, 2) not null check (total_price > 0),
    status text not null default 'confirmed' check (status in ('confirmed', 'completed', 'cancelled')),
    notes text not null default '',
    created_at timestamptz not null default now(),
    constraint reservations_no_room_overlap
        exclude using gist (
            room_id with =,
            tstzrange(starts_at, ends_at, '[)') with &&
        ) where (status <> 'cancelled')
);

create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    reservation_id uuid not null unique references public.reservations(id) on delete cascade,
    amount numeric(12, 2) not null check (amount > 0),
    status text not null default 'pending' check (status in ('pending', 'paid', 'refunded')),
    method text check (method in ('cash', 'qris', 'transfer', 'card')),
    paid_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists reservations_starts_at_idx on public.reservations (starts_at desc);
create index if not exists reservations_room_id_idx on public.reservations (room_id);
create index if not exists reservations_customer_id_idx on public.reservations (customer_id);
create index if not exists payments_status_idx on public.payments (status);

create or replace function public.set_reservation_ends_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.ends_at := new.starts_at + new.duration_minutes * interval '1 minute';
    return new;
end;
$$;

drop trigger if exists reservations_set_ends_at on public.reservations;
create trigger reservations_set_ends_at
before insert or update on public.reservations
for each row execute function public.set_reservation_ends_at();

create or replace function public.create_reservation_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.payments (reservation_id, amount)
    values (new.id, new.total_price);
    return new;
end;
$$;

drop trigger if exists reservations_create_payment on public.reservations;
create trigger reservations_create_payment
after insert on public.reservations
for each row execute function public.create_reservation_payment();

insert into public.studio_rooms (code, name, hourly_rate, capacity)
values
    ('ROOM-01', 'Ruang Classic', 85000, 4),
    ('ROOM-02', 'Ruang Bloom', 100000, 5),
    ('ROOM-03', 'Ruang Noir', 120000, 4)
on conflict (code) do update
set name = excluded.name,
    hourly_rate = excluded.hourly_rate,
    capacity = excluded.capacity;

alter table public.customers enable row level security;
alter table public.studio_rooms enable row level security;
alter table public.reservations enable row level security;
alter table public.payments enable row level security;

drop policy if exists "Allow all access to customers" on public.customers;
drop policy if exists "Allow all access to studio_rooms" on public.studio_rooms;
drop policy if exists "Allow all access to reservations" on public.reservations;
drop policy if exists "Allow all access to payments" on public.payments;

create policy "Allow all access to customers"
on public.customers
for all to authenticated
using (true)
with check (true);

create policy "Allow all access to studio_rooms"
on public.studio_rooms
for all to authenticated
using (true)
with check (true);

create policy "Allow all access to reservations"
on public.reservations
for all to authenticated
using (true)
with check (true);

create policy "Allow all access to payments"
on public.payments
for all to authenticated
using (true)
with check (true);
