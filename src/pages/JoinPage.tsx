import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { useLanguage } from "@/i18n/useLanguage";
import { setSeoMeta } from "@/lib/seo";
import { JoinExperience } from "@/features/join/JoinExperience";
import { joinCopy, type JoinLocale } from "@/features/join/content";
import { useJoinPageData } from "@/features/join/data";

const NL_CANONICAL_URL = "https://3stripemotorsport.cc/meedoen/";
const EN_CANONICAL_URL = "https://3stripemotorsport.cc/en/join/";
const FAQ_SCHEMA_ID = "join-page-faq-schema";

const JoinPage = () => {
  const { language, setLanguage } = useLanguage();
  const { pathname } = useLocation();
  const isEnglishRoute = pathname.startsWith("/en/");
  const locale: JoinLocale = language === "en" ? "en" : "nl";
  const copy = joinCopy[locale];
  const data = useJoinPageData();

  // Wie binnenkomt op de Engelstalige pagina, houdt Engels aan bij het
  // doorklikken naar de rest van de site. Handmatig terugzetten naar
  // Nederlands blijft mogelijk via de taalknop.
  useEffect(() => {
    if (isEnglishRoute && language !== "en") setLanguage("en");
  }, [isEnglishRoute, language, setLanguage]);

  useEffect(() => {
    setSeoMeta({
      title: copy.meta.title,
      description: copy.meta.description,
      canonicalUrl: isEnglishRoute ? EN_CANONICAL_URL : NL_CANONICAL_URL,
      ogTitle: copy.meta.ogTitle,
      ogDescription: copy.meta.ogDescription,
    });

    document.getElementById(FAQ_SCHEMA_ID)?.remove();
    const schema = document.createElement("script");
    schema.id = FAQ_SCHEMA_ID;
    schema.type = "application/ld+json";
    schema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: locale === "en" ? "en" : "nl-NL",
      mainEntity: copy.faq.items.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
    document.head.appendChild(schema);

    return () => document.getElementById(FAQ_SCHEMA_ID)?.remove();
  }, [copy, locale, isEnglishRoute]);

  return (
    <div className="min-h-screen bg-[#080a0f]">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <JoinExperience language={locale} {...data} />
      </main>
      <Footer />
    </div>
  );
};

export default JoinPage;
