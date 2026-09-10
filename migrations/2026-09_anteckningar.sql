-- ================================================================
-- ANTECKNINGAR PÅ ÄRENDE (interna, endast för admins)
--
-- Handläggare behöver kunna skriva interna noteringar i ett ärende och
-- se varandras. Visselblåsaren ska ALDRIG kunna läsa dem.
--
-- Därför en egen tabell — inte en flagga på messages. Ett misstag i en
-- enda policy på messages skulle annars kunna läcka anteckningar till
-- anmälaren. Här finns ingen läspolicy alls för anmälare, och
-- get_case_by_code() (typ 1) rör inte tabellen.
-- ================================================================

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

-- Läsning: alla admins, så handläggare ser varandras anteckningar.
create policy "Notes: admin läser" on public.case_notes
  for select using (exists (select 1 from public.admins a where a.id = auth.uid()));

-- Skrivning: bara admins, och bara i eget namn. author_id = auth.uid()
-- hindrar att någon skriver en anteckning signerad av en kollega.
create policy "Notes: admin skriver" on public.case_notes
  for insert with check (
    author_id = auth.uid()
    and exists (select 1 from public.admins a where a.id = auth.uid())
  );

-- Egna anteckningar får tas bort (felskrivningar). Kollegors rörs inte.
create policy "Notes: admin raderar egna" on public.case_notes
  for delete using (
    author_id = auth.uid()
    and exists (select 1 from public.admins a where a.id = auth.uid())
  );

-- Medvetet INGEN update-policy: en anteckning står kvar som den skrevs.
