import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { LANGUAGE_STORAGE_KEY, Language, translateText } from "./translations";

type LanguageContextType = {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (value: string) => string;
};

const LanguageContext = createContext<LanguageContextType | null>(null);

const textOriginals = new WeakMap<Text, string>();
const textTranslations = new WeakMap<Text, string>();
const attrOriginals = new WeakMap<Element, Record<string, string>>();
const attrTranslations = new WeakMap<Element, Record<string, string>>();
const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"];

const shouldSkipTextNode = (node: Text) => {
  const parent = node.parentElement;
  if (!parent) return true;
  return !!parent.closest("script, style, code, pre, [data-no-translate]");
};

const translateTextNode = (node: Text, language: Language) => {
  if (shouldSkipTextNode(node)) return;
  const current = node.nodeValue ?? "";
  const previousTranslation = textTranslations.get(node);

  if (!textOriginals.has(node) || (previousTranslation !== undefined && current !== previousTranslation)) {
    textOriginals.set(node, current);
  }

  const original = textOriginals.get(node) ?? "";
  const translated = translateText(original, language);
  if (node.nodeValue !== translated) node.nodeValue = translated;
  textTranslations.set(node, translated);
};

const translateElementAttributes = (element: Element, language: Language) => {
  if (element.closest("[data-no-translate]")) return;

  for (const attr of TRANSLATABLE_ATTRIBUTES) {
    const current = element.getAttribute(attr);
    if (!current) continue;

    const originals = attrOriginals.get(element) ?? {};
    const translations = attrTranslations.get(element) ?? {};
    const previousTranslation = translations[attr];

    if (!originals[attr] || (previousTranslation !== undefined && current !== previousTranslation)) {
      originals[attr] = current;
      attrOriginals.set(element, originals);
    }

    const translated = translateText(originals[attr], language);
    if (current !== translated) element.setAttribute(attr, translated);
    translations[attr] = translated;
    attrTranslations.set(element, translations);
  }
};

const translateTree = (root: ParentNode, language: Language) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateTextNode(node as Text, language);
    node = walker.nextNode();
  }

  if (root instanceof Element) translateElementAttributes(root, language);
  root.querySelectorAll?.("*").forEach((element) => translateElementAttributes(element, language));
};

const useDomTranslation = (language: Language) => {
  useEffect(() => {
    document.documentElement.lang = language === "nl" ? "nl" : "en";
    translateTree(document.body, language);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          translateTextNode(mutation.target as Text, language);
          continue;
        }

        if (mutation.type === "attributes") {
          translateElementAttributes(mutation.target as Element, language);
          continue;
        }

        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            translateTextNode(node as Text, language);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            translateTree(node as Element, language);
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRIBUTES,
    });

    return () => observer.disconnect();
  }, [language]);
};

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === "en" ? "en" : "nl";
  });

  useDomTranslation(language);

  const setLanguage = (nextLanguage: Language) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    setLanguageState(nextLanguage);
  };

  const value = useMemo<LanguageContextType>(
    () => ({
      language,
      setLanguage,
      toggleLanguage: () => setLanguage(language === "nl" ? "en" : "nl"),
      t: (text) => translateText(text, language),
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
};
