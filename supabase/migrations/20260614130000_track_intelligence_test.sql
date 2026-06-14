create table if not exists public.track_intelligence_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  triggered_by_admin_id uuid references auth.users(id) on delete set null,
  trigger_type text not null default 'manual' check (trigger_type in ('manual')),
  members_total integer not null default 0,
  members_success integer not null default 0,
  members_failed integer not null default 0,
  created_records integer not null default 0,
  error_summary text
);

create table if not exists public.member_track_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(user_id) on delete cascade,
  iracing_customer_id text,
  iracing_name text,
  track_id text,
  track_name text not null,
  race_date timestamptz,
  subsession_id text,
  series_name text,
  source text not null check (source in ('iracing_recent_races', 'site_result_json')),
  dedupe_key text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_track_history_real_track check (length(btrim(track_name)) > 0)
);

create unique index if not exists member_track_history_dedupe_unique
  on public.member_track_history (member_id, source, dedupe_key);

create index if not exists member_track_history_track_seen_idx
  on public.member_track_history (track_name, last_seen_at desc);

create index if not exists member_track_history_member_seen_idx
  on public.member_track_history (member_id, last_seen_at desc);

alter table public.track_intelligence_runs enable row level security;
alter table public.member_track_history enable row level security;

drop policy if exists "Admins can read track intelligence runs" on public.track_intelligence_runs;
create policy "Admins can read track intelligence runs"
  on public.track_intelligence_runs for select
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists "Admins can manage track intelligence runs" on public.track_intelligence_runs;
create policy "Admins can manage track intelligence runs"
  on public.track_intelligence_runs for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists "Admins can read member track history" on public.member_track_history;
create policy "Admins can read member track history"
  on public.member_track_history for select
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists "Admins can manage member track history" on public.member_track_history;
create policy "Admins can manage member track history"
  on public.member_track_history for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
