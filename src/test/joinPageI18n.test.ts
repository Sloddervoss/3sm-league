import { describe, expect, it } from "vitest";
import { translateText } from "@/i18n/translations";

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
  });
});
