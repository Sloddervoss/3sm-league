# 3 Stripe iRacing Content Extension

Chrome/Edge extension om tracks vanaf je iRacing dashboard te scannen en automatisch te uploaden naar 3 Stripe Motorsport voor de **Track Intelligence** test.

## Wat het doet

1. **Navigeer** naar het iRacing dashboard via de extension
2. **Scan** automatisch de pagina voor tracks die je in je bezit hebt
3. **Upload** de gevonden tracks naar 3 Stripe voor kalenderplanning

Geen wachtwoord nodig — de extension leest alleen wat er op het scherm staat terwijl jij ingelogd bent.

## Installeren voor test

1. Open Chrome of Edge.
2. Ga naar `chrome://extensions` of `edge://extensions`.
3. Zet **Developer mode** aan.
4. Klik **Load unpacked**.
5. Kies deze map:

   ```
   tools/iracing-content-extension
   ```

## Gebruiken

1. **Zorg dat je ingelogd bent** op iRacing in je browser.
2. Klik op de extension `3 Stripe iRacing Content Scanner`.
3. Klik **Open iRacing dashboard** — de extension navigeert naar het dashboard en scant automatisch.
4. Of klik **Scan huidige pagina** als je al op een iRacing-pagina bent.
5. Klik **Upload naar 3 Stripe** om de tracks naar de database te sturen.
6. De data verschijnt op de adminpagina `/admin/track-intelligence-test`.

## Privacy

- De extension leest alleen de browserpagina die jij zelf open hebt.
- Er wordt geen wachtwoord gevraagd of opgeslagen.
- Alleen tracknamen en je iRacing Customer ID worden geüpload.
- Data wordt alleen gebruikt voor kalenderplanning binnen 3 Stripe Motorsport.

## Troubleshooting

- **"Geen tracks gevonden"** — klik **Kopieer debug info** en stuur die naar de developer.
- **Upload mislukt** — check of de 3 Stripe site online is.