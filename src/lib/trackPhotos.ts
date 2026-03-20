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

/**
 * Geeft een echte track foto URL terug (aerial/scenic).
 * Probeert eerst exacte match, dan base naam (voor iRacing varianten zoals "Spa - Grand Prix").
 * Geeft undefined als er geen foto beschikbaar is.
 */
export function getTrackPhoto(trackName: string): string | undefined {
  if (TRACK_PHOTOS[trackName]) return TRACK_PHOTOS[trackName];

  // iRacing heeft track namen zoals "Circuit de Spa-Francorchamps - Grand Prix"
  const base = trackName.split(" - ")[0].trim();
  if (TRACK_PHOTOS[base]) return TRACK_PHOTOS[base];

  return undefined;
}
