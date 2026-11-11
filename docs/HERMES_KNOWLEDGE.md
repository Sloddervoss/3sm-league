# Hermes — repositorykennis

## Zelflerende pitwall — P1 fasegrens

Handoff en open poorten: `docs/operations/pitwall-learning-p1-local-handoff.md`.
Contract: `docs/contracts/pitwall-learning-contribution-v1.md`; bron-/privacybeleid:
`docs/contracts/pitwall-learning-policy-v1.md` en `docs/contracts/pitwall-learning-source-map.md`.
P1 is lokaal functioneel gebouwd en gereviewd, maar heeft **geen volledige acceptatie**:
de performancepoort is INCONCLUSIVE. Geen productieactivatie, daemon, pooling of P2-GO.
De bridge bewaart een immutable per-owner batch in de ingesttransactie; een begrensde
lease-API materialiseert daarna revisies/jobs. Owner-at-receipt is geen historisch bewijs;
actuele policychecks blijven nodig. Geen nieuwe browserquery of modeladvies aangesloten.
Rollback bewaart bewijs; de private testcontainer is na backup verwijderd.

## PACE (lokale implementatie op feat/pitwall-look-3sm)

Contract/architectuur en uitrolgrenzen: `docs/contracts/pace-capture-v1.md`.
Live read-only bewijs: `docs/pitwall-look/pace-bewijs.md`.
Lokale verificatie en bekende releasegates: `docs/pitwall-look/pace-oplevering.md`.
Geen productie-GO impliceren uit deze implementatie. Acht persistargumenten en adviesisolatie behouden.
