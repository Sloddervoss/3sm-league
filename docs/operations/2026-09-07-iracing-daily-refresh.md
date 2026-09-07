# Daily special-event refresh repair

The scheduler was running successfully, but five approved special-event catalog rows
still had an August 15 `last_seen_at`. Only explicitly configured season mappings
were processed, so preliminary events could never discover newly published schedules.

The importer now checks existing active catalog rows as well as explicit mappings.
For existing approved special events, the authenticated season list is matched by
exact event name and year, allowing only the explicit year/presented-by decorations.
Multiple matches raise a partial failure; unknown events remain excluded. Existing
local car mappings are retained, not guessed. Without a published season only calendar
metadata is refreshed; exact data and slots are not erased. Series bucket/slot identity
and manual 3SM activations are unchanged.

The official Suzuka season 6618 now publishes track 168 (Grand Prix), five session
starts from September 11 22:00 UTC through September 13 00:00 UTC, and 427 session
minutes in the time descriptor. The normalizer now reads that descriptor duration,
including for lap-limited events; it does not invent a race duration.

Partial runs return HTTP 502 instead of HTTP 200, making scheduler failures visible.
The existing daily timers do not need frequency changes.

Validation: targeted iRacing/catalog suite: 106 tests passed. No schema, auth, RLS,
frontend asset, bot or SimHub changes. Production rollout requires a backup of the
catalog/slots and the function directory, then deploying index.ts, normalize.ts and
discovery.ts together. Re-run the installed scheduler twice and check idempotency,
fresh timestamps, exact slots and preserved activation links. Roll back the function
files from the backup if verification fails; do not delete catalog/user selections.
