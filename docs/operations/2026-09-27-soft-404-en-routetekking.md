# Soft-404, routetekking en echte 404 (nginx + SEO-generator)

Datum: 2026-09-27

## Het probleem

De nginx-config had één alles-slikkende SPA-fallback:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Elk niet-bestaand pad kreeg daardoor **HTTP 200 met de homepage-shell**, inclusief
de canonical naar `https://3stripemotorsport.cc/`. Google ziet dat als een
duplicaat van de homepage, en in Search Console kwam (`/.env`, `/.git/config`,
`/admin/`, `/sitemap_index.xml`, `/news/race-recaps/`) als crawl-anomalie of 403
terug. Dit was het enige echte technische defect in de SEO-audit van september 2026.

Daarnaast gaf `/news/<categorie>/` een **403**: de map bestond wel, maar er was
geen `index.html` gegenereerd.

## De oplossing, in twee fasen

### Fase 1 — dekking eerst

Zonder dekking mag je nooit naar `=404` schakelen: een geldige app-route zonder
geprerenderd bestand zou dan omvallen.

1. **Nieuwe artefacten** in `dist/` (via `scripts/generate-route-html.mjs`):
   - `404.html` — echte 404-pagina, `noindex, follow`, **geen** canonical.
   - `app-shell-fallback.html` — dezelfde shell, maar ook `noindex, follow` en
     zonder canonical. Dit is de terugvaloptie voor geldige app-routes die (nog)
     geen eigen HTML hebben, zoals `/news/author/<naam>` of een verse race-uitslag.
   - Nieuws-**categoriehubs** (`/news/<categorie>/`) worden nu als echte,
     indexeerbare pagina geprerenderd met de artikelen uit die categorie. Dat lost
     de 403 op en levert een bruikbare hub op.
2. **Sitemap-vangnet**: `generate-route-html.mjs` breekt de build af als de sitemap
   minder dan `MIN_SITEMAP_URLS` (10) URL's oplevert. Zo kan een half-geslaagde
   generatie nooit stil een kale sitemap online zetten.

### Fase 2 — de switch

`nginx.conf` routeert nu expliciet:

- **Bekende publieke app-routes** (`/`, `/calendar`, `/standings`, `/drivers`,
  `/teams`, `/results`, `/news`, `/seasons`, `/meedoen`, `/support`,
  `/homepage-prototype`) → `try_files $uri $uri/ /app-shell-fallback.html`.
- **`/endurance`** (`location ^~`) → shell + `X-Robots-Tag: noindex, nofollow`.
  De bèta blijft werken, maar komt niet in de index.
- **Utility-/beheerboom** (`/admin`, `/news-editor`, `/stewards`, `/koppel`,
  `/simhub-koppelen`, `/profile`, `/auth`) → shell + `X-Robots-Tag: noindex, nofollow`.
- **Al het overige** → `try_files $uri $uri/ =404` plus
  `error_page 404 /404.html` en `error_page 403 =404 /404.html`. Een map zonder
  index.html of een `deny` levert dus ook een nette 404 op in plaats van een 403
  die het bestaan van het pad verraadt.
- `/.route-html-manifest.json` → `deny all;` (dat bestand bevat de volledige
  routemap inclusief alle beheerpaden).

De trailing-slash-redirect (`rewrite ^/([^.]*[^/])$ /$1/ permanent;`) blijft in
elke location staan, zodat canonicals niet veranderen.

## Uitrolvolgorde (belangrijk)

De shell-bestanden moeten **eerst** in de webroot staan, daarna pas de config:

1. `deploy.sh` (bouwt en publiceert `dist/` inclusief `404.html` en
   `app-shell-fallback.html`).
2. `sudo cp nginx.conf /etc/nginx/sites-enabled/3sm.conf`
3. `sudo nginx -t`
4. `sudo systemctl reload nginx`

Draai je dit om, dan vallen deep links tijdelijk terug op een ontbrekend bestand.

## Verificatie

- `src/test/seoSoft404Coverage.test.ts` koppelt de nginx-routelijst aan de
  `<Route>`-lijst in `src/App.tsx`: een nieuwe publieke route zonder nginx-dekking
  laat de suite falen. De test borgt ook dat de alles-slikkende fallback niet
  terugkomt en dat `404.html`/de shell noindex zijn zonder homepage-canonical.
- End-to-end bewezen met een **tweede nginx-instantie** op 3sm-web
  (poort 8081, root = kopie van `dist/`), zodat de productie-nginx ongemoeid bleef:
  hubs 200 + self-canonical, `/news/race-recaps/` 200 (was 403), deep links
  200 + noindex, junkpaden 404 zonder canonical, `/.route-html-manifest.json` dicht.

## Valkuilen

- **`default_type` verliest van de extensie.** Voor `application/xml` op
  `/sitemap.xml` is `types { application/xml xml; }` nodig; `default_type` alleen
  laat `mime.types` winnen en levert `text/xml`.
- **Een bestaande map zonder `index.html` geeft 403**, ook met een
  `try_files …$uri/…`-fallback. Vandaar `error_page 403 =404`.
- **Neem de live config als basis, niet de repo.** De live config had een
  `.maintenance`-gate (503) die in de repo ontbrak; blind de repo-versie
  uitrollen haalt die gate stil weg. Vergelijk altijd eerst
  `diff <(ssh 3sm-web 'cat /etc/nginx/sites-enabled/3sm.conf') nginx.conf`.
- **`public/sitemap.xml` was een verouderde stub** (9 URL's) die de echte sitemap
  in de webroot kon overschrijven. Verwijderd; de sitemap komt nu uitsluitend uit
  de generator.
