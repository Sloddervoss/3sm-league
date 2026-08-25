import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { translateText } from "@/i18n/translations";

const read = (path: string) => readFileSync(path, "utf8");

const recentlyChangedJoinCopy = [
  [
    "3 Stripe Motorsport is een Nederlandse iRacing league en sim racing community voor coureurs die clean, fair en met plezier willen racen.",
    "3 Stripe Motorsport is a Dutch iRacing league and sim racing community for drivers who want to race cleanly, fairly and for fun.",
  ],
  ["Meedoen met onze iRacing community", "Join our iRacing community"],
  ["Meedoen met de 3SM iRacing community", "Join the 3SM iRacing community"],
  [
    "Zoek je een iRacing community in Nederland of een Discord waar je mee kunt racen? Bij 3SM sluit je aan bij een Nederlandse iRacing league met kalender, standings en uitslagen.",
    "Looking for an iRacing community in the Netherlands or a Discord where you can race? At 3SM you join a Dutch iRacing league with a calendar, standings and results.",
  ],
  [
    "Kan ik meedoen met deze Nederlandse iRacing community als ik nieuw ben?",
    "Can I join this Dutch iRacing community if I am new?",
  ],
  [
    "Ja. Begin op Discord, maak een profiel aan en schrijf je in voor races zodra je weet welke klasse en kalender bij je past. Nieuwe coureurs zijn welkom zolang ze clean en fair racen.",
    "Yes. Start on Discord, create a profile and register for races once you know which class and calendar fit you. New drivers are welcome as long as they race cleanly and fairly.",
  ],
];

describe("join page i18n", () => {
  it("keeps recently changed Dutch SEO/community copy translated in English mode", () => {
    recentlyChangedJoinCopy.forEach(([nl, en]) => {
      expect(translateText(nl, "en")).toBe(en);
    });
    expect(translateText("Bekijk racekalender", "en")).toBe("View race calendar");
    expect(translateText("Zelf meerijden?", "en")).toBe("Want to race with us?");
    expect(translateText("Bekijk hoe je meedoet", "en")).toBe("See how to join");
  });

  it("keeps the concise join title aligned between runtime and crawler HTML", () => {
    const page = read("src/pages/JoinPage.tsx");
    const content = read("src/features/join/content.ts");
    const generator = read("scripts/generate-route-html.mjs");
    const homepage = read("src/pages/HomepagePrototype.tsx");
    const title = "Meedoen met 3SM – Nederlandse iRacing League";

    expect(content).toContain(`title: "${title}"`);
    expect(generator).toContain(`title: '${title}'`);
    expect(content).not.toContain("iRacing Nederland & Discord Community");
    expect(page).toContain("joinCopy[locale]");
    expect(homepage).toContain("Bekijk racekalender");
  });

  it("keeps homepage runtime metadata aligned with crawler HTML and language-aware", () => {
    const homepage = read("src/pages/HomepagePrototype.tsx");
    const generator = read("scripts/generate-route-html.mjs");
    const title = "3 Stripe Motorsport - Nederlandse iRacing League & Community";
    const description = "3 Stripe Motorsport is een Nederlandse iRacing league en sim racing community. Race mee, sluit aan via Discord en bekijk kalender, standings en uitslagen.";

    expect(homepage).toContain(`title: "${title}"`);
    expect(homepage).toContain(`description: "${description}"`);
    expect(homepage).toContain('title: "3 Stripe Motorsport - Dutch iRacing League & Community"');
    expect(homepage).toContain('canonicalUrl: "https://3stripemotorsport.cc/"');
    expect(generator).toContain(`title: '${title}'`);
    expect(generator).toContain(description);
  });

  it("does not introduce the unrelated low-volume query into public SEO surfaces", () => {
    const unrelatedQuery = ["3x3", "race"].join("");
    for (const path of [
      "src/pages/HomepagePrototype.tsx",
      "src/pages/JoinPage.tsx",
      "scripts/generate-route-html.mjs",
      "index.html",
      "public/sitemap.xml",
    ]) {
      expect(read(path).toLowerCase()).not.toContain(unrelatedQuery);
    }
  });
});
