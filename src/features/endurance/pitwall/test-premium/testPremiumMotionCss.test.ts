import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * De bewegingschakelaar moet niet alleen de WAAPI-FLIP stoppen: ook de
 * CSS-rondeflits en rij-transities horen dan stil te staan.
 */
const css = readFileSync("src/features/endurance/pitwall/test-premium/testPremium.css", "utf8");

describe("premium motion-CSS", () => {
  it("houdt de decoratieve CSS-effecten normaal actief", () => {
    expect(css).toMatch(/\.ptp-lap-flash \{[^}]*animation: ptp-lap-in/);
    expect(css).toMatch(/tr\[data-timing-row-id\] \{\s*transition: background-color/);
  });

  it("zet bij data-motion=off alle CSS-animaties en transities uit", () => {
    const start = css.indexOf('[data-pitwall-test-premium][data-motion="off"],');
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf("}", start);
    const block = css.slice(start, end + 1);

    expect(block).toContain('[data-pitwall-test-premium][data-motion="off"] *');
    expect(block).toContain('[data-pitwall-test-premium][data-motion="off"] *::before');
    expect(block).toContain('[data-pitwall-test-premium][data-motion="off"] *::after');
    expect(block).toMatch(/animation:\s*none\s*!important/);
    expect(block).toMatch(/transition:\s*none\s*!important/);
    expect(block).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });
});
