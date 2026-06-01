export type MockNewsPost = {
  id: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  content_html: string;
  hero_image_url: string;
  hero_image_alt: string;
  seo_title: string;
  seo_description: string;
  author_id: string | null;
  authorName: string;
  authorAvatarUrl?: string | null;
  season_id?: string | null;
  seasonName?: string | null;
  view_count?: number;
  is_featured?: boolean;
  published_at: string;
  updated_at: string;
};

const body = (category: string, focus: string, image: string) => `
  <h2>${focus}</h2>
  <p>Dit is een lokaal voorbeeldartikel voor de categorie <strong>${category}</strong>. De tekst is bewust wat langer zodat je spacing, line-height en leesbaarheid in de publieke artikelweergave kunt beoordelen.</p>
  <p>We tonen hier hoe een bericht vanuit de Project Editor op de publieke nieuwspagina terechtkomt: categorie bovenaan, datum en auteur in de metadata, een hero-afbeelding en daarna de opgeslagen editor-content.</p>
  <figure class="news-image-block news-image-align-center news-image-size-half" data-width="50%" data-align="center">
    <img src="${image}" alt="Voorbeeldbeeld ${category}" />
    <figcaption>Voorbeeld van een halve afbeelding met caption.</figcaption>
  </figure>
  <blockquote>“Clean racing, duidelijke communicatie en een sterke community blijven de basis.”</blockquote>
  <table>
    <thead><tr><th>Moment</th><th>Wat zie je?</th></tr></thead>
    <tbody><tr><td>Voor de race</td><td>Briefing, context en verwachting.</td></tr><tr><td>Na de race</td><td>Resultaat, verhaal en vervolg.</td></tr></tbody>
  </table>
`;

const gt3Season = { season_id: "mock-gt3-season-2026", seasonName: "GT3 Sprint Cup 2026" };
const enduranceSeason = { season_id: "mock-endurance-season-2026", seasonName: "Endurance Series 2026" };

export const mockNewsPosts: MockNewsPost[] = [
  {
    id: "mock-raceverslagen",
    slug: "mock-raceverslag-zandvoort",
    title: "Raceverslag: strategische strijd op Zandvoort",
    category: "Raceverslagen",
    excerpt: "Een voorbeeld van een uitgebreid raceverslag met focus op strategie, incidenten en de beslissende momenten.",
    content_html: body("Raceverslagen", "De race in vogelvlucht", "/tracks/circuit-zandvoort.png"),
    hero_image_url: "/tracks/circuit-zandvoort.png",
    hero_image_alt: "Circuit Zandvoort als voorbeeldbeeld",
    seo_title: "Raceverslag: strategische strijd op Zandvoort - 3SM",
    seo_description: "Mock raceverslag voor lokale visuele review.",
    author_id: "mock-author",
    authorName: "3SM Redactie",
    ...gt3Season,
    view_count: 128,
    is_featured: true,
    published_at: "2026-06-01T12:00:00.000Z",
    updated_at: "2026-06-01T12:00:00.000Z",
  },
  {
    id: "mock-league-updates",
    slug: "mock-league-update-kalender",
    title: "League Update: kalender en briefing aangescherpt",
    category: "League Updates",
    excerpt: "Een voorbeeldupdate waarin kalenderinformatie, communicatie en praktische league-afspraken centraal staan.",
    content_html: body("League Updates", "Wat verandert er voor coureurs?", "/tracks/circuit-de-spa-francorchamps.png"),
    hero_image_url: "/tracks/circuit-de-spa-francorchamps.png",
    hero_image_alt: "Spa-Francorchamps als voorbeeldbeeld",
    seo_title: "League Update: kalender en briefing aangescherpt - 3SM",
    seo_description: "Mock league update voor lokale visuele review.",
    author_id: "mock-author",
    authorName: "Vincent van 3SM",
    ...gt3Season,
    view_count: 84,
    published_at: "2026-05-31T18:30:00.000Z",
    updated_at: "2026-05-31T18:30:00.000Z",
  },
  {
    id: "mock-race-recaps",
    slug: "mock-race-recap-sprint",
    title: "Race Recap: sprintavond met late inhaalactie",
    category: "Race Recaps",
    excerpt: "Compacte recap van een raceavond, bedoeld om te checken hoe kortere nieuwsitems in het grid vallen.",
    content_html: body("Race Recaps", "Kort maar krachtig", "/tracks/brands-hatch-circuit.png"),
    hero_image_url: "/tracks/brands-hatch-circuit.png",
    hero_image_alt: "Brands Hatch als voorbeeldbeeld",
    seo_title: "Race Recap: sprintavond met late inhaalactie - 3SM",
    seo_description: "Mock race recap voor lokale visuele review.",
    author_id: "mock-author",
    authorName: "Race Control",
    ...gt3Season,
    view_count: 96,
    published_at: "2026-05-30T20:00:00.000Z",
    updated_at: "2026-05-30T20:00:00.000Z",
  },
  {
    id: "mock-interviews",
    slug: "mock-interview-coureur",
    title: "Interview: van rookie naar vaste waarde op de grid",
    category: "Interviews",
    excerpt: "Een interviewvoorbeeld met menselijke insteek, quotes en ruimte voor langere intro’s.",
    content_html: body("Interviews", "Achter het stuur", "/tracks/photos/knockhill-racing-circuit.png"),
    hero_image_url: "/tracks/photos/knockhill-racing-circuit.png",
    hero_image_alt: "Knockhill als voorbeeldbeeld",
    seo_title: "Interview: van rookie naar vaste waarde op de grid - 3SM",
    seo_description: "Mock interview voor lokale visuele review.",
    author_id: "mock-author",
    authorName: "Paddock Crew",
    ...gt3Season,
    view_count: 54,
    published_at: "2026-05-29T17:15:00.000Z",
    updated_at: "2026-05-29T17:15:00.000Z",
  },
  {
    id: "mock-reviews",
    slug: "mock-review-bmw-gt3",
    title: "Review: GT3-balans na de laatste iRacing update",
    category: "Reviews",
    excerpt: "Een reviewvoorbeeld met analyse, vergelijkingen en een wat technischer onderwerp.",
    content_html: body("Reviews", "Eerste indrukken", "/tracks/circuit-de-barcelona-catalunya.png"),
    hero_image_url: "/tracks/circuit-de-barcelona-catalunya.png",
    hero_image_alt: "Barcelona als voorbeeldbeeld",
    seo_title: "Review: GT3-balans na de laatste iRacing update - 3SM",
    seo_description: "Mock review voor lokale visuele review.",
    author_id: "mock-author",
    authorName: "Tech Desk",
    ...gt3Season,
    view_count: 112,
    published_at: "2026-05-28T19:45:00.000Z",
    updated_at: "2026-05-28T19:45:00.000Z",
  },
  {
    id: "mock-community",
    slug: "mock-community-training",
    title: "Community: gezamenlijke trainingsavond trekt volle server",
    category: "Community",
    excerpt: "Een communitybericht waarin sfeer, Discord en deelname centraal staan.",
    content_html: body("Community", "Samen sneller worden", "/tracks/silverstone-circuit.png"),
    hero_image_url: "/tracks/silverstone-circuit.png",
    hero_image_alt: "Silverstone als voorbeeldbeeld",
    seo_title: "Community: gezamenlijke trainingsavond trekt volle server - 3SM",
    seo_description: "Mock communitybericht voor lokale visuele review.",
    author_id: "mock-author",
    authorName: "Community Team",
    ...enduranceSeason,
    view_count: 63,
    published_at: "2026-05-27T21:00:00.000Z",
    updated_at: "2026-05-27T21:00:00.000Z",
  },
  {
    id: "mock-iracing-nieuws",
    slug: "mock-iracing-update",
    title: "iRacing Nieuws: nieuwe build zet GT3-setup op scherp",
    category: "iRacing Nieuws",
    excerpt: "Een voorbeeld van extern iRacing-nieuws vertaald naar impact voor de 3SM-grid.",
    content_html: body("iRacing Nieuws", "Wat betekent dit voor 3SM?", "/tracks/n-rburgring-combined.png"),
    hero_image_url: "/tracks/n-rburgring-combined.png",
    hero_image_alt: "Nürburgring als voorbeeldbeeld",
    seo_title: "iRacing Nieuws: nieuwe build zet GT3-setup op scherp - 3SM",
    seo_description: "Mock iRacing nieuws voor lokale visuele review.",
    author_id: "mock-author",
    authorName: "iRacing Watch",
    ...enduranceSeason,
    view_count: 73,
    published_at: "2026-05-26T16:20:00.000Z",
    updated_at: "2026-05-26T16:20:00.000Z",
  },
  {
    id: "mock-special-events",
    slug: "mock-special-event-endurance",
    title: "Special Event: endurance-format krijgt testavond",
    category: "Special Events",
    excerpt: "Een special-eventbericht met nadruk op format, inschrijving en verwachtingen voor deelnemers.",
    content_html: body("Special Events", "Een ander ritme dan de reguliere races", "/tracks/circuit-zolder.png"),
    hero_image_url: "/tracks/circuit-zolder.png",
    hero_image_alt: "Circuit Zolder als voorbeeldbeeld",
    seo_title: "Special Event: endurance-format krijgt testavond - 3SM",
    seo_description: "Mock special event voor lokale visuele review.",
    author_id: "mock-author",
    authorName: "Event Crew",
    ...enduranceSeason,
    view_count: 49,
    published_at: "2026-05-25T13:00:00.000Z",
    updated_at: "2026-05-25T13:00:00.000Z",
  },
];

export const getMockNewsPost = (slug: string | undefined) => mockNewsPosts.find((post) => post.slug === slug) || null;
