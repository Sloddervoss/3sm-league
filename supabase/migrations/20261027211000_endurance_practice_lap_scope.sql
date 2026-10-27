-- 2026-10-27: praktijkrondes alleen voor het eigen team (of beheer).
--
-- Aanleiding. De policy "endurance participant practice laps select" op
-- endurance_practice_laps keek naar `endurance_is_participant(event_id, ...)`:
-- iedereen die zich voor het event inschreef, las de rondetijden van iedereen.
-- Daarmee was de kwalificatiepace van een concurrent — en de banden- en
-- brandstofmonsters per ronde die eraan hangen — een publiek feit binnen het
-- event. Rondetijden zijn strategie, geen deelnemerslijst.
--
-- Wat deze migratie doet:
--   * endurance_practice_lap_visible(event, sessie, coureur) — één predicaat
--     dat zegt of de aanvrager deze ronde mag lezen: eigen ronde, beheer
--     (super_admin/endurance_manager of event-manager) of een teamgenoot in
--     hetzelfde event. Ook een sessie die aan mijn team hangt telt als eigen
--     team, want de sessierij weet welk team er reed en de laprij niet.
--   * De policy gebruikt dat predicaat. De bestaande beheer-policies
--     ("endurance practice laps super admin all" en "endurance event manager
--     laps") blijven staan: dit versmalt de deelnemerspolicy, het vervangt geen
--     beheer.
--
-- Wat deze migratie NIET doet: de tabellen, de ingest en de sessies blijven
-- ongewijzigd. `endurance_practice_sessions` blijft zichtbaar per event (dat is
-- een label en een tijdvak, geen pace). Geen data wordt aangeraakt.
--
-- Additief: een nieuwe functie en één policy die vervangen wordt. Rollback:
-- 20261027211000_endurance_practice_lap_scope.rollback.sql

-- ---------------------------------------------------------------------------
-- 1. Het predicaat
-- ---------------------------------------------------------------------------

create or replace function public.endurance_practice_lap_visible(
  p_event_id uuid,
  p_session_id uuid,
  p_lap_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $function$
  select auth.uid() is not null
     and (
       -- Je eigen ronde, altijd.
       p_lap_user_id = auth.uid()
       -- Beheer: super_admin of endurance_manager.
       or public.is_endurance_manager(auth.uid())
       -- Of de manager van dit event.
       or public.endurance_can_manage_roster(p_event_id)
       -- Een sessie van mijn team: de laprij heeft geen team_id, de sessie wel.
       or exists (
            select 1
              from public.endurance_practice_sessions ps
              join public.endurance_teams t on t.id = ps.team_id
              join public.endurance_team_members m on m.team_id = t.id
             where ps.id = p_session_id
               and t.event_id = p_event_id
               and m.user_id = auth.uid()
          )
       -- Of een teamgenoot in hetzelfde event: dezelfde teamrij, hetzelfde event.
       or exists (
            select 1
              from public.endurance_team_members mine
              join public.endurance_team_members theirs on theirs.team_id = mine.team_id
              join public.endurance_teams t on t.id = mine.team_id
             where mine.user_id = auth.uid()
               and theirs.user_id = p_lap_user_id
               and t.event_id = p_event_id
          )
     );
$function$;

comment on function public.endurance_practice_lap_visible(uuid, uuid, uuid) is
  'Mag de aanvrager deze praktijkronde lezen? Eigen ronde, beheer, of een teamgenoot in hetzelfde event. Deelnemer-zijn van het event is niet genoeg.';

revoke all on function public.endurance_practice_lap_visible(uuid, uuid, uuid) from public, anon;
grant execute on function public.endurance_practice_lap_visible(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. De policy
-- ---------------------------------------------------------------------------

drop policy if exists "endurance participant practice laps select" on public.endurance_practice_laps;
drop policy if exists "endurance team practice laps select" on public.endurance_practice_laps;

create policy "endurance team practice laps select" on public.endurance_practice_laps
  for select to authenticated
  using (public.endurance_practice_lap_visible(event_id, session_id, user_id));
