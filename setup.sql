-- ================================================================
-- JENSEN Visselblåsartjänst – Databasschema
-- Kör hela detta skript i: Supabase Dashboard → SQL Editor → Run
-- ================================================================

-- 1. PROFILER – kopplar auth-konto till anonym ärendetoken
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  anonymous_token text unique,
  is_admin        boolean not null default false,
  created_at      timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Profil: läs eget" on public.profiles
  for select using (auth.uid() = id);

-- 2. ADMINS – HR/chef-metadata (kopplas till profiles via samma UUID)
create table if not exists public.admins (
  id    uuid primary key references public.profiles(id) on delete cascade,
  name  text not null,
  title text not null,
  role  text not null,
  photo text           -- relativ sökväg till bild, t.ex. 'Pictures_of_HR_contacts/Rikard_HR.png'
);
alter table public.admins enable row level security;
create policy "Admins: inloggad kan läsa" on public.admins
  for select using (auth.role() = 'authenticated');

-- 3. ÄRENDEN – anonymt token är det enda som visas för admins
create table if not exists public.cases (
  id                 uuid primary key default gen_random_uuid(),
  anonymous_token    text not null,
  employee_id        uuid not null references auth.users(id),   -- DOLD för admins i appen
  recipient_admin_id uuid not null references public.admins(id),
  category           text not null,
  status             text not null default 'open',
  created_at         timestamptz not null default now()
);
alter table public.cases enable row level security;

-- Medarbetare: se och skapa egna ärenden
create policy "Cases: medarbetare läser egna" on public.cases
  for select using (auth.uid() = employee_id);

create policy "Cases: medarbetare skapar" on public.cases
  for insert with check (
    auth.uid() = employee_id and
    anonymous_token = (select anonymous_token from public.profiles where id = auth.uid())
  );

-- Admin: se och uppdatera tilldelade ärenden
create policy "Cases: admin läser tilldelade" on public.cases
  for select using (auth.uid() = recipient_admin_id);

create policy "Cases: admin uppdaterar status" on public.cases
  for update using (auth.uid() = recipient_admin_id);

-- 4. MEDDELANDEN
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases(id) on delete cascade,
  from_role  text not null,    -- 'employee' | 'admin'
  text       text not null,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;

create policy "Messages: medarbetare" on public.messages
  for all using (
    exists (select 1 from public.cases c
            where c.id = messages.case_id and c.employee_id = auth.uid())
  );

create policy "Messages: admin" on public.messages
  for all using (
    exists (select 1 from public.cases c
            where c.id = messages.case_id and c.recipient_admin_id = auth.uid())
  );

-- 5. TRIGGER – skapar profil med unikt anonymt token vid registrering
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  chars     text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_token text;
  i         int;
begin
  loop
    new_token := 'WB-';
    for i in 1..6 loop
      new_token := new_token || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where anonymous_token = new_token);
  end loop;
  insert into public.profiles (id, anonymous_token, is_admin)
  values (new.id, new_token, false);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ================================================================
-- STEG 2: Kör detta EFTER att Dennis registrerat sig i appen
-- Gå till Authentication → Users i Supabase → kopiera UUID för
-- dennis.roslinde@jenseneducation.se och klistra in nedan.
-- ================================================================

-- UPDATE public.profiles SET is_admin = true WHERE id = 'DENNIS_UUID_HÄR';
-- INSERT INTO public.admins (id, name, title, role, photo) VALUES
--   ('DENNIS_UUID_HÄR', 'Dennis Roslinde', 'Administratör', 'Admin', null);

-- Gör sedan samma sak för Rikard, Leif och Ulrika när de registrerat sig:
-- UPDATE public.profiles SET is_admin = true WHERE id = 'DERAS_UUID';
-- INSERT INTO public.admins (id, name, title, role, photo) VALUES
--   ('RIKARD_UUID', 'Rikard Östrup',  'HR-partner',                   'HR',     'Pictures_of_HR_contacts/Rikard_HR.png'),
--   ('LEIF_UUID',   'Leif Glavå',     'Kvalitets- och utvecklingschef','Ledning','Pictures_of_HR_contacts/Leif_Boss.png'),
--   ('ULRIKA_UUID', 'Ulrika',         'Chef',                         'Ledning','Pictures_of_HR_contacts/Ulrika_boss.png');
