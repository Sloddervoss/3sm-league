export const IRACING_ENDURANCE_CLASSES = ["GTP", "LMP2", "LMP3", "GT3", "GT4", "TCR", "PCUP", "M2", "PROD", "HPD", "GT1", "GT2"] as const;
export type EnduranceClassId = typeof IRACING_ENDURANCE_CLASSES[number];

export interface IRacingEnduranceCar {
  id: string;
  classId: EnduranceClassId;
  name: string;
  iracingUrl: string;
  maxDrivers: number;
}

const car = (id: string, classId: EnduranceClassId, name: string, slug: string): IRacingEnduranceCar => ({
  id,
  classId,
  name,
  iracingUrl: `https://www.iracing.com/cars/${slug}/`,
  maxDrivers: 4,
});

/**
 * Centrale moderne iRacing Endurance-catalogus voor de lokale 3SM MVP.
 * Gecontroleerd op 2026-07-15 tegen de officiële iRacing car sitemap/productpagina's.
 * De publicatie van ieder Special Event blijft leidend voor event-specifieke deelname.
 */
export const IRACING_ENDURANCE_CARS: readonly IRacingEnduranceCar[] = [
  car("acura-arx-06", "GTP", "Acura ARX-06", "acura-arx-06"),
  car("bmw-m-hybrid-v8", "GTP", "BMW M Hybrid V8", "bmw-m-hybrid-v8"),
  car("cadillac-v-series-r", "GTP", "Cadillac V-Series.R", "cadillac-v-series-r-gtp"),
  car("ferrari-499p", "GTP", "Ferrari 499P", "ferrari-499p"),
  car("porsche-963", "GTP", "Porsche 963", "porsche-963-gtp"),

  car("dallara-p217", "LMP2", "Dallara P217", "dallara-p217"),
  car("ligier-js-p320", "LMP3", "Ligier JS P320", "ligier-js-p320"),

  car("acura-nsx-gt3-evo-22", "GT3", "Acura NSX GT3 EVO 22", "acura-nsx-gt3-evo22"),
  car("aston-martin-vantage-gt3-evo", "GT3", "Aston Martin Vantage GT3 EVO", "aston-martin-vantage-gt3-evo"),
  car("audi-r8-lms-evo-ii-gt3", "GT3", "Audi R8 LMS EVO II GT3", "audi-r8-lms-evo-ii-gt3"),
  car("bmw-m4-gt3-evo", "GT3", "BMW M4 GT3 EVO", "bmw-m4-gt3-evo"),
  car("chevrolet-corvette-z06-gt3-r", "GT3", "Chevrolet Corvette Z06 GT3.R", "chevrolet-corvette-z06-gt3r"),
  car("ferrari-296-gt3", "GT3", "Ferrari 296 GT3", "ferrari-296-gt3"),
  car("ford-mustang-gt3", "GT3", "Ford Mustang GT3", "ford-mustang-gt3"),
  car("lamborghini-huracan-gt3-evo", "GT3", "Lamborghini Huracán GT3 EVO", "lamborghini-huracan-gt3-evo"),
  car("mclaren-720s-gt3-evo", "GT3", "McLaren 720S GT3 EVO", "mclaren-720s-gt3-evo"),
  car("mercedes-amg-gt3-2020", "GT3", "Mercedes-AMG GT3 2020", "mercedes-amg-gt3-2020"),
  car("porsche-911-gt3-r-992", "GT3", "Porsche 911 GT3 R (992)", "porsche-911-gt3-r-992"),

  car("aston-martin-vantage-gt4", "GT4", "Aston Martin Vantage GT4", "aston-martin-vantage-gt4"),
  car("bmw-m4-g82-gt4-evo", "GT4", "BMW M4 G82 GT4 Evo", "bmw-m4-g82-gt4-evo"),
  car("ford-mustang-gt4", "GT4", "Ford Mustang GT4", "ford-mustang-gt4"),
  car("mclaren-570s-gt4", "GT4", "McLaren 570S GT4", "mclaren-570s-gt4"),
  car("mercedes-amg-gt4", "GT4", "Mercedes-AMG GT4", "mercedes-amg-gt4"),
  car("porsche-718-cayman-gt4-clubsport-mr", "GT4", "Porsche 718 Cayman GT4 Clubsport MR", "porsche-718-cayman-gt4-clubsport-mr"),

  car("audi-rs3-lms-gen2-tcr", "TCR", "Audi RS3 LMS Gen2 TCR", "audi-rs3-lms-gen2-tcr"),
  car("honda-civic-type-r-tcr", "TCR", "Honda Civic Type R TCR", "honda-civic-type-r-tcr"),
  car("hyundai-elantra-n-tcr", "TCR", "Hyundai Elantra N TCR", "hyundai-elantra-n-tcr"),
  car("hyundai-veloster-n-tcr", "TCR", "Hyundai Veloster N TCR", "hyundai-veloster-n-tcr"),

  car("porsche-911-cup-992-2", "PCUP", "Porsche 911 Cup (992.2)", "porsche-911-cup-992-2"),
  car("bmw-m2-racing-g87", "M2", "BMW M2 Racing (G87)", "bmw-m2-racing-g87"),

  car("global-mazda-mx-5-cup", "PROD", "Global Mazda MX-5 Cup", "global-mazda-mx-5-cup"),
  car("renault-clio", "PROD", "Renault Clio", "renault-clio"),
  car("toyota-gr86", "PROD", "Toyota GR86", "toyota-gr86"),

  car("hpd-arx-01c", "HPD", "HPD ARX-01c", "hpd-arx-01c"),
  car("chevrolet-corvette-c6r", "GT1", "Chevrolet Corvette C6.R", "chevrolet-corvette-c6r"),
  car("aston-martin-dbr9-gt1", "GT1", "Aston Martin DBR9 GT1", "aston-martin-dbr9-gt1"),
  car("ford-gt-gt2-gt3", "GT2", "Ford GT GT2/GT3", "ford-gt-gt2-gt3"),
] as const;

export const enduranceCarsForClass = (classId: EnduranceClassId) => IRACING_ENDURANCE_CARS.filter((candidate) => candidate.classId === classId);
export const allowedEnduranceCarsForClass = (classId: EnduranceClassId, allowedCarIds?: readonly string[]) => {
  const cars = enduranceCarsForClass(classId);
  return allowedCarIds ? cars.filter((candidate) => allowedCarIds.includes(candidate.id)) : cars;
};
export const getEnduranceCar = (id: string | null | undefined) => IRACING_ENDURANCE_CARS.find((candidate) => candidate.id === id);
export const isEnduranceClassId = (value: string): value is EnduranceClassId => IRACING_ENDURANCE_CLASSES.includes(value as EnduranceClassId);
