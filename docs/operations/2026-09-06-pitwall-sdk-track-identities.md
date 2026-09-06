# Pitwall SDK track identities

The earlier geometry audit exercised official display names, not the technical
track names sent by SimHub. For example, `watkinsglen\2021\fullcourse` is track
434, officially named Watkins Glen International - Boot. It was not recognized.

The layered manifest now retains `track_dirpath` and `config_name_short` from
the pinned racing-track-maps-vector metadata snapshot
`b182cb7faeda236cce740530e52f3774364f3c0b` as `trackDirpath` and
`configNameShort`. All 424 entries have both fields. The generator preserves
these fields on subsequent rebuilds.

Pitwall accepts complete technical identities with spaces, slash, backslash,
underscore or hyphen separators, and split circuit/configuration fields.
Explicit conflicting configurations and ambiguous identities remain rejected.
It does not strip years or infer a default layout from a circuit prefix.

Regression tests cover all 424 identities and Watkins Glen specifically. The
native-browser geometry audit now uses SDK names so it exercises the telemetry
lookup rather than only the catalog's display names. Geometry coverage remains
418 layouts, with the six previously deferred oval/dirt layouts unchanged.

Impact: frontend lookup and shipped catalog only. No backend, bot, database,
authentication, plugin or download changes. Deployment requires matching
frontend assets and catalog; existing safe website deployment applies.
