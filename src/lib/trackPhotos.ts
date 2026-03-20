/**
 * trackPhotos.ts — Echte track foto's (aerial/scenic) voor hero cards
 * Bron: Wikimedia Commons (open licentie)
 * NIET van iRacing gescrapet.
 */
import { getTrackInfo } from "./trackData";

const TRACK_PHOTOS: Record<string, string> = {
  "Circuit de Spa-Francorchamps":          "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Eau_Rouge_1997.jpg/1200px-Eau_Rouge_1997.jpg",
  "Autodromo Nazionale Monza":             "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Monza_banking_2003.JPG/1200px-Monza_banking_2003.JPG",
  "Silverstone Circuit":                   "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Silverstone_Circuit%2C_July_2%2C_2018_SkySat_%28cropped%29.jpg/1200px-Silverstone_Circuit%2C_July_2%2C_2018_SkySat_%28cropped%29.jpg",
  "Circuit de Monaco":                     "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Circuit_de_Monaco%2C_April_1%2C_2018_SkySat_%28cropped%29.jpg/1200px-Circuit_de_Monaco%2C_April_1%2C_2018_SkySat_%28cropped%29.jpg",
  "Circuit de Barcelona-Catalunya":        "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Circuit_de_Barcelona-Catalunya%2C_April_19%2C_2018_SkySat_%28cropped%29.jpg/1200px-Circuit_de_Barcelona-Catalunya%2C_April_19%2C_2018_SkySat_%28cropped%29.jpg",
  "Circuit de Barcelona Catalunya":        "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Circuit_de_Barcelona-Catalunya%2C_April_19%2C_2018_SkySat_%28cropped%29.jpg/1200px-Circuit_de_Barcelona-Catalunya%2C_April_19%2C_2018_SkySat_%28cropped%29.jpg",
  "Circuit Zandvoort":                     "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Circuit_Park_Zandvoort_from_air_2016-08-24.jpg/1200px-Circuit_Park_Zandvoort_from_air_2016-08-24.jpg",
  "Circuit Park Zandvoort":                "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Circuit_Park_Zandvoort_from_air_2016-08-24.jpg/1200px-Circuit_Park_Zandvoort_from_air_2016-08-24.jpg",
  "Nürburgring Combined":                  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/N%C3%BCrburg_11010027.jpg/1200px-N%C3%BCrburg_11010027.jpg",
  "Nürburgring Grand Prix Circuit":        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/N%C3%BCrburg_11010027.jpg/1200px-N%C3%BCrburg_11010027.jpg",
  "Red Bull Ring":                         "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Red-Bull-Ring-constrution-area-2010-07-04.JPG/1200px-Red-Bull-Ring-constrution-area-2010-07-04.JPG",
  "Hungaroring":                           "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Hungaroring%2C_April_28%2C_2018_SkySat_%28cropped%29.jpg/1200px-Hungaroring%2C_April_28%2C_2018_SkySat_%28cropped%29.jpg",
  "Indianapolis Motor Speedway":           "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Indianapolis-motor-speedway-1848561.jpg/1200px-Indianapolis-motor-speedway-1848561.jpg",
  "Watkins Glen International":            "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Watkins_Glen_1948-1952.png/1200px-Watkins_Glen_1948-1952.png",
  "Road America":                          "https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/ElkhartLakeWisconsin1951_2RoadAmericaStartFinishLineKettleMoraineScenicDrive.jpg/1200px-ElkhartLakeWisconsin1951_2RoadAmericaStartFinishLineKettleMoraineScenicDrive.jpg",
  "Circuit de la Sarthe":                  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Le_Mans_walker_023.jpg/1200px-Le_Mans_walker_023.jpg",
  "Circuit Paul Ricard":                   "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Circuit_Paul_Ricard%2C_April_22%2C_2018_SkySat_%28cropped%29.jpg/1200px-Circuit_Paul_Ricard%2C_April_22%2C_2018_SkySat_%28cropped%29.jpg",
  "Brands Hatch Circuit":                  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Brands-hatch.jpg/1200px-Brands-hatch.jpg",
};

// Extra tracks
const EXTRA_PHOTOS: Record<string, string> = {
  "Summit Point Raceway":                  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Summit_Point_Motorsports_Park.jpg/1200px-Summit_Point_Motorsports_Park.jpg",
  "Donington Park Racing Circuit":         "https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Donington_Park_from_the_air.jpg/1200px-Donington_Park_from_the_air.jpg",
  "Oulton Park Circuit":                   "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Oulton_Park_aerial.jpg/1200px-Oulton_Park_aerial.jpg",
  "Autodromo Internazionale del Mugello":  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Mugello_aerial_2007.jpg/1200px-Mugello_aerial_2007.jpg",
  "Autodromo Internazionale Enzo e Dino Ferrari": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Imola_aerial.jpg/1200px-Imola_aerial.jpg",
  "Hockenheimring Baden-Württemberg":      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Aerial_view_Hockenheim_2009_Superbike.jpg/1200px-Aerial_view_Hockenheim_2009_Superbike.jpg",
  "Laguna Seca Raceway":                   "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Laguna_seca_2009_us_superbike.jpg/1200px-Laguna_seca_2009_us_superbike.jpg",
  "WeatherTech Raceway at Laguna Seca":    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Laguna_seca_2009_us_superbike.jpg/1200px-Laguna_seca_2009_us_superbike.jpg",
};

/** Fallback voor onbekende tracks — algemeen motorsport foto */
const DEFAULT_PHOTO = "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Aerial_view_Hockenheim_2009_Superbike.jpg/1200px-Aerial_view_Hockenheim_2009_Superbike.jpg";

const ALL_PHOTOS = { ...TRACK_PHOTOS, ...EXTRA_PHOTOS };

/**
 * Geeft een track foto URL terug.
 * Probeert: exacte match → base naam → fallback foto.
 */
export function getTrackPhoto(trackName: string): string {
  if (ALL_PHOTOS[trackName]) return ALL_PHOTOS[trackName];

  // iRacing track namen: "Circuit de Spa-Francorchamps - Grand Prix"
  const base = trackName.split(" - ")[0].trim();
  if (ALL_PHOTOS[base]) return ALL_PHOTOS[base];

  return DEFAULT_PHOTO;
}
