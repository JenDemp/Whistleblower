-- ================================================================
-- JENSEN Whistleblower – v2 databasschema
-- Tre anmälartyper: helt anonym (kod), anonym+notiser (konto, dold
-- identitet), öppen (konto, synlig identitet).
--
-- KÖR HELA DETTA I: Supabase Dashboard → SQL Editor → Run
-- OBS: Detta NOLLSTÄLLER all data (ärenden, meddelanden, profiler,
-- inloggningskonton). Kör bara om du är säker.
-- ================================================================

-- ── 0. NOLLSTÄLLNING ────────────────────────────────────────────
drop table if exists public.attachments cascade;
drop table if exists public.messages    cascade;
drop table if exists public.cases       cascade;
drop table if exists public.admins      cascade;
drop table if exists public.profiles    cascade;

drop function if exists public.handle_new_user()               cascade;
drop function if exists public.generate_wb_token()              cascade;
drop function if exists public.create_anonymous_case(text,text,text,text,text,text,text,text,uuid,text) cascade;
drop function if exists public.get_case_by_code(text)           cascade;
drop function if exists public.add_anonymous_message(text,text) cascade;

-- Rensa alla befintliga inloggningskonton (medarbetare + admins).
-- Kommentera bort raden nedan om du vill behålla admin-kontona.
delete from auth.users;

-- pgcrypto behövs för crypt()/gen_salt() (lösenordshash för access-koder)
create extension if not exists pgcrypto;


-- ── 1. DELAD TOKEN-GENERATOR (WB-ärendenummer) ─────────────────
create or replace function public.generate_wb_token()
returns text language plpgsql as $$
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
    exit when not exists (select 1 from public.cases where anonymous_token = new_token);
  end loop;
  return new_token;
end;
$$;


-- ── 2. PROFILER (för anmälartyp 2 & 3 – har inloggningskonto) ──
-- reporter_type: 'anonymous_email' (anonym m. notiser) | 'open' (öppen anmälare)
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  reporter_type text not null default 'anonymous_email'
                check (reporter_type in ('anonymous_email','open')),
  is_admin      boolean not null default false,
  name          text,   -- endast ifyllt för reporter_type='open'
  phone         text,   -- endast ifyllt för reporter_type='open', valfritt
  created_at    timestamptz not null default now(),
  check (reporter_type = 'open' or (name is null and phone is null))
);
alter table public.profiles enable row level security;
create policy "Profil: läs eget" on public.profiles
  for select using (auth.uid() = id);


-- ── 3. ADMINS ────────────────────────────────────────────────────
create table public.admins (
  id    uuid primary key references public.profiles(id) on delete cascade,
  name  text not null,
  title text not null,
  role  text not null,
  photo text
);
alter table public.admins enable row level security;
create policy "Admins: inloggad kan läsa" on public.admins
  for select using (auth.role() = 'authenticated');


-- ── 4. ÄRENDEN ───────────────────────────────────────────────────
-- reporter_type: 'anonymous_code' (helt anonym) | 'anonymous_email' | 'open'
create table public.cases (
  id                 uuid primary key default gen_random_uuid(),
  anonymous_token    text not null unique,
  reporter_type      text not null check (reporter_type in ('anonymous_code','anonymous_email','open')),

  -- typ 2 & 3: kopplat konto. typ 1: alltid null.
  employee_id        uuid references auth.users(id),
  -- typ 1: bcrypt-hash av åtkomstkoden. typ 2 & 3: alltid null.
  access_code_hash    text,
  -- endast typ 3 ('open'): namn/telefon synligt för admin
  reporter_name       text,
  reporter_phone       text,

  recipient_admin_id uuid not null references public.admins(id),
  category           text not null,
  department         text not null,
  department_detail  text,   -- Staber-undersval, eller fritext vid "Annat"

  -- 5 valfria fält från anmälningsformuläret
  who_involved    text,
  where_happened  text,
  when_happened   text,
  what_happened   text,
  other_actions   text,

  status     text not null default 'open',
  created_at timestamptz not null default now(),

  check (reporter_type = 'open' or (reporter_name is null and reporter_phone is null)),
  check (reporter_type != 'anonymous_code' or (employee_id is null and access_code_hash is not null)),
  check (reporter_type  = 'anonymous_code' or (employee_id is not null and access_code_hash is null))
);
alter table public.cases enable row level security;

-- Medarbetare (typ 2 & 3): se och skapa egna ärenden
create policy "Cases: medarbetare läser egna" on public.cases
  for select using (auth.uid() = employee_id);

create policy "Cases: medarbetare skapar" on public.cases
  for insert with check (
    auth.uid() = employee_id and
    reporter_type = (select reporter_type from public.profiles where id = auth.uid())
  );

-- Admin: se och uppdatera tilldelade ärenden (alla typer, inkl. anonym_code)
create policy "Cases: admin läser tilldelade" on public.cases
  for select using (auth.uid() = recipient_admin_id);

create policy "Cases: admin uppdaterar status" on public.cases
  for update using (auth.uid() = recipient_admin_id);

-- OBS: ingen INSERT-policy för anonym_code (typ 1) – de skapas
-- uteslutande via create_anonymous_case() nedan (SECURITY DEFINER,
-- kringgår RLS kontrollerat).


-- ── 5. MEDDELANDEN ────────────────────────────────────────────────
create table public.messages (
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


-- ── 6. BILAGOR (metadata; filer lagras i Storage-bucket) ─────────
create table public.attachments (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases(id) on delete cascade,
  file_path  text not null,   -- sökväg i Storage-bucketen 'case-attachments'
  file_name  text not null,
  file_size  int  not null,
  created_at timestamptz not null default now()
);
alter table public.attachments enable row level security;

create policy "Attachments: medarbetare" on public.attachments
  for all using (
    exists (select 1 from public.cases c
            where c.id = attachments.case_id and c.employee_id = auth.uid())
  );

create policy "Attachments: admin" on public.attachments
  for all using (
    exists (select 1 from public.cases c
            where c.id = attachments.case_id and c.recipient_admin_id = auth.uid())
  );


-- ── 7. TRIGGER – profil skapas när typ 2/3-konto registreras ────
-- reporter_type, name, phone skickas med via signUp(options.data)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, reporter_type, is_admin, name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'reporter_type', 'anonymous_email'),
    false,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 8. RPC: skapa helt anonymt ärende (typ 1) ────────────────────
-- Anropas med anon-nyckeln, ingen inloggning krävs.
-- Returnerar en engångskod – enda vägen tillbaka till ärendet.
create or replace function public.create_anonymous_case(
  p_category           text,
  p_department          text,
  p_department_detail   text,
  p_who_involved        text,
  p_where_happened      text,
  p_when_happened       text,
  p_what_happened       text,
  p_other_actions       text,
  p_recipient_admin_id  uuid,
  p_message             text
)
returns table(case_id uuid, access_code text, wb_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text;
  v_token text;
  v_id    uuid;
begin
  -- 24 slumpmässiga tecken (base64url-alfabet minus lättförväxlade tecken)
  v_code := replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '/', ''), '+', ''), '=', '');
  v_token := public.generate_wb_token();

  insert into public.cases (
    anonymous_token, reporter_type, access_code_hash,
    recipient_admin_id, category, department, department_detail,
    who_involved, where_happened, when_happened, what_happened, other_actions,
    status
  ) values (
    v_token, 'anonymous_code', crypt(v_code, gen_salt('bf')),
    p_recipient_admin_id, p_category, p_department, p_department_detail,
    p_who_involved, p_where_happened, p_when_happened, p_what_happened, p_other_actions,
    'open'
  )
  returning id into v_id;

  insert into public.messages (case_id, from_role, text)
  values (v_id, 'employee', p_message);

  return query select v_id, v_code, v_token;
end;
$$;

-- Endast anon/authenticated får anropa (INSERT-rättigheter på tabellerna
-- krävs INTE eftersom SECURITY DEFINER kör som ägaren):
grant execute on function public.create_anonymous_case to anon, authenticated;


-- ── 9. RPC: hämta ärende + meddelanden via kod (typ 1 – uppföljning) ──
create or replace function public.get_case_by_code(p_code text)
returns table(
  case_id      uuid,
  wb_token     text,
  category     text,
  department   text,
  status       text,
  created_at   timestamptz,
  admin_name   text,
  messages     jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case record;
begin
  select c.id, c.anonymous_token, c.category, c.department, c.status, c.created_at, c.recipient_admin_id
    into v_case
    from public.cases c
    where c.reporter_type = 'anonymous_code'
      and c.access_code_hash = crypt(p_code, c.access_code_hash);

  if v_case.id is null then
    return; -- tom result set = felaktig kod
  end if;

  return query
    select
      v_case.id, v_case.anonymous_token, v_case.category, v_case.department,
      v_case.status, v_case.created_at,
      (select a.name from public.admins a where a.id = v_case.recipient_admin_id),
      (select coalesce(jsonb_agg(jsonb_build_object(
                'from_role', m.from_role, 'text', m.text, 'created_at', m.created_at
              ) order by m.created_at), '[]'::jsonb)
       from public.messages m where m.case_id = v_case.id);
end;
$$;

grant execute on function public.get_case_by_code to anon, authenticated;


-- ── 10. RPC: svara anonymt via kod (typ 1 – uppföljning) ─────────
-- TODO(human): implementera denna funktion.
-- Ska följa samma mönster som get_case_by_code ovan: slå upp ärendet
-- via crypt(p_code, access_code_hash), och om det INTE hittas ska
-- funktionen returnera false (inte ett fel – vi vill inte avslöja
-- om koden nästan stämde). Om ärendet hittas: infoga ett nytt
-- meddelande i public.messages med from_role='employee' och den
-- inskickade texten, returnera sedan true.
create or replace function public.add_anonymous_message(p_code text, p_text text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- TODO(human): implementera
  return false;
end;
$$;

grant execute on function public.add_anonymous_message to anon, authenticated;


-- ── 11. STORAGE – bilagor (max 50MB per ärende, hanteras i appen) ─
insert into storage.buckets (id, name, public, file_size_limit)
values ('case-attachments', 'case-attachments', false, 52428800)
on conflict (id) do update set file_size_limit = 52428800;

create policy "Attachments storage: medarbetare läser/laddar upp"
  on storage.objects for all using (
    bucket_id = 'case-attachments' and
    exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.employee_id = auth.uid()
    )
  );

create policy "Attachments storage: admin läser"
  on storage.objects for select using (
    bucket_id = 'case-attachments' and
    exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and c.recipient_admin_id = auth.uid()
    )
  );


-- ================================================================
-- STEG 2 (TILLÄGG – kör detta block separat, EJ destruktivt):
-- Upptäckt medan klienten byggdes. Säkert att köra utan att förlora data.
-- ================================================================

-- 12. Auto-generera ärendenummer även för konto-baserade ärenden
-- (typ 2 & 3 skapas via direkt INSERT från appen, inte via RPC,
-- så de behöver en trigger istället för RPC:ns egen anrop).
create or replace function public.set_case_token()
returns trigger language plpgsql as $$
begin
  if new.anonymous_token is null then
    new.anonymous_token := public.generate_wb_token();
  end if;
  return new;
end;
$$;

drop trigger if exists before_case_insert on public.cases;
create trigger before_case_insert
  before insert on public.cases
  for each row execute function public.set_case_token();

-- 13. Bilage-metadata: tillåt att en helt anonym anmälare (typ 1)
-- registrerar sina egna uppladdade filer. case_id är en slumpmässig
-- UUID (praktiskt taget ogissbar) som bara den som skapade/känner
-- till ärendet har tillgång till.
create policy "Attachments: anonym metadata"
  on public.attachments for insert with check (
    exists (select 1 from public.cases c
            where c.id = attachments.case_id and c.reporter_type = 'anonymous_code')
  );

-- 14. Admins måste vara läsbara även för OINLOGGADE besökare —
-- en helt anonym anmälare (typ 1) har ingen session alls när de
-- väljer mottagare i anmälningsformuläret. Namn/titel/foto är redan
-- publikt (visas på Kontakter-sidan), så publik läsrättighet är säkert.
drop policy if exists "Admins: inloggad kan läsa" on public.admins;
create policy "Admins: alla kan läsa" on public.admins
  for select using (true);

-- 15. Storage: tillåt uppladdning av filer till en anonym (typ 1)
-- ärendemapp. Samma resonemang som ovan – case_id fungerar som
-- en ogissbar nyckel eftersom det bara delas med den som skapade ärendet.
create policy "Attachments storage: anonym uppladdning"
  on storage.objects for insert with check (
    bucket_id = 'case-attachments' and
    exists (select 1 from public.cases c
            where c.id::text = (storage.foldername(name))[1]
              and c.reporter_type = 'anonymous_code')
  );


-- ================================================================
-- STEG 3: Kör EFTER att admins registrerat sig i appen som
-- "öppen anmälare" (namn+lösenord). Hämta UUID från
-- Authentication → Users i Supabase och klistra in nedan.
-- ================================================================

-- UPDATE public.profiles SET is_admin = true WHERE id = 'UUID_HÄR';
-- INSERT INTO public.admins (id, name, title, role, photo) VALUES
--   ('DENNIS_UUID',  'Dennis Roslinde',   'Kvalitetsanalytiker & admin', 'Admin', null),
--   ('ULRIKA_UUID',  'Ulrika Westerström','HR-chef',                     'HR',     'Pictures_of_HR_contacts/Ulrika_boss.png'),
--   ('LEIF_UUID',    'Leif Glavå',        'Kvalitets- och utvecklingschef','Ledning','Pictures_of_HR_contacts/Leif_Boss.png'),
--   ('RIKARD_UUID',  'Rikard Östrup',     'HR-partner',                  'HR',     null),
--   ('IRINA_UUID',   'Irina Dahlquist',   'HR-partner',                  'HR',     null);
