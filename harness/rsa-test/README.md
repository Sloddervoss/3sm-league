# 3SM 0.3.9.0 — RSA-ketentest (test-only harness, geen productie)

Test de ECHTE gebouwde connector-DLL via reflection op de private
`ValidateReleaseManifest`. Signatures worden met een TEST private key (niet
productie) gegenereerd. Bewijst:

- TEST-build (RSA_TEST_KEY define in 3SM.EnduranceConnector.TEST.csproj):
  A geldig test-signed -> accept
  B verkeerde sig   -> reject
  C/D/E geldige sig maar gewijzigde SHA/length/version -> reject
- RELEASE-build (productie key):
  F test-signed manifest -> reject (productie accepteert testkey NIET)
  B/C/D/E -> reject

Komponenten:
- ConnectorRsaTest.cs : reflection-host (dependency-resolve naar C:\Program Files (x86)\SimHub)
- gen_cases.py         : genereert cases.txt (signeert met test_rsa_private.pem)
- test_rsa_private.pem : WEGGOOI-test private key (enge muur/opzettelijk NIET productie)
- 3SM.EnduranceConnector.TEST.csproj : deze test-build zet de RSA_TEST_KEY define
