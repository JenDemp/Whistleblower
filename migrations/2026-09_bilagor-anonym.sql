-- ================================================================
-- BILAGOR FUNGERADE INTE FÖR HELT ANONYMA ANMÄLARE (typ 1)
--
-- Både uppladdningen till Storage och metadata-raden avvisades med
-- "new row violates row-level security policy".
--
-- Orsak: policyn frågade
--
--   exists (select 1 from public.cases c where c.id = ... )
--
-- men public.cases har SELECT-policyer bara för inloggad medarbetare
-- och för admin. En typ 1-anmälare är rollen "anon" och matchar ingen
-- av dem. RLS gäller även inuti ett policyuttryck, så subfrågan gav
-- alltid noll rader och villkoret blev alltid falskt.
--
-- Lösning: en SECURITY DEFINER-funktion som får läsa cases förbi RLS
-- och bara svarar ja/nej. Den läcker ingenting — den avslöjar bara att
-- ett visst case_id finns, och det UUID:t känner ingen till utom den
-- som just skapade ärendet.
--
-- Dessutom ett tidsfönster: bilagor laddas upp sekunder efter att
-- ärendet skapats. Utan fönstret vore ett läckt case_id en permanent
-- skrivrättighet in i vår Storage-bucket.
-- ================================================================

create or replace function public.can_attach_to_anonymous_case(p_case_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- id::text i stället för cast av parametern: en mapp som inte är ett
  -- giltigt UUID ska ge false, inte ett kastat fel.
  select exists (
    select 1
    from public.cases
    where id::text = p_case_id
      and reporter_type = 'anonymous_code'
      and created_at > now() - interval '1 hour'
  );
$$;

grant execute on function public.can_attach_to_anonymous_case to anon, authenticated;


-- ── Metadata-raden i public.attachments ──────────────────────────
drop policy if exists "Attachments: anonym metadata" on public.attachments;

create policy "Attachments: anonym metadata" on public.attachments
  for insert with check (
    public.can_attach_to_anonymous_case(attachments.case_id::text)
  );


-- ── Själva filen i Storage ───────────────────────────────────────
drop policy if exists "Attachments storage: anonym uppladdning" on storage.objects;

create policy "Attachments storage: anonym uppladdning"
  on storage.objects for insert with check (
    bucket_id = 'case-attachments'
    and public.can_attach_to_anonymous_case((storage.foldername(name))[1])
  );
