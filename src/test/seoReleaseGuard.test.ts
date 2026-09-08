import { expect, it } from "vitest";
import { assertSameSiteBuild } from "../../scripts/seo-release-guard.mjs";
const page = (build: string) => `<script type="module" src="/assets/index-${build}.js"></script>`;
it("prevents SEO from restoring an older application bundle", () => {
 expect(() => assertSameSiteBuild(page("old"),page("new"))).toThrow(/geweigerd/);
 expect(() => assertSameSiteBuild(page("new"),page("new"))).not.toThrow();
 expect(() => assertSameSiteBuild("",page("new"))).toThrow();
});
