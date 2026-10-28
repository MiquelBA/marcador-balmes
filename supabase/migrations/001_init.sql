-- Marcador Balmes: esquema inicial
create extension if not exists pgcrypto with schema extensions;

-- EQUIPS (preparat perquè hi hagi més d'un equip de l'escola)
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  category text not null default '',
  created_at timestamptz not null default now()
);

-- PIN de cada equip, en una taula sense accés públic
create table public.team_secrets (
  team_id uuid primary key references public.teams(id) on delete cascade,
  pin_hash text not null
);

-- PARTITS
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  opponent text not null,
  is_home boolean not null default true,
  location text not null default '',
  match_date date not null default current_date,
  num_periods int not null default 4 check (num_periods between 1 and 6),
  period_seconds int not null default 600 check (period_seconds between 30 and 3600),
  current_period int not null default 1,
  score_us int not null default 0 check (score_us >= 0),
  score_them int not null default 0 check (score_them >= 0),
  period_scores jsonb not null default '[]'::jsonb,   -- [{"us":n,"them":n}, ...]
  clock_running boolean not null default false,
  clock_remaining_ms int not null default 600000,
  clock_updated_at timestamptz not null default now(),
  status text not null default 'live' check (status in ('live','finished')),
  sound text,
  sound_seq int not null default 0,
  sound_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index matches_team_status_idx on public.matches(team_id, status, match_date desc);

alter table public.teams enable row level security;
alter table public.team_secrets enable row level security;
alter table public.matches enable row level security;

create policy "Equips visibles per tothom" on public.teams for select using (true);
create policy "Partits visibles per tothom" on public.matches for select using (true);
-- team_secrets: cap política => ningú hi accedeix des del client

alter publication supabase_realtime add table public.matches;

-- ---------- Funcions auxiliars ----------
create or replace function public._check_pin_team(p_team_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (
    select 1 from team_secrets s
    where s.team_id = p_team_id and s.pin_hash = crypt(p_pin, s.pin_hash)
  ) then
    raise exception 'PIN incorrecte' using errcode = '28000';
  end if;
end $$;

create or replace function public._check_pin_match(p_match_id uuid, p_pin text)
returns matches language plpgsql security definer set search_path = public, extensions as $$
declare m matches;
begin
  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'Partit no trobat'; end if;
  perform _check_pin_team(m.team_id, p_pin);
  return m;
end $$;

revoke all on function public._check_pin_team(uuid, text) from public, anon, authenticated;
revoke all on function public._check_pin_match(uuid, text) from public, anon, authenticated;

-- Hora del servidor (per sincronitzar rellotges)
create or replace function public.server_now() returns timestamptz
language sql stable as $$ select now() $$;

-- Comprovar PIN
create or replace function public.admin_login(p_team_slug text, p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare t uuid;
begin
  select id into t from teams where slug = p_team_slug;
  if t is null then return false; end if;
  perform pg_sleep(0.3); -- frena intents a cegues
  return exists (select 1 from team_secrets s where s.team_id = t and s.pin_hash = crypt(p_pin, s.pin_hash));
end $$;

-- Crear partit (tanca qualsevol altre partit en joc de l'equip)
create or replace function public.admin_create_match(
  p_team_slug text, p_pin text, p_opponent text, p_is_home boolean,
  p_location text, p_match_date date, p_num_periods int, p_period_seconds int)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare t uuid; new_id uuid; ps jsonb;
begin
  select id into t from teams where slug = p_team_slug;
  if t is null then raise exception 'Equip no trobat'; end if;
  perform _check_pin_team(t, p_pin);
  delete from matches where team_id = t and status = 'live' and score_us = 0 and score_them = 0;
  update matches set status = 'finished', clock_running = false, finished_at = now()
    where team_id = t and status = 'live';
  select coalesce(jsonb_agg(jsonb_build_object('us',0,'them',0)), '[]'::jsonb)
    into ps from generate_series(1, p_num_periods);
  insert into matches(team_id, opponent, is_home, location, match_date, num_periods,
                      period_seconds, clock_remaining_ms, period_scores)
  values (t, trim(p_opponent), p_is_home, coalesce(trim(p_location),''), p_match_date,
          p_num_periods, p_period_seconds, p_period_seconds * 1000, ps)
  returning id into new_id;
  return new_id;
end $$;

-- Editar dades del partit
create or replace function public.admin_update_match(
  p_match_id uuid, p_pin text, p_opponent text, p_is_home boolean,
  p_location text, p_match_date date, p_num_periods int, p_period_seconds int)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m matches; ps jsonb;
begin
  m := _check_pin_match(p_match_id, p_pin);
  ps := m.period_scores;
  while jsonb_array_length(ps) < p_num_periods loop
    ps := ps || jsonb_build_array(jsonb_build_object('us',0,'them',0));
  end loop;
  update matches set opponent = trim(p_opponent), is_home = p_is_home,
    location = coalesce(trim(p_location),''), match_date = p_match_date,
    num_periods = p_num_periods, period_seconds = p_period_seconds,
    current_period = least(current_period, p_num_periods),
    period_scores = ps,
    clock_remaining_ms = case when clock_running then clock_remaining_ms
                         when m.period_seconds <> p_period_seconds then p_period_seconds * 1000
                         else clock_remaining_ms end
  where id = p_match_id;
end $$;

-- Sumar/restar punts
create or replace function public.admin_score(p_match_id uuid, p_pin text, p_side text, p_delta int)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m matches; idx int; cur int; d int;
begin
  m := _check_pin_match(p_match_id, p_pin);
  if p_side not in ('us','them') or p_delta not between -3 and 3 then raise exception 'Valor no vàlid'; end if;
  idx := m.current_period - 1;
  cur := case when p_side = 'us' then m.score_us else m.score_them end;
  d := greatest(p_delta, -cur);  -- mai per sota de 0
  if d = 0 then return; end if;
  update matches set
    score_us = score_us + case when p_side='us' then d else 0 end,
    score_them = score_them + case when p_side='them' then d else 0 end,
    period_scores = jsonb_set(period_scores, array[idx::text, p_side],
       to_jsonb(greatest(0, coalesce((period_scores->idx->>p_side)::int,0) + d)), true)
  where id = p_match_id;
end $$;

-- Rellotge: start | pause | set (ms)
create or replace function public.admin_clock(p_match_id uuid, p_pin text, p_action text, p_ms int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m matches; remaining int;
begin
  m := _check_pin_match(p_match_id, p_pin);
  remaining := case when m.clock_running
    then greatest(0, m.clock_remaining_ms - (extract(epoch from (now() - m.clock_updated_at)) * 1000)::int)
    else m.clock_remaining_ms end;
  if p_action = 'start' then
    if remaining <= 0 then return; end if;
    update matches set clock_running = true, clock_remaining_ms = remaining, clock_updated_at = now() where id = p_match_id;
  elsif p_action = 'pause' then
    update matches set clock_running = false, clock_remaining_ms = remaining, clock_updated_at = now() where id = p_match_id;
  elsif p_action = 'set' then
    update matches set clock_running = false, clock_remaining_ms = greatest(0, least(p_ms, 3600000)), clock_updated_at = now() where id = p_match_id;
  else
    raise exception 'Acció no vàlida';
  end if;
end $$;

-- Canviar de quart (reinicia el rellotge, aturat)
create or replace function public.admin_period(p_match_id uuid, p_pin text, p_period int)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m matches;
begin
  m := _check_pin_match(p_match_id, p_pin);
  if p_period < 1 or p_period > m.num_periods then raise exception 'Quart no vàlid'; end if;
  update matches set current_period = p_period, clock_running = false,
    clock_remaining_ms = period_seconds * 1000, clock_updated_at = now()
  where id = p_match_id;
end $$;

-- Sons (xiulet / botzina) per a tothom
create or replace function public.admin_sound(p_match_id uuid, p_pin text, p_sound text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_pin_match(p_match_id, p_pin);
  if p_sound not in ('whistle','horn') then raise exception 'So no vàlid'; end if;
  update matches set sound = p_sound, sound_seq = sound_seq + 1, sound_at = now() where id = p_match_id;
end $$;

-- Finalitzar / reobrir partit
create or replace function public.admin_finish(p_match_id uuid, p_pin text, p_finished boolean default true)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m matches; remaining int;
begin
  m := _check_pin_match(p_match_id, p_pin);
  remaining := case when m.clock_running
    then greatest(0, m.clock_remaining_ms - (extract(epoch from (now() - m.clock_updated_at)) * 1000)::int)
    else m.clock_remaining_ms end;
  if p_finished then
    update matches set status = 'finished', finished_at = now(), clock_running = false,
      clock_remaining_ms = remaining, clock_updated_at = now() where id = p_match_id;
  else
    update matches set status = 'finished', finished_at = now(), clock_running = false
      where team_id = m.team_id and status = 'live' and id <> p_match_id;
    update matches set status = 'live', finished_at = null where id = p_match_id;
  end if;
end $$;

-- Esborrar partit
create or replace function public.admin_delete_match(p_match_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_pin_match(p_match_id, p_pin);
  delete from matches where id = p_match_id;
end $$;

grant execute on function public.server_now() to anon, authenticated;
grant execute on function public.admin_login(text,text) to anon, authenticated;
grant execute on function public.admin_create_match(text,text,text,boolean,text,date,int,int) to anon, authenticated;
grant execute on function public.admin_update_match(uuid,text,text,boolean,text,date,int,int) to anon, authenticated;
grant execute on function public.admin_score(uuid,text,text,int) to anon, authenticated;
grant execute on function public.admin_clock(uuid,text,text,int) to anon, authenticated;
grant execute on function public.admin_period(uuid,text,int) to anon, authenticated;
grant execute on function public.admin_sound(uuid,text,text) to anon, authenticated;
grant execute on function public.admin_finish(uuid,text,boolean) to anon, authenticated;
grant execute on function public.admin_delete_match(uuid,text) to anon, authenticated;

alter function public.server_now() set search_path = public;
