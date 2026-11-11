# Hermes — repositorykennis

## Zelflerende pitwall — P1 fasegrens

Handoff en open poorten: `docs/operations/pitwall-learning-p1-local-handoff.md`.
Contract: `docs/contracts/pitwall-learning-contribution-v1.md`; bron-/privacybeleid:
`docs/contracts/pitwall-learning-policy-v1.md` en `docs/contracts/pitwall-learning-source-map.md`.
P1 heeft lokale bouwacceptatie: functionele reviews en codekwaliteit APPROVED;
de onafhankelijk nagerekende 200-ronde proef voldoet aan de afgesproken p95-puntregel.
De marge is zeer klein; dit is geen robuuste productiegarantie. Geen productieactivatie,
daemon, pooling of P2-GO. Gecontroleerde meet-/reviewdocumentatie:
`docs/operations/pitwall-learning-p1-controlled-perf.md`. De oorspronkelijke meetdata
blijven bevroren; gecorrigeerde volgordemetadata staat als apart erratum bij het bewijs.
De bridge bewaart een immutable per-owner batch in de ingesttransactie; een begrensde
lease-API materialiseert daarna revisies/jobs. Owner-at-receipt is geen historisch bewijs;
actuele policychecks blijven nodig. Geen nieuwe browserquery of modeladvies aangesloten.
Rollback bewaart bewijs; de private testcontainer is na backup verwijderd.

## PACE (lokale implementatie op feat/pitwall-look-3sm)

Contract/architectuur en uitrolgrenzen: `docs/contracts/pace-capture-v1.md`.
Live read-only bewijs: `docs/pitwall-look/pace-bewijs.md`.
Lokale verificatie en bekende releasegates: `docs/pitwall-look/pace-oplevering.md`.
Geen productie-GO impliceren uit deze implementatie. Acht persistargumenten en adviesisolatie behouden.
