-- ================================================================
-- HELT ANONYM ANMÄLARE SKA SE SINA BILAGOR NÄR DEN FÖLJER ÄRENDET
--
-- get_case_by_code() returnerade meddelanden men inte bilagor, så en
-- typ 1-anmälare kunde inte se om filerna faktiskt kom fram.
--
-- Bara namn, storlek och tidpunkt returneras — inte file_path. Filerna
-- går alltså inte att öppna igen härifrån, och det är avsiktligt:
-- en nedladdningslänk hade krävt en ny läsväg in i Storage-bucketen,
-- och anmälaren har ändå redan filen på sin egen dator. Det de behöver
-- är bekräftelsen att bilagan finns i ärendet.
--
-- Funktionen är SECURITY DEFINER och läser därför attachments förbi
-- RLS, precis som den redan gör med messages.
-- ================================================================

-- Returtypen ändras, och den går inte att ändra med create or replace.
drop function if exists public.get_case_by_code(text);

create function public.get_case_by_code(p_code text)
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
      -- file_path utelämnas medvetet — se kommentaren överst.
      (select coalesce(jsonb_agg(jsonb_build_object(
                'file_name', a.file_name, 'file_size', a.file_size, 'created_at', a.created_at
              ) order by a.created_at), '[]'::jsonb)
       from public.attachments a where a.case_id = v_case.id);
end;
$$;

grant execute on function public.get_case_by_code to anon, authenticated;
