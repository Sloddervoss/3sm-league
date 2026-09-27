# Supabase auth-e-mailsjablonen

Deze map bevat de HTML-sjablonen voor de Supabase auth-e-mails (bevestiging,
recovery, magic link, e-mailwijziging, MFA-meldingen, enz.). Ze zijn hier
neergelegd als **bron/referentie**, niet als publiek bestand.

## Waarom ze niet meer in `public/` staan

Tot 27-09-2026 stonden ze in `public/auth-templates/`, waardoor elk sjabloon
openbaar op te vragen was (`https://3stripemotorsport.cc/auth-templates/confirmation.html`).
Dat is geen lek van geheimen — het zijn e-mailsjablonen — maar het is onnodige
informatieoverdracht, en het masterplan noteerde het als exposure-punt (C3).

Verplaatsen naar `docs/` haalt ze uit de build. Supabase haalt deze bestanden
niet op: de sjablonen worden in het Supabase-dashboard geconfigureerd en staan
daar als tekst. Niets in de repo verwees naar de bestandspaden.

## Let op: de logo's blijven wél publiek

`public/auth-templates/3sm-logo-email-v2.png` (en de oudere variant) **moet**
publiek blijven, want de sjablonen verwijzen er met een absolute URL naar:

```html
<img src="https://3stripemotorsport.cc/auth-templates/3sm-logo-email-v2.png" ...>
```

Verwijder die PNG's niet, anders breken de logo's in alle auth-e-mails. De map
`public/auth-templates/` bestaat daarom nog, maar bevat alleen nog de logo's.

## Een sjabloon aanpassen

1. Pas het HTML-bestand hier aan.
2. Kopieer de inhoud naar het Supabase-dashboard (Authentication → Email Templates).
3. Wijzig je de logo-URL of het bestandspad? Werk dan ook de absolute URL in de
   sjablonen bij, en houd de bestandsnaam gelijk.
