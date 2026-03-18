export interface TrackInfo {
  flag: string;
  country: string;
  imageUrl?: string;
}

export const TRACK_DATA: Record<string, TrackInfo> = {
  // Belgium
  "Circuit de Spa-Francorchamps": { flag: "🇧🇪", country: "Belgium", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Circuit_de_Spa-Francorchamps_en.svg" },
  "Circuit Zolder": { flag: "🇧🇪", country: "Belgium", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Zolder.svg" },
  // Italy
  "Autodromo Nazionale Monza": { flag: "🇮🇹", country: "Italy", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Autodromo_Nazionale_Monza_track_map.svg" },
  "Autodromo Internazionale Enzo e Dino Ferrari": { flag: "🇮🇹", country: "Italy", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Imola_circuit_2005.svg" },
  "Autodromo Internazionale del Mugello": { flag: "🇮🇹", country: "Italy", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Mugello_circuit.svg" },
  "Misano World Circuit Marco Simoncelli": { flag: "🇮🇹", country: "Italy", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Misano_World_Circuit.svg" },
  // United Kingdom
  "Silverstone Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Silverstone_Circuit.svg" },
  "Brands Hatch Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Brands_Hatch_circuit.svg" },
  "Donington Park Racing Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Donington_Park.svg" },
  "Oulton Park Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Oulton_Park.svg" },
  "Snetterton Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Snetterton_300.svg" },
  "Cadwell Park Circuit": { flag: "🇬🇧", country: "United Kingdom" },
  "Knockhill Racing Circuit": { flag: "🇬🇧", country: "United Kingdom" },
  "Thruxton Circuit": { flag: "🇬🇧", country: "United Kingdom" },
  "Rockingham Speedway": { flag: "🇬🇧", country: "United Kingdom" },
  // Monaco
  "Circuit de Monaco": { flag: "🇲🇨", country: "Monaco", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Circuit_Monaco.svg" },
  // Spain
  "Circuit de Barcelona-Catalunya": { flag: "🇪🇸", country: "Spain", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Circuit_de_Barcelona_Catalunya.svg" },
  "Circuit de Barcelona Catalunya": { flag: "🇪🇸", country: "Spain", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Circuit_de_Barcelona_Catalunya.svg" },
  "Circuito de Jerez - Ángel Nieto": { flag: "🇪🇸", country: "Spain" },
  "Circuito de Navarra": { flag: "🇪🇸", country: "Spain" },
  "MotorLand Aragón": { flag: "🇪🇸", country: "Spain" },
  // Netherlands
  "Circuit Zandvoort": { flag: "🇳🇱", country: "Netherlands", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Circuit_Zandvoort.svg" },
  "Circuit Park Zandvoort": { flag: "🇳🇱", country: "Netherlands", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Circuit_Zandvoort.svg" },
  // Germany
  "Nürburgring Combined": { flag: "🇩🇪", country: "Germany", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Nürburgring_circuit_2002.svg" },
  "Nürburgring Grand-Prix-Strecke": { flag: "🇩🇪", country: "Germany", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Nürburgring_circuit_2002.svg" },
  "Nürburgring Nordschleife": { flag: "🇩🇪", country: "Germany", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Nürburgring_nordschleife.svg" },
  "Hockenheimring Baden-Württemberg": { flag: "🇩🇪", country: "Germany", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Hockenheim_layout.svg" },
  "Motorsport Arena Oschersleben": { flag: "🇩🇪", country: "Germany" },
  "Sachsenring": { flag: "🇩🇪", country: "Germany" },
  // Austria
  "Red Bull Ring": { flag: "🇦🇹", country: "Austria", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/RedBullRing.svg" },
  // Hungary
  "Hungaroring Circuit": { flag: "🇭🇺", country: "Hungary", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Hungaroring.svg" },
  // France
  "Circuit de Nevers Magny-Cours": { flag: "🇫🇷", country: "France", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Magny_Cours_track_map.svg" },
  "Circuit des 24 Heures du Mans": { flag: "🇫🇷", country: "France", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Circuit_de_la_Sarthe_2008.svg" },
  "Circuit de Lédenon": { flag: "🇫🇷", country: "France" },
  // Canada
  "Circuit Gilles Villeneuve": { flag: "🇨🇦", country: "Canada", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Circuit_Gilles_Villeneuve.svg" },
  "Canadian Tire Motorsports Park": { flag: "🇨🇦", country: "Canada" },
  // USA
  "Circuit of the Americas": { flag: "🇺🇸", country: "USA", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Circuit_of_the_Americas.svg" },
  "Daytona International Speedway": { flag: "🇺🇸", country: "USA" },
  "WeatherTech Raceway Laguna Seca": { flag: "🇺🇸", country: "USA", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Mazda_Raceway_Laguna_Seca.svg" },
  "Road America": { flag: "🇺🇸", country: "USA", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Road_America.svg" },
  "Road Atlanta": { flag: "🇺🇸", country: "USA", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Road_Atlanta.svg" },
  "Watkins Glen International": { flag: "🇺🇸", country: "USA", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Watkins_Glen_circuit.svg" },
  "Sebring International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Sebring_raceway.svg" },
  "Virginia International Raceway": { flag: "🇺🇸", country: "USA" },
  "Indianapolis Motor Speedway": { flag: "🇺🇸", country: "USA" },
  "Mid-Ohio Sports Car Course": { flag: "🇺🇸", country: "USA" },
  "Lime Rock Park": { flag: "🇺🇸", country: "USA" },
  "Portland International Raceway": { flag: "🇺🇸", country: "USA" },
  "Sonoma Raceway": { flag: "🇺🇸", country: "USA" },
  "Long Beach Street Circuit": { flag: "🇺🇸", country: "USA" },
  "Detroit Grand Prix at Belle Isle": { flag: "🇺🇸", country: "USA" },
  "Barber Motorsports Park": { flag: "🇺🇸", country: "USA" },
  "Summit Point Raceway": { flag: "🇺🇸", country: "USA" },
  "Chicago Street Course": { flag: "🇺🇸", country: "USA" },
  "Miami International Autodrome": { flag: "🇺🇸", country: "USA" },
  "New Jersey Motorsports Park": { flag: "🇺🇸", country: "USA" },
  "Charlotte Motor Speedway": { flag: "🇺🇸", country: "USA" },
  "EchoPark Speedway (Atlanta)": { flag: "🇺🇸", country: "USA" },
  "Phoenix Raceway": { flag: "🇺🇸", country: "USA" },
  "Homestead Miami Speedway": { flag: "🇺🇸", country: "USA" },
  "Las Vegas Motor Speedway": { flag: "🇺🇸", country: "USA" },
  "Iowa Speedway": { flag: "🇺🇸", country: "USA" },
  "Kansas Speedway": { flag: "🇺🇸", country: "USA" },
  // Mexico
  "Autódromo Hermanos Rodríguez (Mexico City)": { flag: "🇲🇽", country: "Mexico" },
  // Brazil
  "Autódromo José Carlos Pace": { flag: "🇧🇷", country: "Brazil", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Interlagos.svg" },
  // Japan
  "Suzuka International Racing Course": { flag: "🇯🇵", country: "Japan", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Suzuka_circuit_2005.svg" },
  "Fuji International Speedway": { flag: "🇯🇵", country: "Japan", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Fuji_International_Speedway_circuit.svg" },
  "Mobility Resort Motegi": { flag: "🇯🇵", country: "Japan" },
  "Okayama International Circuit": { flag: "🇯🇵", country: "Japan" },
  "Tsukuba Circuit": { flag: "🇯🇵", country: "Japan" },
  // Australia
  "Mount Panorama Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Mount_Panorama_Circuit.svg" },
  "Phillip Island Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Phillip_Island_Circuit.svg" },
  "Sandown International Motor Raceway": { flag: "🇦🇺", country: "Australia" },
  "Winton Motor Raceway": { flag: "🇦🇺", country: "Australia" },
  "Shell V-Power Motorsport Park at The Bend": { flag: "🇦🇺", country: "Australia" },
  "Oran Park Raceway": { flag: "🇦🇺", country: "Australia" },
  "Adelaide Street Circuit": { flag: "🇦🇺", country: "Australia" },
  // Portugal
  "Algarve International Circuit": { flag: "🇵🇹", country: "Portugal" },
  // Norway
  "Lånkebanen (Hell RX)": { flag: "🇳🇴", country: "Norway" },
  "Rudskogen Motorsenter": { flag: "🇳🇴", country: "Norway" },
};

export function getTrackInfo(track: string): TrackInfo | null {
  if (TRACK_DATA[track]) return TRACK_DATA[track];
  const base = track.split(" - ")[0].trim();
  return TRACK_DATA[base] || null;
}
