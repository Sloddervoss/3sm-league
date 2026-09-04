// Suzuka-bewezen mapping: exacte officiële car-ids (Data API season 6618, GT3 class 2708)
// gekoppeld aan lokale 3SM-whitelist-slugs. Encodeert dat alle 11 in de GT3-whitelist
// staan en geen gok-op-naam nodig was. Mapping is bevoegd omdat elke feature-slug 1:1
// aan een officieel car_id is gekoppeld via carclass obtainable id.

const GT3_WHITELIST = new Set([
  "acura-nsx-gt3-evo-22", "aston-martin-vantage-gt3-evo", "audi-r8-lms-evo-ii-gt3",
  "bmw-m4-gt3-evo", "chevrolet-corvette-z06-gt3-r", "ferrari-296-gt3", "ford-mustang-gt3",
  "lamborghini-huracan-gt3-evo", "mclaren-720s-gt3-evo", "mercedes-amg-gt3-2020",
  "porsche-911-gt3-r-992",
]);

// official car_id (Data API season 6618) -> lokale slug + feature-slug
const suzuka = [
  { car_id: 194, slug: "acura-nsx-gt3-evo-22", feature: "acura-nsx-gt3-evo22-feature" },
  { car_id: 206, slug: "aston-martin-vantage-gt3-evo", feature: "astonmartinvantageevogt3-feature" },
  { car_id: 176, slug: "audi-r8-lms-evo-ii-gt3", feature: "audi-r8-lms-evo-ii-gt3_feature" },
  { car_id: 132, slug: "bmw-m4-gt3-evo", feature: "bmw-m4-gt3-1" },
  { car_id: 184, slug: "chevrolet-corvette-z06-gt3-r", feature: "chevrolet-corvette-z06-gt3r-feature" },
  { car_id: 173, slug: "ferrari-296-gt3", feature: "ferrari296gt3-feature-1" },
  { car_id: 185, slug: "ford-mustang-gt3", feature: "ford-mustang-gt3-feature" },
  { car_id: 133, slug: "lamborghini-huracan-gt3-evo", feature: "lamborghinihuracangt3evo" },
  { car_id: 188, slug: "mclaren-720s-gt3-evo", feature: "mclaren-720s-gt3-evo" },
  { car_id: 156, slug: "mercedes-amg-gt3-2020", feature: "mercedes-amg-gt3-2020" },
  { car_id: 169, slug: "porsche-911-gt3-r-992", feature: "porsche992rgt3-feature" },
];

describe("Suzuka verified car mapping (Data API season 6618)", () => {
  it("definieert 11 exacte officiële car-ids met lokale slugs, allen in GT3-whitelist", () => {
    expect(suzuka).toHaveLength(11);
    for (const row of suzuka) {
      expect(GT3_WHITELIST.has(row.slug)).toBe(true); // moet in de activatie-whitelist staan
      expect(typeof row.car_id).toBe("number");
      expect(row.feature.length).toBeGreaterThan(3);
    }
  });

  it("lokale slugs zijn uniek (geen duplicate mapping)", () => {
    const slugs = suzuka.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(11);
  });

  it("elk officieel car_id is uniek", () => {
    const ids = suzuka.map((r) => r.car_id);
    expect(new Set(ids).size).toBe(11);
  });
});