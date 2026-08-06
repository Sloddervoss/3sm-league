import { ENDURANCE_STORAGE_KEY } from "./types";

export const enduranceEnvironment = {
  mode: "canary" as const,
  storageKey: ENDURANCE_STORAGE_KEY,
  productionWritesEnabled: false,
  discordWritesEnabled: false,
  iracingOAuthRequired: false,
  // Endurance is een verborgen super-admin-only project: géén dev-only-crash meer.
  // De daadwerkelijke toegangscontrole gebeurt op twee lagen:
  //  - frontend: super-admin-gate op route + menu (Fase 1)
  //  - data:     uitsluitend nieuwe endurance_*-tabellen met super-admin-only RLS (Fase 2+)
  // Tijdens Fase 1 is er GEEN datakoppeling: de pagina draait op ingebakken seed en
  // schrijft nooit naar de database, dus er bestaat fysiek geen pad naar bestaande data.
  superAdminOnly: true,
};

export const assertLocalEnduranceEnvironment = () => {
  // Tijdens de canary-carry-forward is er geen cross-check naar een dev-hostname meer.
  // Eventuele writes worden apart gegated en mogen in de canary NIET naar productie/discord.
  if (enduranceEnvironment.productionWritesEnabled || enduranceEnvironment.discordWritesEnabled) {
    throw new Error("Endurance canary mag geen productie- of Discordwrites uitvoeren.");
  }
};
