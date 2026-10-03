import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regressietests voor de P3-bundel (levering en indexatie):
 *
 *  - HTML-caching: alle niet-gehashte bestanden moeten hervalideren, hashed
 *    assets blijven immutable. De oude no-store op / dwong een volledige
 *    download; de gegenereerde routepagina's hadden helemaal geen cache-header.
 *  - Echte 404 onder secties zonder subpagina's (was: lege noindex-app-shell).
 *  - /en/ en zijn case-varianten sturen door naar /en/join/.
 *  - llms.txt en feed.xml worden gegenereerd en gepubliceerd.
 *  - IndexNow meldt nieuwe nieuws- en uitslagpagina's aan.
 *  - Geen externe font- of kaartverzoeken meer.
 */
describe("P3 — levering, caching en indexatie", () => {
  const nginx = readFileSync("nginx.conf", "utf8");
  const generator = readFileSync("scripts/generate-route-html.mjs", "utf8");
  const refresh = readFileSync("scripts/refresh-dynamic-seo.mjs", "utf8");
  const deploy = readFileSync("deploy.sh", "utf8");
  const indexHtml = readFileSync("index.html", "utf8");
  const trackData = readFileSync("src/lib/trackData.ts", "utf8");

  const locationBlock = (needle: string) => {
    const line = nginx.split("\n").find((l) => l.includes(needle)) ?? "";
    return line ? nginx.split(line)[1].split("\n}")[0] : "";
  };

  describe("HTML-caching", () => {
    it("laat niet-gehashte bestanden altijd hervalideren", () => {
      expect(nginx).toContain('add_header Cache-Control "no-cache" always;');
      // Alleen de ZIP van de iRacing-extensie mag nog no-store houden, want die
      // moet altijd vers zijn. Commentaar mag de term uiteraard wel noemen, dus
      // kijk naar de echte header-regels.
      const noStoreHeaders = nginx
        .split("\n")
        .filter((line) => !line.trim().startsWith("#") && line.includes("no-store"));
      expect(noStoreHeaders).toHaveLength(1);
      expect(noStoreHeaders[0]).toContain('add_header Cache-Control "no-cache, no-store, must-revalidate" always;');
      expect(nginx.indexOf(noStoreHeaders[0])).toBeGreaterThan(nginx.indexOf("/iracing-content-extension.zip"));
    });

    it("houdt hashed assets immutable", () => {
      const assets = locationBlock("js|css|png|jpg|jpeg");
      expect(assets).toContain("expires 1y;");
      expect(assets).toContain('add_header Cache-Control "public, immutable"');
    });

    it("geeft de blokken met een eigen X-Robots-Tag ook weer een cache-header", () => {
      // Een eigen add_header wist de serverbrede Cache-Control; zonder deze regel
      // mogen browsers de shell en de beheerpagina's heuristisch cachen.
      const shell = locationBlock("location = /app-shell-fallback.html");
      expect(shell).toContain('add_header Cache-Control "no-cache" always;');
      expect(locationBlock("admin|news-editor")).toContain('add_header Cache-Control "no-cache" always;');
      expect(locationBlock("location ^~ /endurance")).toContain('add_header Cache-Control "no-cache" always;');
    });
  });

  describe("echte 404 onder secties zonder subpagina's", () => {
    it("stuurt diepe paden onder een bladpagina naar 404", () => {
      const line = nginx.split("\n").find((l) => l.includes("calendar|standings|meedoen|support|homepage-prototype")) ?? "";
      expect(line, "404-location voor secties zonder subpagina's ontbreekt").not.toBe("");
      // [^.]+ en niet .+: met .+ matcht ook /meedoen/index.html, en dat is precies
      // het bestand waar de map bij een verzoek aan /meedoen/ intern naar wijst.
      // Zonder deze grens geeft de hub zelf een 404 (in de praktijk getest).
      expect(line).toContain("/[^.]+$");
      expect(line).not.toContain("/.+$");
      expect(nginx.split(line)[1].split("\n    }")[0]).toContain("return 404;");
    });

    it("laat de datagedreven secties juist op de shell terugvallen", () => {
      // /drivers/<slug>/ en /results/<uuid>/ kunnen pas bestaan nadat de database
      // ze kent; een verse uitslag heeft nog geen geprerenderd bestand.
      const line = nginx.split("\n").find((l) => l.includes("/.+$")) ?? "";
      for (const section of ["drivers", "results", "news", "teams", "seasons"]) {
        expect(line).not.toContain(section);
      }
    });
  });

  describe("case-varianten van /en/", () => {
    it("stuurt /EN/ en /En/Join naar /en/join/ zonder lus", () => {
      expect(nginx).toContain("[Ee][Nn](/[Jj][Oo][Ii][Nn])?/?$");
      expect(nginx).toContain('if ($uri ~ "[A-Z]")');
      expect(nginx).toContain("location = /en {");
      expect(nginx).toContain("location = /en/ {");
      expect(nginx).toContain("https://3stripemotorsport.cc/en/join/");
    });

    it("laat /en/join/ zelf gewoon de echte pagina serveren", () => {
      const block = locationBlock("[Ee][Nn](/[Jj][Oo][Ii][Nn])?/?$");
      expect(block).toContain("try_files $uri $uri/ /app-shell-fallback.html;");
    });
  });

  describe("llms.txt en feed.xml", () => {
    it("genereert ze uit dezelfde routelijst als de sitemap", () => {
      expect(generator).toContain("generateLlmsTxt");
      expect(generator).toContain("generateFeed");
      expect(generator).toContain("writeFileSync(join(distDir, 'llms.txt')");
      expect(generator).toContain("writeFileSync(join(distDir, 'feed.xml')");
      expect(generator).toContain("sitemapRoutes");
    });

    it("publiceert ze mee bij de SEO-refresh", () => {
      expect(refresh).toContain("join(distDir, 'llms.txt')");
      expect(refresh).toContain("join(distDir, 'feed.xml')");
    });

    it("meldt de feed aan in de HTML", () => {
      expect(indexHtml).toContain('rel="alternate" type="application/rss+xml"');
      expect(indexHtml).toContain('href="/feed.xml"');
    });
  });

  describe("IndexNow", () => {
    it("meldt nieuwe pagina's aan na een uitrol", () => {
      expect(deploy).toContain("submit-indexnow.mjs");
      // Een mislukte melding mag een uitrol niet laten mislukken.
      expect(deploy).toContain("IndexNow-overdracht mislukt");
    });

    it("meldt alleen gewijzigde nieuws- en uitslagpagina's aan bij de refresh", () => {
      expect(refresh).toContain("changedRoutes");
      expect(refresh).toContain("SKIP_INDEXNOW");
      expect(refresh).toContain("submit-indexnow.mjs");
      expect(refresh).toContain("startsWith('/news/')");
      expect(refresh).toContain("startsWith('/results/')");
    });
  });

  describe("geen externe verzoeken meer", () => {
    it("laadt geen Google Fonts meer", () => {
      expect(indexHtml).not.toContain("fonts.googleapis.com");
      expect(indexHtml).not.toContain("fonts.gstatic.com");
      expect(readFileSync("src/index.css", "utf8")).not.toContain("fonts.googleapis.com");
      expect(readFileSync("src/index.css", "utf8")).toContain("fonts-selfhosted.css");
      expect(existsSync("src/fonts-selfhosted.css")).toBe(true);
      expect(indexHtml).toContain('/fonts/rajdhani-700-latin.woff2');
    });

    it("wijst voor trackkaarten niet meer naar Wikimedia", () => {
      expect(trackData).not.toContain("upload.wikimedia.org");
      expect(trackData).toContain("/tracks/wiki/");
      expect(existsSync("public/tracks/wiki/ATTRIBUTION.txt")).toBe(true);
      expect(existsSync("scripts/trackmap-sources.json")).toBe(true);
    });

    it("noemt de kaartbron in de footer, zoals de licentie vraagt", () => {
      const footer = readFileSync("src/components/Footer.tsx", "utf8");
      expect(footer).toContain("/tracks/wiki/ATTRIBUTION.txt");
      expect(footer).toContain("Wikimedia");
    });
  });
});
