import { createContext } from "react";
import type { Language } from "./translations";

export type LanguageContextType = {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (value: string) => string;
};

export const LanguageContext = createContext<LanguageContextType | null>(null);
