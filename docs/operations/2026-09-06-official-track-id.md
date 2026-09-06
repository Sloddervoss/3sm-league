# Official iRacing TrackID through the telemetry chain

Plugin 0.4.2.1 reads the current snapshot's
`RawData.SessionData.WeekendInfo.TrackID`, verified against the installed
iRacingSDK assembly. It accepts positive Int32-range integer values, returns
null for missing/invalid data, and does not cache a previous circuit ID.

V3 identity optionally carries `trackId`; missing IDs are omitted by the plugin.
The receiver validates the optional field and retains it in normalized JSON.
Old V3 payloads remain accepted. No schema migration is required.

Pitwall selects the catalog layout by ID before looking at names. A supplied
unknown/invalid ID fails closed, including the static-map fallback. Display
labels are not an alternative authority. Older plugins without an ID retain
the existing SDK-name and display-name resolver.

Tests cover all 424 catalog IDs, invalid/unknown IDs, optional wire compatibility,
SDK runtime types, changing circuits, and missing data. The native-browser audit
now loads the whole catalog by ID with deliberately unrelated display names.
Geometry coverage itself is unchanged: 418 projections and the same six deferred
oval/dirt exceptions. This does not add GPS-calibrated placement or new maps.

Deployment order: receiver compatibility first, website second, signed canary
plugin last. Stable plugin channel stays unchanged. Use the existing production
signing key, immutable versioned DLL/ZIP, and manifest-last release workflow.
Back up receiver/web/config before publication. Check old-plugin ingest after
receiver rollout and actual `identity.trackId` after the user installs 0.4.2.1.

Impact: frontend, optional API field and plugin release. No bot, schema, RLS,
authentication or device-binding changes. Tyre units are outside this change.
