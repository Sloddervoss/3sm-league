export type JoinLocale = "nl" | "en";

export type JoinFaqItem = { question: string; answer: string };

export type JoinCopy = {
  meta: { title: string; description: string; ogTitle: string; ogDescription: string };
  hero: { eyebrow: string; title: string; accent: string; lead: string; explore: string; calendar: string; slogan: string };
  trust: Array<{ title: string; detail: string }>;
  live: {
    eyebrow: string;
    title: string;
    lead: string;
    next: string;
    latest: string;
    registrations: string;
    completed: string;
    circuits: string;
    calendar: string;
    results: string;
    noUpcoming: string;
    noUpcomingDetail: string;
    noResult: string;
    noResultDetail: string;
    unavailableTitle: string;
    unavailable: string;
    hiddenRegistrationNote: string;
  };
  why: {
    eyebrow: string;
    title: string;
    lead: string;
    items: Array<{ title: string; text: string }>;
  };
  participation: {
    eyebrow: string;
    title: string;
    lead: string;
    solo: { tag: string; title: string; text: string };
    team: { tag: string; title: string; text: string };
  };
  steps: {
    eyebrow: string;
    title: string;
    lead: string;
    items: Array<{ number: string; title: string; text: string }>;
  };
  formats: {
    eyebrow: string;
    title: string;
    lead: string;
    now: string;
    interest: string;
    development: string;
    items: Array<{ status: "now" | "interest" | "development"; title: string; text: string }>;
  };
  faq: { eyebrow: string; title: string; items: JoinFaqItem[] };
  closing: { eyebrow: string; title: string; lead: string; discord: string; calendar: string; note: string };
};

const nl: JoinCopy = {
  meta: {
    title: "Meedoen met 3SM – Nederlandse iRacing League",
    description: "Zoek je een iRacing community in Nederland? Doe mee met 3 Stripe Motorsport: een Nederlandse iRacing league met Discord, kalender, standings en uitslagen.",
    ogTitle: "Meedoen met de 3SM iRacing community",
    ogDescription: "Georganiseerde iRacing races voor beginners, ervaren coureurs, solo racers en eigen teams.",
  },
  hero: {
    eyebrow: "Nederlandse iRacing community",
    title: "Een iRacing community",
    accent: "voor competitie en plezier.",
    lead: "3 Stripe Motorsport is een Nederlandse iRacing league en community, ontstaan in Nederland en open voor coureurs met dezelfde race-mentaliteit. Deelname is gratis en beginners en ervaren coureurs zijn welkom.",
    explore: "Zo werkt meedoen",
    calendar: "Naar de racekalender",
    slogan: "Hard racen. Slim racen. Respectvol racen.",
  },
  trust: [
    { title: "Gratis deelname", detail: "Geen deelnamekosten" },
    { title: "Geen minimum iRating of SR", detail: "Open voor ieder niveau" },
    { title: "Beginners welkom", detail: "Ervaring is niet vereist" },
    { title: "Solo of eigen team", detail: "Kies je eigen deelnamevorm" },
    { title: "Rijd wanneer het uitkomt", detail: "Niet iedere race is verplicht" },
  ],
  live: {
    eyebrow: "Echte races, echte data",
    title: "Recente raceactiviteit.",
    lead: "De laatste race, het podium en de historische statistieken laten zien dat hier daadwerkelijk wordt geracet.",
    next: "Eerstvolgende race",
    latest: "Laatste race",
    registrations: "inschrijvingen via race of seizoen",
    completed: "afgeronde races",
    circuits: "verschillende circuits",
    calendar: "Bekijk race en inschrijving",
    results: "Volledige uitslag",
    noUpcoming: "Nieuwe raceplanning volgt",
    noUpcomingDetail: "De kalender blijft de vaste plek voor nieuwe races en inschrijvingen.",
    noResult: "Nog geen recente uitslag",
    noResultDetail: "Zodra een resultaat is verwerkt, verschijnt de laatste race hier.",
    unavailableTitle: "Racegegevens tijdelijk niet beschikbaar",
    unavailable: "De kalender en resultaten konden niet worden geladen. De rest van de pagina blijft gewoon werken.",
    hiddenRegistrationNote: "Inschrijving geopend",
  },
  why: {
    eyebrow: "Waarom 3SM",
    title: "Meer dan alleen een Discord.",
    lead: "Kalender, inschrijvingen, uitslagen en standings brengen alle belangrijke informatie voor en na iedere race op één plek samen.",
    items: [
      { title: "Kalender en inschrijving", text: "Aankomende races, circuits en tijden staan op de site. Inschrijven gebeurt per race of via een seizoen wanneer dat beschikbaar is." },
      { title: "Uitslagen en standings", text: "Geïmporteerde resultaten vormen het racearchief en werken door in de kampioenschapsstand." },
      { title: "Seizoenen en kampioenschappen", text: "Races kunnen als rondes binnen een seizoen worden georganiseerd. Resultaten en punten vormen daarna één doorlopend kampioenschap." },
      { title: "Community rond de races", text: "Discord is de paddock voor aankondigingen, vragen, voorbereiding en contact met andere coureurs." },
    ],
  },
  participation: {
    eyebrow: "Community, niet alleen een team",
    title: "Rijd op de manier die bij je past.",
    lead: "De league en de community staan centraal. Deelnemen betekent niet dat er onder de 3SM-teamnaam gereden moet worden.",
    solo: { tag: "Zonder team", title: "Solo de grid op", text: "Schrijf je als individuele coureur in en rijd de races die in je planning passen. Iedere race aanwezig zijn is niet verplicht." },
    team: { tag: "Met je eigen team", title: "Samen herkenbaar deelnemen", text: "Bestaande teams kunnen onder hun eigen naam deelnemen. Een nieuw team kan via de bestaande teamflow worden aangevraagd." },
  },
  steps: {
    eyebrow: "Zo werkt deelnemen",
    title: "Van kennismaking naar de startgrid.",
    lead: "De eerste stappen blijven bewust eenvoudig. Technische profielgegevens komen pas aan bod wanneer ze nodig zijn voor betrouwbare inschrijvingen en resultaten.",
    items: [
      { number: "01", title: "Kom op Discord", text: "Bekijk aankondigingen, stel vragen en maak kennis met de community." },
      { number: "02", title: "Maak het profiel compleet", text: "Maak je profiel aan, vul je iRacing gegevens in en verbind Discord via /koppel." },
      { number: "03", title: "Kies een race", text: "Bekijk de kalender en schrijf je in voor een race of seizoen dat bij je planning past." },
      { number: "04", title: "Race mee", text: "Bereid je voor, rijd clean en volg daarna de uitslag en standings." },
    ],
  },
  formats: {
    eyebrow: "Klassen en langere races",
    title: "Nu en in ontwikkeling.",
    lead: "Geen harde roadmap en geen verzonnen releasedata. Alleen de actuele richting van de community.",
    now: "Nu",
    interest: "Bij voldoende interesse",
    development: "In ontwikkeling",
    items: [
      { status: "now", title: "GT3 als hoofdfocus", text: "De eigen league richt zich momenteel voornamelijk op GT3 in iRacing." },
      { status: "interest", title: "Ruimte voor andere klassen", text: "Andere klassen en raceformats kunnen worden toegevoegd wanneer daar genoeg animo voor is." },
      { status: "development", title: "Endurance-planningslaag", text: "3SM bouwt aan een eigen planningslaag rond bestaande iRacing endurance-events. Die omgeving is nog niet volledig af." },
    ],
  },
  faq: {
    eyebrow: "Veelgestelde vragen",
    title: "Alles over meedoen.",
    items: [
      { question: "Kost deelname aan 3SM geld?", answer: "Nee. Deelname aan de 3SM-races en community is gratis." },
      { question: "Is er een minimum iRating?", answer: "Nee. Er geldt geen minimum iRating om mee te mogen doen." },
      { question: "Is er een minimum Safety Rating?", answer: "Nee. Er geldt geen minimum Safety Rating. Clean en respectvol rijden blijft wel de basis." },
      { question: "Zijn beginners welkom?", answer: "Ja. Beginners en ervaren coureurs zijn welkom. Voorbereiding, respect en veilig rijgedrag zijn belangrijker dan een bepaald niveau." },
      { question: "Moet iedere race gereden worden?", answer: "Nee. Rijd de races die in je planning passen. Iedere race aanwezig zijn is niet verplicht." },
      { question: "Kan ik zonder team meedoen?", answer: "Ja. Solo coureurs kunnen zich gewoon inschrijven en deelnemen." },
      { question: "Kan mijn eigen team deelnemen?", answer: "Ja. Eigen teams zijn welkom en hoeven niet onder de 3SM-teamnaam te rijden." },
      { question: "Welke klasse wordt momenteel gereden?", answer: "De belangrijkste eigen league-klasse is momenteel GT3 in iRacing." },
      { question: "Komen er andere klassen?", answer: "Dat kan. Andere klassen en formats kunnen worden toegevoegd wanneer daar binnen de community voldoende interesse voor is." },
      { question: "Hoe werkt aanmelden?", answer: "Join Discord, maak je siteprofiel compleet, koppel je Discord-account en schrijf je daarna via de kalender in voor een race of seizoen." },
      { question: "Wat heb ik nodig om mee te doen?", answer: "Een iRacing-account, Discord, een compleet 3SM-profiel en de bereidheid om voorbereid, clean en respectvol te racen." },
      { question: "Hoe zit het met endurance?", answer: "3SM werkt aan een eigen planningslaag voor bestaande iRacing endurance-events. Die omgeving is actief in ontwikkeling en nog niet volledig beschikbaar." },
    ],
  },
  closing: {
    eyebrow: "De volgende stap",
    title: "Leer de community kennen voordat het licht op groen gaat.",
    lead: "Discord is de paddock. De website blijft de plek voor kalender, inschrijvingen, uitslagen, standings en teams.",
    discord: "Join de 3SM Discord",
    calendar: "Bekijk de kalender",
    note: "Gratis deelname. Geen minimum iRating of Safety Rating.",
  },
};

const en: JoinCopy = {
  meta: {
    title: "Join 3SM – Dutch iRacing League",
    description: "Looking for an iRacing community in the Netherlands? Join 3 Stripe Motorsport: a Dutch iRacing league with Discord, calendar, standings and results.",
    ogTitle: "Join the 3SM iRacing community",
    ogDescription: "Organised iRacing races for beginners, experienced drivers, solo racers and independent teams.",
  },
  hero: {
    eyebrow: "Dutch iRacing community",
    title: "An iRacing community",
    accent: "for competition and fun.",
    lead: "3 Stripe Motorsport is a Dutch iRacing league and community, founded in the Netherlands and open to drivers who share the same racing mentality. Participation is free, and beginners and experienced drivers are welcome.",
    explore: "How joining works",
    calendar: "Go to the race calendar",
    slogan: "Race hard. Race smart. Race respectfully.",
  },
  trust: [
    { title: "Free participation", detail: "No participation fee" },
    { title: "No minimum iRating or SR", detail: "Open to every skill level" },
    { title: "Beginners welcome", detail: "Experience is not required" },
    { title: "Solo or your own team", detail: "Choose how you participate" },
    { title: "Race when it suits you", detail: "You do not have to enter every race" },
  ],
  live: {
    eyebrow: "Real races, real data",
    title: "Recent race activity.",
    lead: "The latest race, podium and historical statistics show that the community is actively racing.",
    next: "Next race",
    latest: "Latest race",
    registrations: "race or season registrations",
    completed: "completed races",
    circuits: "different circuits",
    calendar: "View race and registration",
    results: "Full result",
    noUpcoming: "New race planning will follow",
    noUpcomingDetail: "The calendar remains the central place for new races and registration.",
    noResult: "No recent result yet",
    noResultDetail: "The latest race will appear here once its result has been processed.",
    unavailableTitle: "Race data is temporarily unavailable",
    unavailable: "The calendar and results could not be loaded. The rest of the page remains available.",
    hiddenRegistrationNote: "Registration open",
  },
  why: {
    eyebrow: "Why 3SM",
    title: "More than just a Discord.",
    lead: "The calendar, registrations, results and standings keep all key information before and after every race in one place.",
    items: [
      { title: "Calendar and registration", text: "Upcoming races, circuits and times are published on the site. Registration is available per race or by season when offered." },
      { title: "Results and standings", text: "Imported results build the race archive and feed into the championship standings." },
      { title: "Seasons and championships", text: "Races can be organised as rounds within a season. Results and points then form one continuous championship." },
      { title: "Community around racing", text: "Discord is the paddock for announcements, questions, preparation and meeting other drivers." },
    ],
  },
  participation: {
    eyebrow: "A community, not just one team",
    title: "Race in the way that suits you.",
    lead: "The league and community come first. Joining does not mean you have to race under the 3SM team name.",
    solo: { tag: "Without a team", title: "Join the grid solo", text: "Register as an individual driver and enter the races that fit your schedule. You do not have to attend every race." },
    team: { tag: "With your own team", title: "Compete together under your own name", text: "Existing teams can enter under their own name. A new team can be requested through the existing team flow." },
  },
  steps: {
    eyebrow: "How joining works",
    title: "From introduction to the starting grid.",
    lead: "The first steps are deliberately simple. Technical profile details only become relevant when they are needed for reliable registrations and results.",
    items: [
      { number: "01", title: "Join Discord", text: "Read announcements, ask questions and get to know the community." },
      { number: "02", title: "Complete your profile", text: "Create your profile, add your iRacing details and connect Discord using /koppel." },
      { number: "03", title: "Choose a race", text: "Check the calendar and register for a race or season that fits your schedule." },
      { number: "04", title: "Race", text: "Prepare, race cleanly and follow the result and standings afterwards." },
    ],
  },
  formats: {
    eyebrow: "Classes and longer races",
    title: "Now and in development.",
    lead: "No hard roadmap and no invented release dates. Only the current direction of the community.",
    now: "Now",
    interest: "When there is enough interest",
    development: "In development",
    items: [
      { status: "now", title: "GT3 as the main focus", text: "The in-house league currently focuses mainly on GT3 in iRacing." },
      { status: "interest", title: "Room for other classes", text: "Other classes and race formats can be added when there is enough community interest." },
      { status: "development", title: "Endurance planning layer", text: "3SM is building its own planning layer around existing iRacing endurance events. That environment is not complete yet." },
    ],
  },
  faq: {
    eyebrow: "Frequently asked questions",
    title: "Everything about joining 3SM.",
    items: [
      { question: "Does it cost money to race with 3SM?", answer: "No. Participation in 3SM races and the community is free." },
      { question: "Is there a minimum iRating?", answer: "No. There is no minimum iRating requirement." },
      { question: "Is there a minimum Safety Rating?", answer: "No. There is no minimum Safety Rating. Clean and respectful racing remains the foundation." },
      { question: "Are beginners welcome?", answer: "Yes. Beginners and experienced drivers are welcome. Preparation, respect and safe driving matter more than a particular skill level." },
      { question: "Do I have to attend every race?", answer: "No. Enter the races that fit your schedule. Attendance at every race is not required." },
      { question: "Can I join without a team?", answer: "Yes. Solo drivers can register and race like everyone else." },
      { question: "Can my own team take part?", answer: "Yes. Independent teams are welcome and do not have to race under the 3SM team name." },
      { question: "Which class is currently used?", answer: "GT3 is currently the main class in the in-house iRacing league." },
      { question: "Will other classes be added?", answer: "Possibly. Other classes and formats can be added when there is enough interest within the community." },
      { question: "How do I register?", answer: "Join Discord, complete your site profile, link your Discord account and then register for a race or season through the calendar." },
      { question: "What do I need to participate?", answer: "An iRacing account, Discord, a complete 3SM profile and a willingness to prepare and race cleanly and respectfully." },
      { question: "What is happening with endurance racing?", answer: "3SM is building its own planning layer for existing iRacing endurance events. It is actively being developed and is not fully available yet." },
    ],
  },
  closing: {
    eyebrow: "The next step",
    title: "Meet the community before the lights turn green.",
    lead: "Discord is the paddock. The website remains the place for the calendar, registrations, results, standings and teams.",
    discord: "Join the 3SM Discord",
    calendar: "View the calendar",
    note: "Free participation. No minimum iRating or Safety Rating.",
  },
};

export const joinCopy: Record<JoinLocale, JoinCopy> = { nl, en };
