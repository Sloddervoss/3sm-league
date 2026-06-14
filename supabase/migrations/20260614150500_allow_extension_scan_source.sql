alter table public.member_track_history
  drop constraint if exists member_track_history_source_check;

alter table public.member_track_history
  add constraint member_track_history_source_check
  check (source in ('iracing_recent_races', 'site_result_json', 'extension_scan'));
