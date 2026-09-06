# Generic SimHub layout label

Observed telemetry supplied `trackName=barcelona gp` and
`trackConfig=Full Course`. The complete SDK identity maps to official track 345
(Barcelona Grand Prix), but the extra generic configuration prevented loading.

Permit the exact `Full Course` label only with a complete, unique SDK identity
and only when that SDK circuit has no actual catalog layout named Full Course.
Do not use it to guess a circuit layout. Other conflicting configurations remain
rejected. Preserve ambiguity checks and all original SVG geometry.

The regression test covers the observed pair, a National conflict, an incomplete
circuit identity, and a circuit with a real Full Course layout. A native Chrome
check loads track 345 with 1024 points and an official direction using the exact
observed pair.

Impact: frontend lookup only. No backend, bot, database, authentication, plugin
or runtime configuration changes. Publish the normal frontend build; keep
downloads and unrelated runtime files intact.
