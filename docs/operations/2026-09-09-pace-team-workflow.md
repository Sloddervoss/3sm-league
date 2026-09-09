# Flexible teams based on practice pace

One race supports teams with different target sizes and competitive, fun or mixed approaches. The event maximum stays the upper limit; it is never raised automatically.

Drivers specify their approach, preferred team size and optional maximum driving hours. Extra stint and rest settings are collapsed by default.

Managers review and adjust proposals before saving. Only unassigned active participants with at least 10 comparable laps are assigned automatically. Practice takes precedence over manual entries; the latest qualified run is used. Drivers are grouped by nearby pace and preferences, with balanced group sizes. Small exchanges of similarly paced drivers can improve availability coverage. Unknown pace remains visible for manual assignment.

Team cards show occupancy, pace spread and planning checks. A trial schedule uses 90-minute tanks. Failure to find that schedule is reported as a request to review the inputs, rather than proof that no schedule can exist. Saving teams does not publish stints.

Team moves are atomic, reject stale proposals and enforce capacity and one membership per event. Team, availability and driving-limit changes flag plans for review. Publication checks current membership, availability, race coverage, stint count, driving time and rest limits. Earlier versions remain available.

Practice sessions record their car, track, layout and conditions. Importing pace excludes mismatched laps and repeated imports do not duplicate a session's results. Historical sessions without a recorded context require a new practice session; manual and CSV pace entry remain available.

Validation includes unit and interface tests, transactional database checks, and visual inspection at mobile and desktop widths. The scenarios include 18 participants, mixed team sizes, unknown pace, insufficient availability, stale proposals, save failures and changes after publication.
