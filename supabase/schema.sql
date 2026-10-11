-- TrenchMap database. Paste this whole file into Supabase -> SQL Editor -> New query -> Run.
-- Safe to run once on a fresh project.

-- ---------- Tables ----------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique
    default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  color text not null,
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.pins (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id),
  type text not null,
  title text not null default '',
  note text not null default '',
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

create table public.tracks (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id),
  name text not null,
  points jsonb not null,
  distance_m double precision not null default 0,
  started_at timestamptz not null,
  ended_at timestamptz not null
);

create index pins_project_idx on public.pins (project_id);
create index tracks_project_idx on public.tracks (project_id);

-- ---------- Helper: is the signed-in user in this project? ----------

create or replace function public.is_member(pid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = pid and user_id = auth.uid()
  );
$$;

-- ---------- Row-level security: only project members can see or add data ----------

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.pins enable row level security;
alter table public.tracks enable row level security;

create policy "members read projects" on public.projects
  for select using (public.is_member(id));

create policy "members read members" on public.project_members
  for select using (public.is_member(project_id));

create policy "members read pins" on public.pins
  for select using (public.is_member(project_id));
create policy "members add own pins" on public.pins
  for insert with check (public.is_member(project_id) and user_id = auth.uid());
create policy "edit own pins" on public.pins
  for update using (user_id = auth.uid())
  with check (public.is_member(project_id) and user_id = auth.uid());
create policy "delete own pins" on public.pins
  for delete using (user_id = auth.uid());

create policy "members read tracks" on public.tracks
  for select using (public.is_member(project_id));
create policy "members add own tracks" on public.tracks
  for insert with check (public.is_member(project_id) and user_id = auth.uid());
create policy "edit own tracks" on public.tracks
  for update using (user_id = auth.uid())
  with check (public.is_member(project_id) and user_id = auth.uid());
create policy "delete own tracks" on public.tracks
  for delete using (user_id = auth.uid());

-- ---------- Creating and joining projects (the app calls these) ----------

create or replace function public.create_project(p_name text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  proj public.projects;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into public.projects (name) values (p_name) returning * into proj;

  insert into public.project_members (project_id, user_id, display_name, color)
  values (proj.id, auth.uid(), coalesce(nullif(p_display_name, ''), 'Me'), '#e11d48');

  return json_build_object('id', proj.id, 'name', proj.name, 'invite_code', proj.invite_code);
end;
$$;

create or replace function public.join_project(p_code text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  proj public.projects;
  n int;
  palette text[] := array[
    '#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed',
    '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'
  ];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into proj from public.projects where invite_code = lower(trim(p_code));
  if not found then
    raise exception 'No project found with that invite code';
  end if;

  select count(*) into n from public.project_members where project_id = proj.id;

  insert into public.project_members (project_id, user_id, display_name, color)
  values (
    proj.id, auth.uid(),
    coalesce(nullif(p_display_name, ''), 'Me'),
    palette[(n % array_length(palette, 1)) + 1]
  )
  on conflict (project_id, user_id) do nothing;

  return json_build_object('id', proj.id, 'name', proj.name, 'invite_code', proj.invite_code);
end;
$$;

revoke execute on function public.create_project(text, text) from public, anon;
revoke execute on function public.join_project(text, text) from public, anon;
grant execute on function public.create_project(text, text) to authenticated;
grant execute on function public.join_project(text, text) to authenticated;

-- ---------- Live updates ----------

alter publication supabase_realtime add table public.pins, public.tracks, public.project_members;
