# Project Editor summary

"Project Editor" = de 3SM nieuwsredactie / Tiptap editor.

## Locatie
- Repo: `/home/hermes/projects/3sm-league`
- Hoofdpagina: `src/pages/NewsEditorPage.tsx`
- Editor CSS: `src/index.css` (`.news-editor-prose`, `.editor-toolbar-*`, `.news-image-figure`, `.resizable-image-node`)
- Tests: `src/test/newsEditorWorkflow.test.ts`, `src/test/editorRoleWorkflow.test.ts`
- Auth/routing/nav: `src/contexts/AuthContext.tsx`, `src/components/Navbar.tsx`
- DB/storage: Supabase `news_posts`, Storage bucket `news-images`

## Huidige editor features
- Onafhankelijke editorrol plus admin/super_admin toegang.
- Refresh op `/news-editor` wacht op `rolesLoading` en blijft op nieuwsredactie.
- Titelveld is single source of truth; preview toont titel als H1-placeholder zonder die placeholder op te slaan.
- Tiptap toolbar met groepen: Tekst, Lijsten, Media, Layout, Stijl.
- Tekstselectie styling gebruikt Tiptap marks: `setFontSize`, `setColor`, active states.
- Afbeeldingen zijn custom Tiptap image nodes met attrs: `src`, `alt`, `title`, `width`, `align`, `caption`.
- Image toolbar: links/midden/rechts, ⅓/½/Vol width presets, Alt, Caption, verwijderen.
- Afbeeldingen renderen als `figure.news-image-figure` / `figure.resizable-image-node` met wrapper width; img is `width: 100%`.
- Meerdere afbeeldingen op één regel: CSS zet image figures op `display: inline-block; vertical-align: top;`; gebruik ⅓ preset voor drie naast elkaar.
- Resize handles blijven width op wrapper opslaan, zodat saved HTML/editor content responsive blijft.

## Deploy workflow
- Lokale quality gates voor Project Editor wijzigingen: `npm run lint && npm test -- --run && npm run build && npm audit`.
- Push main vanuit `/home/hermes/projects/3sm-league`.
- Productie deploy: `ssh 3sm-web 'cd /opt/3sm && bash deploy.sh'`.
- Live checks: `/news-editor` 200, `/` 200, hashed CSS/JS bevat verwachte markers.

## Gebruikersafspraak
Vincent gaf aan dat bij toekomstige "Project Editor" aanpassingen volledige toegang geldt om door te pakken, committen, pushen en deployen. Blijf wel voorzichtig met risicovolle DB-migraties, secrets of destructieve acties.
