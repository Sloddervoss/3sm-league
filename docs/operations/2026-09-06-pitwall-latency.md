# Pitwall telemetry delivery and smooth positions

The device test page previously polled every two seconds, and the team Pitwall
every three seconds. Map markers jumped directly between sampled geometry points.

The staff-only device page now subscribes to the existing RLS-protected Realtime
publication, filtered by selected device. It updates only an already loaded
device detail cache. Older packets and slower RPC responses cannot replace newer
telemetry. Channel cleanup follows device/auth changes. RPC refresh is one second
when events are absent, five seconds for ancillary health/binding data while
Realtime events arrive. Channel failure immediately invalidates the detail query.
The page shows transport mode and age of the received telemetry.

Team Pitwall uses one-second polling. Its RPC grants team-member access whereas
the existing direct-table Realtime policy is staff-only; no RLS widening is made.
No plugin or database changes are required. Existing one-second plugin sampling
remains a source-resolution limit, and network latency is not eliminated.

Map markers interpolate along the course's polyline between received lap-distance
measurements. Updates use requestAnimationFrame directly on marker transforms,
not React renders of the whole dashboard every frame. Motion wraps start/finish,
never extrapolates, and stops at the newest received position. Large jumps, stale
gaps, pit transitions and reduced-motion preference snap instead of interpolating.
Track/session keys remount markers. Unmount cancels animation. A ten-second
freshness window replaces overly optimistic 30/90-second LIVE labels.

Impact: frontend delivery/animation only. No backend, schema, bot, plugin,
authentication or permission changes. Interpolation smooths display but adds
up to one sample interval of visual delay; it does not create high-frequency
measurements. Values such as tyre wear retain their actual sampling semantics.
