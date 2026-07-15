import { ENDURANCE_STORAGE_KEY } from "./types";

export const enduranceEnvironment = {
  mode: "local" as const,
  storageKey: ENDURANCE_STORAGE_KEY,
  productionWritesEnabled: false,
  discordWritesEnabled: false,
  iracingOAuthRequired: false,
};

export const assertLocalEnduranceEnvironment = () => {
  if (enduranceEnvironment.productionWritesEnabled || enduranceEnvironment.discordWritesEnabled) {
    throw new Error("Endurance devomgeving mag geen productie- of Discordwrites uitvoeren.");
  }
};
