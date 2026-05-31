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
    expect(page).toContain("Concept opslaan");
    expect(page).toContain("Publiceren");
  });

  it("supports news image uploads into the news-images bucket and insertion at the editor cursor", () => {
    const page = read("src/pages/NewsEditorPage.tsx");

    expect(page).toContain("uploadNewsImage");
    expect(page).toContain("news-images");
    expect(page).toContain("setImage");
    expect(page).toContain("hero_image_url");
  });
});
