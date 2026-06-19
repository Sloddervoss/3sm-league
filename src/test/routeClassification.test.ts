import { describe, expect, it } from "vitest";

const routeClassification = () => import("../../scripts/route-classification.mjs");

describe("route classification for generated SEO HTML", () => {
  it("treats every admin route as private/noindex, including future nested admin pages", async () => {
    const { isPrivateRoute } = await routeClassification();

    expect(isPrivateRoute("/admin")).toBe(true);
    expect(isPrivateRoute("/admin/track-intelligence")).toBe(true);
    expect(isPrivateRoute("/admin/anything-new")).toBe(true);
    expect(isPrivateRoute("/admin/anything-new/deep-link")).toBe(true);
  });

  it("keeps public SEO routes out of the private/noindex classifier", async () => {
    const { isPrivateRoute } = await routeClassification();

    expect(isPrivateRoute("/")).toBe(false);
    expect(isPrivateRoute("/results")).toBe(false);
    expect(isPrivateRoute("/results/season-1-race-1")).toBe(false);
    expect(isPrivateRoute("/news/team-update")).toBe(false);
  });
});
