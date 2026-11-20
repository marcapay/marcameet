begin;

create table public.access_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.access_team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid not null references public.access_teams(id) on delete cascade
);

create table public.protected_meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null,
  details jsonb not null,
  updated_at timestamptz not null default now(),
  unique (owner_id, source_id)
);

create table public.protected_meeting_access (
  meeting_id uuid primary key references public.protected_meetings(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'selected', 'team')),
  readers uuid[] not null default '{}',
  team_id uuid references public.access_teams(id) on delete set null
);

alter table public.access_teams enable row level security;
alter table public.access_team_members enable row level security;
alter table public.protected_meetings enable row level security;
alter table public.protected_meeting_access enable row level security;

revoke all on public.access_teams, public.access_team_members, public.protected_meetings,
  public.protected_meeting_access from public, anon, authenticated;
grant select on public.protected_meetings to authenticated;

create function public.can_read_protected_meeting(meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select from public.protected_meetings m
    left join public.protected_meeting_access a on a.meeting_id = m.id
    where m.id = meeting and auth.uid() is not null and (
      m.owner_id = auth.uid()
      or (a.visibility = 'selected' and auth.uid() = any(a.readers))
      or (a.visibility = 'team' and exists (
        select from public.access_team_members viewer
        join public.access_team_members owner on owner.team_id = viewer.team_id
        where viewer.team_id = a.team_id and viewer.user_id = auth.uid() and owner.user_id = m.owner_id
      ))
    )
  );
$$;
revoke all on function public.can_read_protected_meeting(uuid) from public, anon;
grant execute on function public.can_read_protected_meeting(uuid) to authenticated;

create policy protected_meeting_read on public.protected_meetings for select to authenticated
  using (public.can_read_protected_meeting(id));

create function public.get_protected_meeting_settings(source text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', (select id from public.protected_meetings where owner_id = auth.uid() and source_id = source),
    'visibility', coalesce((select a.visibility from public.protected_meeting_access a
      join public.protected_meetings m on m.id = a.meeting_id
      where m.owner_id = auth.uid() and m.source_id = source), 'private'),
    'emails', coalesce((select jsonb_agg(u.email order by u.email) from auth.users u
      join public.protected_meeting_access a on u.id = any(a.readers)
      join public.protected_meetings m on m.id = a.meeting_id
      where m.owner_id = auth.uid() and m.source_id = source), '[]'::jsonb),
    'team', (select t.name from public.access_teams t
      join public.access_team_members mem on mem.team_id = t.id where mem.user_id = auth.uid())
  );
$$;

create function public.save_protected_meeting(source text, payload jsonb, access_mode text, emails text[])
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target uuid;
  team uuid;
  reader_ids uuid[];
  requested integer;
begin
  if actor is null then raise exception 'Entre com e-mail verificado.'; end if;
  if source is null or length(source) not between 1 and 120 or payload is null
    or jsonb_typeof(payload) <> 'object' or payload #>> '{meeting,id}' is distinct from source
    or octet_length(payload::text) > 4000000 or access_mode is null
    or access_mode not in ('private', 'selected', 'team') then
    raise exception 'Reunião ou permissão inválida.';
  end if;

  if not exists (select from auth.users where id = actor and email_confirmed_at is not null
    and lower(email) = lower(trim(payload #>> '{meeting,user_email}'))) then
    raise exception 'Use a conta verificada do proprietário.';
  end if;

  if access_mode = 'selected' then
    select count(distinct lower(trim(email))) into requested from unnest(emails) as e(email);
    if requested not between 1 and 50 then raise exception 'Informe de 1 a 50 e-mails.'; end if;
    select array_agg(u.id) into reader_ids from auth.users u
    where u.email_confirmed_at is not null and lower(u.email) in (
      select distinct lower(trim(email)) from unnest(emails) as e(email)
    );
    if coalesce(cardinality(reader_ids), 0) <> requested then
      raise exception 'Todos os destinatários precisam ter confirmado o e-mail.';
    end if;
  elsif access_mode = 'team' then
    select team_id into team from public.access_team_members where user_id = actor;
    if team is null then raise exception 'A conta ainda não pertence a uma equipe.'; end if;
  end if;

  insert into public.protected_meetings(owner_id, source_id, details)
    values (actor, source, payload - 'support_materials')
    on conflict (owner_id, source_id) do update
    set details = excluded.details, updated_at = now()
    returning id into target;

  insert into public.protected_meeting_access(meeting_id, visibility, readers, team_id)
    values (target, access_mode, coalesce(reader_ids, '{}'::uuid[]), team)
    on conflict (meeting_id) do update
    set visibility = excluded.visibility, readers = excluded.readers, team_id = excluded.team_id;
  return target;
end;
$$;

create function public.delete_protected_meeting(source text)
returns void language sql security definer set search_path = ''
as $$
  delete from public.protected_meetings where owner_id = auth.uid() and source_id = source;
$$;

revoke all on function public.get_protected_meeting_settings(text), public.save_protected_meeting(text,jsonb,text,text[]),
  public.delete_protected_meeting(text) from public, anon;
grant execute on function public.get_protected_meeting_settings(text), public.save_protected_meeting(text,jsonb,text,text[]),
  public.delete_protected_meeting(text) to authenticated;

-- Quarantine legacy cloud records without deleting them or guessing ownership.
do $$
declare name text;
begin
  foreach name in array array[
    'marcameet_users', 'marcameet', 'meetings', 'meeting_files', 'transcripts',
    'transcript_segments', 'meeting_summaries', 'meeting_decisions', 'meeting_tasks',
    'meeting_highlights', 'meeting_risks', 'meeting_opportunities', 'meeting_pending_items',
    'meeting_values', 'meeting_dates', 'meeting_quotes', 'meeting_embeddings',
    'active_meetings', 'audio_chunks'
  ] loop
    if to_regclass(format('public.%I', name)) is not null then
      execute format('revoke all on public.%I from public, anon, authenticated', name);
    end if;
  end loop;
end $$;

commit;
