# Observation recovery — volledige Windows-build en lokale acceptatie

Bewijs afgerond 14 november 2026 (CET). Alleen lokale acceptatie en compile-only;
geen productieapply, installatie, releasepublicatie of activatie.

## Bevroren bron en onafhankelijke poorten

- Integratie: `b2e280717762badb5802bdb4203dc058217691f9` op
  `feat/pitwall-learning-p2`, basis `d096db96ec1032faa51b6e0e593192a28fbb5436`.
- Integratieboom exact gelijk aan kandidaat
  `8caef5ba4e30c46ff869660e41d9ce262c88a2a8`.
- Runtime `5a5237e96757785774c6d934fa1add1cdca48884`: onafhankelijke SPEC PASS,
  SPEC-1 gesloten. Het eerdere ontbreken van ruwe tellerwaarde bij een
  herstelmarkering kan niet meer naar verse generatie 1 worden gewassen.
- QUALITY beoordeelde de volledige recovery-delta tegenover d096 en vond geen
  runtimefout, één Important testgat Q-1. De aangeleverde exact uitgevoerde
  +16-regelige test is gecommit als8ca; alle2260 overige tracked entries gelijk
  aan5a. Gerichte onafhankelijke QUALITY op exacte8ca: APPROVED, Q-1 CLOSED.
- Originele afgekeurde bron/probes/rapporten blijven buiten Git bevroren bewaard.
  De pre-d096 load-side-poison-mutant12 is niet door deze reparatie opgelost of
  als gedekt aangemerkt; hij blijft buiten deze bounded delta uitgesteld.

## Parent-integratie — PASS

Uitgevoerd vanuit eigen artifactkopie van de exacte integratiecommit, niet vanuit
of naar een bevroren reviewwerkboom. Normale offline Release-build met cached SDK:

- build exit0;
- host **224 PASS /0 FAIL**;
- volledige C#-harnas **1167 PASS /0 FAIL**, inclusief60s soak;
- wiring **17 PASS /0 FAIL**;
- echte C#-serializerexport **52 bestanden**;
- Deno-interop zonder netwerk **50 PASS /0 FAIL**.

Alle zes stages exit0; de selecties overlappen en zijn niet optelbaar. Parent heeft
ook alle19 hashes en de vier echte commandexits van de gerichte QUALITY-hercontrole
zelf geverifieerd (normalbuild0/host0, mutantbuild0/host1). De mutant faalt uitsluitend
op `PAIR-lost-poison-successor-control`; pristine1 en gezonde1→2 controles blijven groen.

## Echte volledige Windows/net48/SimHub-compile — PASS

Geen subset, fake SDK of aangepaste projectkopie. Beest TCP22 was bereikbaar;
bestaande Build Tools2022, .NET4.8 targeting pack en echte geïnstalleerde SimHub-DLL's.
Restore naar een lege feed met bestaande cached packages; geen toolchaininstallatie.

- Bron:119 tracked bestanden uit `git archive b2e28071 tools/simhub-plugin`;
  elk bestand vóór compilatie op de pc tegen SHA-256-manifest vergeleken.
- Afzonderlijke unieke map:
  `C:\Users\vdevo\3sm\pitwall-recovery-b2e28071-compile-only`.
- Echt normaal pluginproject `/t:Rebuild`: exit0, **0 errors /1 warning**.
- Alle **48 Compile-items** uit het project zitten in de werkelijke compilerregel;
  `RSA_TEST_KEY` staat niet in defines (alleenTRACE).
- Bestaande warning `CS0169 EnduranceConnectorPlugin._pitLimiterSinceMs` ongebruikt.
- Werkelijke plugin-DLL **836096 bytes**, versie **0.7.6.2**.
- SHA-256:
  `3ccc0ad37288f8f2a542eee7f42131a4f5c6ded632f0aeaff1a10c3d46f4bec2`.
- `ObservationProducerHost` en `ObservationPairingGenerationRecoverable` aanwezig
  in de werkelijke assemblymetadata.
- Embedded updater exact gelijk aan de afzonderlijk in DEZELFDE build gebouwde
  updater, SHA-256
  `4248235910a547bae25c0873e4e514b952453195d7f2627ecd8ef4722c1467fc`.
  Geen claim dat nondeterministische updaterbinaries tussen builds gelijk zijn.
- Productie-public-key in oude geïnstalleerde en nieuwe echte DLL gelijk;
  testsleutel afwezig.
- Geïnstalleerde DLL vóór/na gelijk:
  `6461823490247bc447ec75d745abf2e69499de5eab369f9e480390d158e9a4af`.
- Desktop-DLL vóór/na gelijk:
  `64469371091384c7431e86c22f9782b4d3d7c66173edb59133fbe6f05591224d`.

Er is geen SimHub-procesactie, GUI-actie of geïnstalleerde DLL-wissel uitgevoerd.
De gewone buildhelper die ook zonder-Install naar Desktop kopieert is NIET gebruikt.
Dit artefact blijft compile-only met hetzelfde versienummer; het wordt niet als een
nieuwe update aangeboden.

## Ongewijzigd en nog OPEN

Updaterbron, plugin-/updaterversie, productiepublickey, manifestcontract, kanaal,
project en release-inventaris zijn gelijk aan de geaccepteerde d096-basis.
De enige recovery-runtimewijziging is ConnectorSettings; testbestanden en lokale
technische documentatie zijn daarnaast gewijzigd. Geen UI-/server-/SQL-wijziging.
ObservationEnabled=false en receiver-readiness=false blijven expliciet behouden.

Vóór vrijgave verplicht:

1. Werkelijke ondersteunde geïnstalleerde oude release → toekomstige strikt nieuwere
   bevroren release VIA HET BESTAANDE AUTOMATISCHE PAD: download, verificatie, stage,
   handshake, afsluiting, installatie, herstart, geladen nieuwe DLL en verse telemetrie.
   Bron-/key-/embeddingpariteit en een compile-only0.7.6.2 bewijzen dat niet. Geen nieuwe
   verplichte bootstrap, handmatige DLL-wissel of sleutel-/manifest-/kanaalwijziging
   als vervangend bewijs.
2. Echte WPF/SDK/DPAPI/settingsloader-/shutdownruntime. Harness-serializers zijn modellen,
   geen bewijs dat het vendor-runtimepad is uitgevoerd.
3. Identity-/accountpolicy, receiverstatus/handshake en activeringspoort. Geen server-
   numerieke pairingepoch toevoegen: de geaccepteerde fence is lokaal samengesteld.
4. De overige P2-leerroute, onafhankelijke voorspelscoring/modelkwalificatie en de
   uitsluitend `/admin/pitwall-test` presentatie. Nog geen actief zelflerend advies.

## Bewijs buiten Git

Onder `/home/hermes/artifacts/3sm/`:

- `pitwall-learning-p2-observation-generation-recovery-null-proof-spec/SPEC-RECHECK.md`;
- `pitwall-learning-p2-observation-generation-recovery-quality/QUALITY-REVIEW.md`;
- `pitwall-learning-p2-observation-generation-recovery-coverage-quality/QUALITY-RECHECK.md`;
- `pitwall-learning-p2-observation-generation-recovery-integration/`:
  `run-parent.py`, `PARENT-RESULTS.json`, `commands/*/{command.json,.exit,output.log}`;
- `pitwall-learning-p2-observation-generation-recovery-windows/`:
  `run-build.py`, `build-compile-only.ps1`, `audit-binary.py`, `TRANSFER-INPUTS.json`,
  `COMMAND-RESULTS.json`, `windows-BUILD-RESULTS.json`, `windows-INSTALLED-UNCHANGED.json`,
  `PARENT-COMPILER-AND-BINARY-CHECK.json`, werkelijke DLL/updater en UTF-16 compilerlog.

Productiefrontendwijzigingen: **NONE**. Productie-DDL/data/API/connector: **NONE**.
PRODUCTIEWIJZIGING: NEE.
