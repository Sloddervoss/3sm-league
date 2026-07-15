import { ENDURANCE_STORAGE_KEY } from "./types";

export const enduranceEnvironment = {
  mode: "local" as const,
  storageKey: ENDURANCE_STORAGE_KEY,
  productionWritesEnabled: false,
  discordWritesEnabled: false,
  iracingOAuthRequired: false,
  localRuntimeAllowed: import.meta.env.DEV
    && import.meta.env.VITE_ENDURANCE_LOCAL_MVP === "true"
    && !["3stripemotorsport.cc", "www.3stripemotorsport.cc"].includes(typeof window === "undefined" ? "" : window.location.hostname),
};

export const assertLocalEnduranceEnvironment = () => {
  if (!enduranceEnvironment.localRuntimeAllowed) {
    throw new Error("Endurance MVP is alleen beschikbaar in de expliciet ingeschakelde lokale devomgeving.");
  }
  if (enduranceEnvironment.productionWritesEnabled || enduranceEnvironment.discordWritesEnabled) {
    throw new Error("Endurance devomgeving mag geen productie- of Discordwrites uitvoeren.");
  }
};
