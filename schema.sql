-- ================================================================
-- JENSEN Whistleblower — DATABASENS NULÄGE
--
-- Detta är sanningen om hur databasen ser ut just nu. Varje tabell,
-- policy och funktion står här EN gång, i sin slutgiltiga form.
--
-- Läs den här filen när du vill veta vad något gör.
-- Läs migrations/ när du vill veta hur vi hamnade här.
--
-- Kör den här filen bara mot ett TOMT Supabase-projekt. Mot den
-- befintliga databasen behövs den inte — den är redan i det här läget.
-- Nya ändringar läggs som en ny fil i migrations/ och skrivs sedan
-- in här.
-- ================================================================

create extension if not exists pgcrypto;


-- ── TOKEN-GENERATOR (WB-ärendenummer) ───────────────────────────
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


-- ── PROFILER (anmälartyp 2 & 3 – har inloggningskonto) ──────────
-- reporter_type: 'anonymous_email' (anonym m. notiser) | 'open' (öppen)
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  reporter_type text not null default 'anonymous_email'
                check (reporter_type in ('anonymous_email','open')),
  is_admin      boolean not null default false,
  name          text,   -- endast för reporter_type='open'
  phone         text,   -- endast för reporter_type='open', valfritt
  created_at    timestamptz not null default now(),
  check (reporter_type = 'open' or (name is null and phone is null))
);
alter table public.profiles enable row level security;

create policy "Profil: läs eget" on public.profiles
  for select using (auth.uid() = id);


-- ── ADMINS ───────────────────────────────────────────────────────
-- is_super_admin: ser allt men får INGA automatiska mejlnotiser.
create table if not exists public.admins (
  id             uuid primary key references public.profiles(id) on delete cascade,
  name           text not null,
  title          text not null,
  role           text not null,
  photo          text,
  is_super_admin boolean not null default false
);
alter table public.admins enable row level security;

-- Publikt läsbar: en helt anonym anmälare (typ 1) har ingen session
-- alls, och namn/titel/foto visas ändå öppet på Kontakter-sidan.
create policy "Admins: alla kan läsa" on public.admins
  for select using (true);


-- ── ÄRENDEN ──────────────────────────────────────────────────────
-- reporter_type: 'anonymous_code' | 'anonymous_email' | 'open'
-- Ingen mottagare per ärende — alla admins delar en inkorg.
create table if not exists public.cases (
  id                 uuid primary key default gen_random_uuid(),
  anonymous_token    text not null unique,
  reporter_type      text not null check (reporter_type in ('anonymous_code','anonymous_email','open')),

  employee_id        uuid references auth.users(id),  -- typ 2 & 3; null för typ 1
  access_code_hash   text,                            -- typ 1; bcrypt-hash av koden
  reporter_name      text,                            -- endast typ 3
  reporter_phone     text,                            -- endast typ 3

  subject            text,
  category           text not null,
  department         text not null,
  department_detail  text,   -- Staber-undersval, eller fritext vid "Annat"

  who_involved    text,
  where_happened  text,
  when_happened   text,
  what_happened   text,   -- utgått ur formuläret, behålls för äldre ärenden
  other_actions   text,

  status     text not null default 'open',
  created_at timestamptz not null default now(),

  check (reporter_type = 'open' or (reporter_name is null and reporter_phone is null)),
  check (reporter_type != 'anonymous_code' or (employee_id is null and access_code_hash is not null)),
  check (reporter_type  = 'anonymous_code' or (employee_id is not null and access_code_hash is null))
);
alter table public.cases enable row level security;

create policy "Cases: medarbetare läser egna" on public.cases
  for select using (auth.uid() = employee_id);

create policy "Cases: medarbetare skapar" on public.cases
  for insert with check (
    auth.uid() = employee_id and
    reporter_type = (select reporter_type from public.profiles where id = auth.uid())
  );

create policy "Cases: admin läser alla" on public.cases
  for select using (exists (select 1 from public.admins a where a.id = auth.uid()));

create policy "Cases: admin uppdaterar status" on public.cases
  for update using (exists (select 1 from public.admins a where a.id = auth.uid()));

-- Typ 1 har medvetet INGEN insert-policy — de ärendena skapas
-- uteslutande via create_anonymous_case() (SECURITY DEFINER).

-- Ärendenummer sätts automatiskt när appen skapar ärendet direkt.
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


-- ── MEDDELANDEN ──────────────────────────────────────────────────
-- sender_id: vilken admin som svarade (delad inkorg = flera möjliga).
-- Null för anmälarens egna meddelanden.
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases(id) on delete cascade,
  from_role  text not null,    -- 'employee' | 'admin'
  text       text not null,
  sender_id  uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;

create policy "Messages: medarbetare" on public.messages
  for all using (
    exists (select 1 from public.cases c
            where c.id = messages.case_id and c.employee_id = auth.uid())
  );

create policy "Messages: admin" on public.messages
  for all using (exists (select 1 from public.admins a where a.id = auth.uid()));


-- ── INTERNA ANTECKNINGAR (endast admins) ─────────────────────────
-- Handläggarnas egna noteringar i ett ärende. Visselblåsaren ska
-- ALDRIG kunna läsa dem — därför en egen tabell istället för en flagga
-- på messages, och därför ingen läspolicy för anmälare.
create table if not exists public.case_notes (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases(id) on delete cascade,
  author_id  uuid not null references auth.users(id),
  text       text not null,
  created_at timestamptz not null default now()
);
alter table public.case_notes enable row level security;

create index if not exists case_notes_case_created_idx
  on public.case_notes (case_id, created_at);

create policy "Notes: admin läser" on public.case_notes
  for select using (exists (select 1 from public.admins a where a.id = auth.uid()));

-- author_id = auth.uid() hindrar att någon signerar en anteckning med
-- en kollegas namn.
create policy "Notes: admin skriver" on public.case_notes
  for insert with check (
    author_id = auth.uid()
    and exists (select 1 from public.admins a where a.id = auth.uid())
  );

create policy "Notes: admin raderar egna" on public.case_notes
  for delete using (
    author_id = auth.uid()
    and exists (select 1 from public.admins a where a.id = auth.uid())
  );

-- Medvetet INGEN update-policy: en anteckning står kvar som den skrevs.


-- ── BILAGOR (metadata; filerna ligger i Storage) ─────────────────
create table if not exists public.attachments (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases(id) on delete cascade,
  file_path  text not null,
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
  for all using (exists (select 1 from public.admins a where a.id = auth.uid()));

-- Typ 1 saknar session och kan därför inte matchas mot employee_id.
-- case_id är en slumpad UUID som bara den som skapade ärendet känner till.
--
-- Villkoret MÅSTE gå via can_attach_to_anonymous_case() nedan. En rak
-- subfråga mot public.cases ser noll rader här, eftersom cases har RLS
-- och rollen "anon" saknar SELECT-policy — och då blir villkoret alltid
-- falskt. Det var precis så bilagorna gick sönder för typ 1.
create policy "Attachments: anonym metadata" on public.attachments
  for insert with check (
    public.can_attach_to_anonymous_case(attachments.case_id::text)
  );


-- ── PROFIL SKAPAS VID REGISTRERING (typ 2 & 3) ───────────────────
-- reporter_type/name/phone kommer från signUp(options.data).
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


-- ================================================================
-- RPC:er
--
-- pgcrypto ligger i schemat "extensions" i Supabase. Funktioner med
-- låst search_path måste därför lista det, annars hittas inte crypt().
-- ================================================================

-- ── Får den här anroparen bifoga filer till ett typ 1-ärende? ────
-- SECURITY DEFINER för att den ska få läsa public.cases förbi RLS.
-- Utan det ser rollen "anon" noll rader och alla bilagor avvisas.
-- Funktionen svarar bara ja/nej och läcker inget innehåll: den bekräftar
-- att ett case_id finns, och det UUID:t känner bara den till som nyss
-- skapade ärendet.
--
-- Tidsfönstret finns för att bilagor laddas upp sekunder efter att
-- ärendet skapats. Utan det vore ett läckt case_id en permanent
-- skrivrättighet in i vår Storage-bucket.
create or replace function public.can_attach_to_anonymous_case(p_case_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- id::text, inte cast av parametern: en mapp som inte är ett giltigt
  -- UUID ska ge false, inte kasta ett fel mitt i policyutvärderingen.
  select exists (
    select 1
    from public.cases
    where id::text = p_case_id
      and reporter_type = 'anonymous_code'
      and created_at > now() - interval '1 hour'
  );
$$;

grant execute on function public.can_attach_to_anonymous_case to anon, authenticated;


-- ── Skapa helt anonymt ärende (typ 1) ────────────────────────────
-- SECURITY DEFINER: anroparen har ingen session och kan inte skriva
-- själv. Returnerar en engångskod — enda vägen tillbaka till ärendet.
create or replace function public.create_anonymous_case(
  p_subject             text,
  p_category            text,
  p_department          text,
  p_department_detail   text,
  p_who_involved        text,
  p_where_happened      text,
  p_when_happened       text,
  p_what_happened       text,
  p_other_actions       text,
  p_message             text
)
returns table(case_id uuid, access_code text, wb_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code  text;
  v_token text;
  v_id    uuid;
begin
  v_code  := replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '/', ''), '+', ''), '=', '');
  v_token := public.generate_wb_token();

  insert into public.cases (
    anonymous_token, reporter_type, access_code_hash,
    subject, category, department, department_detail,
    who_involved, where_happened, when_happened, what_happened, other_actions,
    status
  ) values (
    v_token, 'anonymous_code', crypt(v_code, gen_salt('bf')),
    p_subject, p_category, p_department, p_department_detail,
    p_who_involved, p_where_happened, p_when_happened, p_what_happened, p_other_actions,
    'open'
  )
  returning id into v_id;

  insert into public.messages (case_id, from_role, text)
  values (v_id, 'employee', p_message);

  return query select v_id, v_code, v_token;
end;
$$;

grant execute on function public.create_anonymous_case to anon, authenticated;


-- ── Hämta anonymt ärende via kod (typ 1 – uppföljning) ───────────
create or replace function public.get_case_by_code(p_code text)
returns table(
  case_id            uuid,
  wb_token           text,
  subject            text,
  category           text,
  department         text,
  department_detail  text,
  who_involved       text,
  where_happened     text,
  when_happened      text,
  other_actions      text,
  status             text,
  created_at         timestamptz,
  messages           jsonb,
  attachments        jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_case record;
begin
  select c.id, c.anonymous_token, c.subject, c.category, c.department, c.department_detail,
         c.who_involved, c.where_happened, c.when_happened, c.other_actions,
         c.status, c.created_at
    into v_case
    from public.cases c
    where c.reporter_type = 'anonymous_code'
      and c.access_code_hash = crypt(p_code, c.access_code_hash);

  -- Tomt resultat vid fel kod: avslöja aldrig om koden nästan stämde.
  if v_case.id is null then
    return;
  end if;

  return query
    select
      v_case.id, v_case.anonymous_token, v_case.subject, v_case.category,
      v_case.department, v_case.department_detail,
      v_case.who_involved, v_case.where_happened, v_case.when_happened, v_case.other_actions,
      v_case.status, v_case.created_at,
      (select coalesce(jsonb_agg(jsonb_build_object(
                'from_role', m.from_role, 'text', m.text, 'created_at', m.created_at,
                'sender_id', m.sender_id
              ) order by m.created_at), '[]'::jsonb)
       from public.messages m where m.case_id = v_case.id),
      -- Bara namn, storlek och tidpunkt. file_path utelämnas medvetet:
      -- en nedladdningslänk hade krävt en ny läsväg in i Storage, och
      -- anmälaren har redan filerna. Det de behöver är bekräftelsen att
      -- bilagan finns i ärendet.
      (select coalesce(jsonb_agg(jsonb_build_object(
                'file_name', a.file_name, 'file_size', a.file_size, 'created_at', a.created_at
              ) order by a.created_at), '[]'::jsonb)
       from public.attachments a where a.case_id = v_case.id);
end;
$$;

grant execute on function public.get_case_by_code to anon, authenticated;


-- ── Svara anonymt via kod (typ 1 – uppföljning) ──────────────────
create or replace function public.add_anonymous_message(p_code text, p_text text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_case_id uuid;
begin
  select id into v_case_id
    from public.cases
    where reporter_type = 'anonymous_code'
      and access_code_hash = crypt(p_code, access_code_hash);

  if v_case_id is null then
    return false;
  end if;

  insert into public.messages (case_id, from_role, text)
  values (v_case_id, 'employee', p_text);

  return true;
end;
$$;

grant execute on function public.add_anonymous_message to anon, authenticated;


-- ── Skapa ärende med konto (typ 2 & 3) ───────────────────────────
-- SECURITY INVOKER: anroparen ÄR inloggad, så RLS ska gälla som vanligt.
-- Poängen är enbart atomicitet — ärende och första meddelandet skapas
-- i en transaktion och rullas tillbaka tillsammans om något går fel.
create or replace function public.create_case(
  p_reporter_type       text,
  p_subject             text,
  p_category            text,
  p_department          text,
  p_department_detail   text,
  p_who_involved        text,
  p_where_happened      text,
  p_when_happened       text,
  p_other_actions       text,
  p_message             text,
  p_reporter_name       text,
  p_reporter_phone      text
)
returns table(case_id uuid, wb_token text)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_id    uuid;
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'Inte inloggad';
  end if;

  insert into public.cases (
    reporter_type, employee_id,
    subject, category, department, department_detail,
    who_involved, where_happened, when_happened, other_actions,
    reporter_name, reporter_phone, status
  ) values (
    p_reporter_type, auth.uid(),
    p_subject, p_category, p_department, p_department_detail,
    p_who_involved, p_where_happened, p_when_happened, p_other_actions,
    case when p_reporter_type = 'open' then p_reporter_name  else null end,
    case when p_reporter_type = 'open' then p_reporter_phone else null end,
    'open'
  )
  returning id, anonymous_token into v_id, v_token;

  insert into public.messages (case_id, from_role, text)
  values (v_id, 'employee', p_message);

  return query select v_id, v_token;
end;
$$;

grant execute on function public.create_case to authenticated;


-- ── STORAGE (bilagor, max 50MB per fil) ──────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('case-attachments', 'case-attachments', false, 52428800)
on conflict (id) do update set file_size_limit = 52428800;

create policy "Attachments storage: medarbetare läser/laddar upp"
  on storage.objects for all using (
    bucket_id = 'case-attachments' and
    exists (select 1 from public.cases c
            where c.id::text = (storage.foldername(name))[1]
              and c.employee_id = auth.uid())
  );

create policy "Attachments storage: admin läser"
  on storage.objects for select using (
    bucket_id = 'case-attachments' and
    exists (select 1 from public.admins a where a.id = auth.uid())
  );

create policy "Attachments storage: anonym uppladdning"
  on storage.objects for insert with check (
    bucket_id = 'case-attachments'
    and public.can_attach_to_anonymous_case((storage.foldername(name))[1])
  );


-- ================================================================
-- ADMINS LÄGGS TILL MANUELLT
--
-- Personen registrerar sig först som vanlig anmälare i appen. Hämta
-- deras UUID i Authentication → Users och kör sedan:
--
--   UPDATE public.profiles SET is_admin = true WHERE id = 'UUID';
--   INSERT INTO public.admins (id, name, title, role, photo, is_super_admin)
--   VALUES ('UUID', 'Namn', 'Titel', 'HR', null, false);
--
-- is_super_admin = true endast för den som ska se allt utan att få
-- mejlnotiser för varje inkommande ärende.
-- ================================================================
