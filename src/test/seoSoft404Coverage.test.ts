import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regressietests voor de soft-404-fix.
 *
 * De SPA-fallback gaf voorheen HTTP 200 met de homepage-shell (inclusief
 * homepage-canonical) op ELK onbekend pad. Dat maakte van /bestaat-niet/,
 * /.env en /sitemap_index.xml duplicaten van de homepage. De fix bestaat uit
 * twee delen: (1) dekking voor de echte app-routes, (2) een echte 404 voor de
 * rest. Deze test houdt beide delen én de koppeling met src/App.tsx vast.
 */
describe("soft-404 dekking en echte 404", () => {
  const nginx = readFileSync("nginx.conf", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  const generator = readFileSync("scripts/generate-route-html.mjs", "utf8");
  const refresh = readFileSync("scripts/refresh-dynamic-seo.mjs", "utf8");

  const routePaths = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
  const firstSegments = (paths: string[]) =>
    paths.map((p) => p.split("/").filter(Boolean)[0]).filter(Boolean);

  const privatePrefixes = ["admin", "news-editor", "stewards", "koppel", "simhub-koppelen", "profile", "auth"];

  const publicSegments = [...new Set(
    firstSegments(routePaths.filter((p) => {
      const seg = p.split("/").filter(Boolean)[0];
      return p !== "/" && seg !== "endurance" && seg !== "*" && !privatePrefixes.includes(seg);
    })),
  )];

  const lineWith = (needle: string) => nginx.split("\n").find((line) => line.includes(needle)) ?? "";

  it("stuurt onbekende paden naar een echte 404 in plaats van naar de SPA-shell", () => {
    expect(nginx).toContain("error_page 404 /404.html;");
    const fallback = nginx.split("location / {")[1] ?? "";
    expect(fallback).toContain("try_files $uri $uri/ =404;");
    // De oude alles-slikkende fallback mag niet terugkomen als enige fallback.
    expect(fallback).not.toContain("app-shell-fallback");
  });

  it("geeft nooit de homepage-shell met homepage-canonical aan een deep link", () => {
    // Een geldige route zonder geprerenderd bestand moet op de noindex-shell
    // uitkomen, niet op index.html (dat draagt de canonical naar "/").
    expect(nginx).not.toContain("try_files $uri $uri/ /index.html;");
    expect(nginx).toContain("location = /app-shell-fallback.html");
    const shellBlock = nginx.split("location = /app-shell-fallback.html")[1].split("}")[0];
    expect(shellBlock).toContain("internal;");
    expect(shellBlock).toContain('X-Robots-Tag "noindex, nofollow"');
    expect(generator).toContain("app-shell-fallback.html");
  });

  it("laat elke publieke app-route uit App.tsx terugvallen op de SPA-shell", () => {
    const publicLine = lineWith("homepage-prototype|calendar|standings");
    expect(publicLine).not.toBe("");
    for (const segment of publicSegments) {
      expect(publicLine, `publieke route /${segment} mist in de nginx-allowlist`).toContain(segment);
    }
    const publicBlock = nginx.split(publicLine)[1].split("}")[0];
    expect(publicBlock).toContain("try_files $uri $uri/ /app-shell-fallback.html;");
  });

  it("houdt de utility-/beheerboom bereikbaar maar nooit indexeerbaar", () => {
    const utilityLine = lineWith("admin|news-editor");
    expect(utilityLine).not.toBe("");
    for (const prefix of privatePrefixes) {
      expect(utilityLine, `private route /${prefix} mist in de nginx-allowlist`).toContain(prefix);
    }
    const utilityBlock = nginx.split(utilityLine)[1].split("}")[0];
    expect(utilityBlock).toContain('X-Robots-Tag "noindex, nofollow"');
  });

  it("houdt de endurance-bèta werkend maar buiten de index", () => {
    const enduranceLine = lineWith("location ^~ /endurance");
    expect(enduranceLine).not.toBe("");
    const block = nginx.split(enduranceLine)[1].split("}")[0];
    expect(block).toContain('X-Robots-Tag "noindex, nofollow"');
    expect(block).toContain("try_files $uri $uri/ /app-shell-fallback.html;");
    expect(routePaths).toContain("/endurance/*");
  });

  it("serveert het route-manifest nooit publiek", () => {
    expect(nginx).toContain("location = /.route-html-manifest.json");
    expect(nginx).toContain("deny all;");
  });

  it("genereert een 404.html met noindex en zonder homepage-canonical", () => {
    expect(generator).toContain("404.html");
    expect(generator).toContain("buildNonCanonicalShell");
    const builder = generator.split("const buildNonCanonicalShell")[1].split("writeFileSync(")[0];
    expect(builder).toContain('content="noindex, follow"');
    expect(builder).toContain('replace(/\\s*<link rel="canonical"');
  });

  it("publiceert 404.html en de noindex-shell mee naar de webroot", () => {
    expect(refresh).toContain("404.html");
    expect(refresh).toContain("app-shell-fallback.html");
  });

  it("breekt de build af bij een verdacht kleine sitemap", () => {
    expect(generator).toContain("MIN_SITEMAP_URLS");
    expect(generator).toContain("Sitemap-generatie afgebroken");
  });

  it("breekt af als de Supabase-env ontbreekt in plaats van stil te degraderen", () => {
    // Zonder deze rem bouwt een verse release-worktree (geen .env, gitignored)
    // alleen de statische routes en ruimt de deploy de dynamische pagina's op.
    expect(generator).toContain("ALLOW_MISSING_SUPABASE_ENV");
    expect(generator).toContain("Supabase env ontbreekt: nieuws- en uitslagroutes");
  });

  it("publiceert nooit een sitemap die gehalveerd is t.o.v. wat er live staat", () => {
    expect(generator).toContain("liveSitemapPath");
    expect(generator).toContain("meer dan een halvering");
  });

  it("laat deploy.sh geen release bouwen zonder .env", () => {
    const deploy = readFileSync("deploy.sh", "utf8");
    expect(deploy).toContain("active-release.conf");
    expect(deploy).toContain("Geen .env in deze worktree");
  });

  it("prerendert nieuws-categoriehubs zodat /news/<categorie>/ geen 403 meer geeft", () => {
    expect(generator).toContain("Categorie-hubs");
    expect(generator).toContain("path: `/news/${slug}`");
  });

  it("laat de verouderde public/sitemap.xml-stub niet terugkomen", () => {
    expect(() => readFileSync("public/sitemap.xml", "utf8")).toThrow();
    expect(() => readFileSync("public/preview.html", "utf8")).toThrow();
  });
});
