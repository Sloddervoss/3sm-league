import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("news editor workflow", () => {
  it("uses a Tiptap editor with title, slug, SEO fields, status, save and publish actions", () => {
    const page = read("src/pages/NewsEditorPage.tsx");
    const pkg = read("package.json");

    expect(pkg).toContain('"@tiptap/react"');
    expect(pkg).toContain('"@tiptap/starter-kit"');
    expect(pkg).toContain('"@tiptap/extension-image"');
    expect(pkg).toContain('"@tiptap/extension-link"');

    expect(page).toContain("useEditor({");
    expect(page).toContain("StarterKit");
    expect(page).toContain("ImageExtension");
    expect(page).toContain("LinkExtension");
    expect(page).toContain('from("news_posts")');
    expect(page).toContain("upsertNewsPost");
    expect(page).toContain("publishNewsPost");
    expect(page).toContain("generateSlug");
    expect(page).toContain("SEO titel");
    expect(page).toContain("SEO beschrijving");
    expect(page).toContain("Opslaan als concept");
    expect(page).toContain("Publiceren");
    expect(page).toContain("Bijwerken");
  });

  it("requires editorial categories and stores them for future filtering", () => {
    const page = read("src/pages/NewsEditorPage.tsx");
    const migration = read("supabase/migrations/20260601103000_news_editor_professional_fields.sql");
    const types = read("src/integrations/supabase/types.ts");

    [
      "Raceverslagen",
      "League Updates",
      "Race Recaps",
      "Interviews",
      "Reviews",
      "Community",
      "iRacing Nieuws",
      "Special Events",
    ].forEach((category) => expect(page).toContain(category));

    expect(page).toContain("category");
    expect(page).toContain("Categorie");
    expect(page).toContain("Toon alle categorieën");
    expect(migration).toContain("category TEXT NOT NULL");
    expect(migration).toContain("idx_news_posts_category");
    expect(types).toContain("category: string");
  });

  it("makes writing the main focus and renders the title as the article H1 instead of asking for it twice", () => {
    const page = read("src/pages/NewsEditorPage.tsx");

    expect(page).toContain("article-title-preview");
    expect(page).toContain("min-h-[720px]");
    expect(page).toContain("Bodytekst: 18px");
    expect(page).not.toContain("<h2>Nieuwe update</h2>");
    expect(page).toContain("Metadata & SEO");
  });

  it("keeps the editor placeholder out of saved article content", () => {
    const page = read("src/pages/NewsEditorPage.tsx");

    expect(page).toContain("titlePlaceholder");
    expect(page).toContain("aria-hidden=\"true\"");
    expect(page).not.toContain('title || "Titel verschijnt hier automatisch als H1"');
  });

  it("supports professional formatting and resizable aligned images", () => {
    const page = read("src/pages/NewsEditorPage.tsx");
    const pkg = read("package.json");

    expect(pkg).toContain('"@tiptap/extension-table"');
    expect(pkg).toContain('"@tiptap/extension-table-row"');
    expect(pkg).toContain('"@tiptap/extension-table-cell"');
    expect(pkg).toContain('"@tiptap/extension-table-header"');
    expect(pkg).toContain('"@tiptap/extension-horizontal-rule"');
    expect(page).toContain("ResizableImageExtension");
    expect(page).toContain("resize-handle");
    expect(page).toContain("data-align");
    expect(page).toContain("setImageAlignment");
    expect(page).toContain("insertTable");
    expect(page).toContain("toggleCodeBlock");
    expect(page).toContain("toggleHeading({ level: 3 })");
    expect(page).toContain("toggleHeading({ level: 4 })");
    expect(page).toContain("setTextSize");
    expect(page).toContain("data-bubble-menu=\"text\"");
    expect(page).toContain("editor-toolbar-group");
    expect(page).toContain("isStyleActive");
    expect(page).toContain("setFontSize");
    expect(page).toContain("setImageAltText");
    expect(page).toContain("setImageCaption");
    expect(page).toContain("deleteSelection()");
    expect(page).toContain("selectedImageAttrs");
  });

  it("keeps aligned images shrink-wrapped so left, center and right positions are visible", () => {
    const css = read("src/index.css");

    expect(css).toContain(".news-editor-prose .news-image-figure,");
    expect(css).toContain("width: fit-content;");
    expect(css).toContain("margin-left: 0;");
    expect(css).toContain("margin-left: auto;");
    expect(css).toContain("margin-right: auto;");
  });

  it("allows multiple resized images on one editor line with quick width presets", () => {
    const page = read("src/pages/NewsEditorPage.tsx");
    const css = read("src/index.css");

    expect(css).toContain("display: inline-block;");
    expect(css).toContain("vertical-align: top;");
    expect(page).toContain("setImageWidth");
    expect(page).toContain("33%");
    expect(page).toContain("50%");
    expect(page).toContain("100%");
    expect(page).toContain("wrapper.style.width = currentAttrs.width || \"100%\"");
    expect(page).toContain("img.style.width = \"100%\"");
  });

  it("supports news image uploads into the news-images bucket and insertion at the editor cursor", () => {
    const page = read("src/pages/NewsEditorPage.tsx");

    expect(page).toContain("uploadNewsImage");
    expect(page).toContain("news-images");
    expect(page).toContain("setImage");
    expect(page).toContain("hero_image_url");
  });
});
