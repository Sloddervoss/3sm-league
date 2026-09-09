# Completed seasons

Migration `20260909210000_complete_finished_seasons.sql` synchronizes the stored league status when all of its races have status `completed`. Existing finished seasons are corrected, and subsequent race inserts, status changes, moves and deletions recheck affected seasons. Empty seasons and seasons containing unfinished races remain unchanged; dates alone never close a season.

This is a one-way completion transition. Reopening a season or adding a new calendar to an archived season remains an explicit manager action. The existing frontend renders `completed` as `Afgelopen`. API, bot and registration consumers receive the same corrected stored status. No frontend build, API signature, generated type, role or RLS change is required.

The trigger function cannot be called directly by public API roles. Regression SQL is in `supabase/tests/complete_finished_seasons.sql` and must run in a transaction that is rolled back.

Rollback: drop trigger `complete_finished_season` on `public.races`, then function `public.complete_finished_season_from_race()`. Restore only the affected league statuses from the pre-migration backup if the data correction must also be reverted.
