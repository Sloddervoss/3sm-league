import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const popupCss = readFileSync(
  resolve(process.cwd(), "tools/iracing-content-extension/popup.css"),
  "utf8"
);

describe("track scanner popup CSS", () => {
  it("keeps hidden upload state elements hidden even when component classes set display", () => {
    expect(popupCss).toMatch(/\[hidden\]\s*{[^}]*display:\s*none\s*!important;/s);
    expect(popupCss).toMatch(/\.upload-status\s*{[^}]*display:\s*flex;/s);
  });
});