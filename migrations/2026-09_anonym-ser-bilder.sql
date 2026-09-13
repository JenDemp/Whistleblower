-- ================================================================
-- HELT ANONYM ANMÄLARE (typ 1) SKA SE SINA BILDER
--
-- Typ 1 har ingen session och därmed ingen läsrätt i Storage, så de
-- kunde bara se filnamnen. För att visa bilderna behövs signerade
-- länkar, och en signering kräver att anroparen får läsa filen.
--
-- Lösning utan Edge Function:
--   1. open_case_files(kod) kontrollerar åtkomstkoden med samma
--      bcrypt-jämförelse som get_case_by_code.
--   2. Stämmer koden öppnas ett läsfönster på TVÅ minuter för just det
--      ärendet, och bilagornas sökvägar returneras.
--   3. Webbläsaren signerar länkarna direkt efteråt. Länkarna gäller
--      sedan en timme, oberoende av fönstret.
--
-- Fönstret är kort med avsikt. Signeringen sker millisekunder efter
-- att koden kontrollerats, så två minuter räcker med marginal. Under
-- fönstret skulle någon som känner till ärendets interna UUID också
-- kunna signera — men det UUID:t lämnas bara ut till den som redan
-- har åtkomstkoden, och fönstret stängs av sig självt.
-- ================================================================

create table if not exists public.attachment_view_grants (
  case_id    uuid primary key references public.cases(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.attachment_view_grants enable row level security;
-- Inga policyer: bara SECURITY DEFINER-funktionerna nedan rör tabellen.


create or replace function public.open_case_files(p_code text)
returns table(file_path text, file_name text, file_size int, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_case_id uuid;
begin
  select id into v_case_id
    from public.cases
    where reporter_type = 'anonymous_code'
      and access_code_hash = crypt(p_code, access_code_hash);

  -- Tomt resultat vid fel kod: avslöja aldrig om koden nästan stämde.
  if v_case_id is null then
    return;
  end if;

  delete from public.attachment_view_grants where expires_at < now();

  insert into public.attachment_view_grants (case_id, expires_at)
  values (v_case_id, now() + interval '2 minutes')
  on conflict (case_id) do update set expires_at = excluded.expires_at;

  return query
    select a.file_path, a.file_name, a.file_size, a.created_at
    from public.attachments a
    where a.case_id = v_case_id
    order by a.created_at;
end;
$$;

grant execute on function public.open_case_files to anon, authenticated;


-- SECURITY DEFINER av samma skäl som can_attach_to_anonymous_case:
-- rollen anon får inte läsa tabellen själv, och RLS gäller även inuti
-- ett policyuttryck.
create or replace function public.has_file_view_grant(p_case_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.attachment_view_grants
    where case_id::text = p_case_id
      and expires_at > now()
  );
$$;

grant execute on function public.has_file_view_grant to anon, authenticated;


drop policy if exists "Attachments storage: anonym läsning via kod" on storage.objects;

create policy "Attachments storage: anonym läsning via kod"
  on storage.objects for select using (
    bucket_id = 'case-attachments'
    and public.has_file_view_grant((storage.foldername(name))[1])
  );
