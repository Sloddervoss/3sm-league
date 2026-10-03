export interface TrackInfo {
  flag: string;
  country: string;
  imageUrl?: string;
}


export const TRACK_DATA: Record<string, TrackInfo> = {
  // Belgium
  "Circuit de Spa-Francorchamps": { flag: "🇧🇪", country: "Belgium", imageUrl: "/tracks/wiki/spa-francorchamps-of-belgium.png" },
  "Circuit Zolder": { flag: "🇧🇪", country: "Belgium", imageUrl: "/tracks/wiki/zolder.png" },
  // Italy
  "Autodromo Nazionale Monza": { flag: "🇮🇹", country: "Italy", imageUrl: "/tracks/wiki/monza-track-map.png" },
  "Autodromo Internazionale Enzo e Dino Ferrari": { flag: "🇮🇹", country: "Italy", imageUrl: "/tracks/wiki/imola-2009.png" },
  "Autodromo Internazionale del Mugello": { flag: "🇮🇹", country: "Italy", imageUrl: "/tracks/wiki/mugello-racing-circuit-track-map-15-turns.png" },
  "Misano World Circuit Marco Simoncelli": { flag: "🇮🇹", country: "Italy", imageUrl: "/tracks/wiki/misano-world-circuit.png" },
  // United Kingdom
  "Silverstone Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "/tracks/wiki/silverstone-circuit-2020.png" },
  "Brands Hatch Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "/tracks/wiki/brands-hatch.png" },
  "Donington Park Racing Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "/tracks/wiki/donington-circuit.png" },
  "Oulton Park Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "/tracks/wiki/oulton-park-circuit-map-2013.png" },
  "Snetterton Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "/tracks/wiki/snetterton-2011-300-annotated.png" },
  "Cadwell Park Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "/tracks/wiki/cadwell-park-track-map.png" },
  "Knockhill Racing Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "/tracks/wiki/knockhill-track-map.png" },
  "Thruxton Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "/tracks/wiki/thuxton-motor-racing-circuit-map.png" },
  "Rockingham Speedway": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "/tracks/wiki/rockingham-motor-speedway.png" },
  // Monaco
  "Circuit de Monaco": { flag: "🇲🇨", country: "Monaco", imageUrl: "/tracks/wiki/monte-carlo-formula-1-track-map.png" },
  // Spain
  "Circuit de Barcelona-Catalunya": { flag: "🇪🇸", country: "Spain", imageUrl: "/tracks/wiki/circuit-de-catalunya-moto-2021.png" },
  "Circuit de Barcelona Catalunya": { flag: "🇪🇸", country: "Spain", imageUrl: "/tracks/wiki/circuit-de-catalunya-moto-2021.png" },
  "Circuito de Jerez - Ángel Nieto": { flag: "🇪🇸", country: "Spain", imageUrl: "/tracks/wiki/circuito-de-jerez-v2.png" },
  "Circuito de Navarra": { flag: "🇪🇸", country: "Spain", imageUrl: "/tracks/wiki/circuito-de-navarra-2024.png" },
  "MotorLand Aragón": { flag: "🇪🇸", country: "Spain", imageUrl: "/tracks/wiki/motorland-aragon-fia.png" },
  // Netherlands
  "Circuit Zandvoort": { flag: "🇳🇱", country: "Netherlands", imageUrl: "/tracks/wiki/zandvoort-circuit.png" },
  "Circuit Park Zandvoort": { flag: "🇳🇱", country: "Netherlands", imageUrl: "/tracks/wiki/zandvoort-circuit.png" },
  // Germany
  "Nürburgring Combined": { flag: "🇩🇪", country: "Germany", imageUrl: "/tracks/wiki/circuit-nurburgring-2013-gp.png" },
  "Nürburgring Grand-Prix-Strecke": { flag: "🇩🇪", country: "Germany", imageUrl: "/tracks/wiki/circuit-nurburgring-2013-gp.png" },
  "Nürburgring Nordschleife": { flag: "🇩🇪", country: "Germany", imageUrl: "/tracks/wiki/nurburgring-nordschleife.png" },
  "Hockenheimring Baden-Württemberg": { flag: "🇩🇪", country: "Germany", imageUrl: "/tracks/wiki/hockenheim-2002.png" },
  "Motorsport Arena Oschersleben": { flag: "🇩🇪", country: "Germany", imageUrl: "/tracks/wiki/motorsport-arena-oschersleben.png" },
  "Sachsenring": { flag: "🇩🇪", country: "Germany", imageUrl: "/tracks/wiki/sachsenring.png" },
  // Austria
  "Red Bull Ring": { flag: "🇦🇹", country: "Austria", imageUrl: "/tracks/wiki/red-bull-ring-moto-2022.png" },
  // Hungary
  "Hungaroring Circuit": { flag: "🇭🇺", country: "Hungary", imageUrl: "/tracks/wiki/hungaroring.png" },
  // France
  "Circuit de Nevers Magny-Cours": { flag: "🇫🇷", country: "France", imageUrl: "/tracks/wiki/circuit-de-nevers-magny-cours.png" },
  "Circuit des 24 Heures du Mans": { flag: "🇫🇷", country: "France", imageUrl: "/tracks/wiki/circuit-de-la-sarthe-track-map.png" },
  "Circuit de Lédenon": { flag: "🇫🇷", country: "France", imageUrl: "/tracks/wiki/circuit-ledenon.png" },
  // Canada
  "Circuit Gilles Villeneuve": { flag: "🇨🇦", country: "Canada", imageUrl: "/tracks/wiki/ile-notre-dame-circuit-gilles-villeneuve.png" },
  "Canadian Tire Motorsports Park": { flag: "🇨🇦", country: "Canada", imageUrl: "/tracks/wiki/mosport-ctmp.png" },
  // USA
  "Circuit of the Americas": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/austin-circuit.png" },
  "Daytona International Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/daytona-international-speedway-2024.png" },
  "WeatherTech Raceway Laguna Seca": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/laguna-seca.png" },
  "Road America": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/road-america.png" },
  "Road Atlanta": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/road-atlanta-track-map.png" },
  "Watkins Glen International": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/watkins-glen-international-long-circuit-2024.png" },
  "Sebring International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/sebring-international-raceway.png" },
  "Virginia International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/virginia-international-raceway-full-course.png" },
  "Indianapolis Motor Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/indianapolis-motor-speedway-road-course-2024.png" },
  "Mid-Ohio Sports Car Course": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/mid-ohio.png" },
  "Lime Rock Park": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/lime-rock-park.png" },
  "Portland International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/portland-international-raceway.png" },
  "Sonoma Raceway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/sonoma-raceway-2024.png" },
  "Long Beach Street Circuit": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/long-beach-street-circuit-indycar.png" },
  "Detroit Grand Prix at Belle Isle": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/detroit-grand-prix-on-belle-isle-1998-2001.png" },
  "Barber Motorsports Park": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/barber-motorsports-park.png" },
  "Summit Point Raceway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/summit-point-original-track.png" },
  "Chicago Street Course": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/chicago-street-course.png" },
  "Miami International Autodrome": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/hard-rock-stadium-circuit-2022.png" },
  "New Jersey Motorsports Park": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/njmp-lightning.png" },
  "Charlotte Motor Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/charlotte-motor-speedway-2024.png" },
  "EchoPark Speedway (Atlanta)": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/atlanta-motor-speedway-2024.png" },
  "Phoenix Raceway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/phoenix-raceway-2024.png" },
  "Homestead Miami Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/homestead-miami-speedway-2024.png" },
  "Las Vegas Motor Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/las-vegas-motor-speedway-2024.png" },
  "Iowa Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/iowa-speedway-2024.png" },
  "Kansas Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "/tracks/wiki/kansas-speedway-2024.png" },
  // Mexico
  "Autódromo Hermanos Rodríguez (Mexico City)": { flag: "🇲🇽", country: "Mexico", imageUrl: "/tracks/wiki/autodromo-hermanos-rodriguez.png" },
  // Brazil
  "Autódromo José Carlos Pace": { flag: "🇧🇷", country: "Brazil", imageUrl: "/tracks/wiki/autodromo-jose-carlos-pace-aka-interlagos-track-map.png" },
  // Japan
  "Suzuka International Racing Course": { flag: "🇯🇵", country: "Japan", imageUrl: "/tracks/wiki/suzuka-circuit-map-2005.png" },
  "Fuji International Speedway": { flag: "🇯🇵", country: "Japan", imageUrl: "/tracks/wiki/fuji.png" },
  "Mobility Resort Motegi": { flag: "🇯🇵", country: "Japan", imageUrl: "/tracks/wiki/twin-ring-motegi-map-2.png" },
  "Okayama International Circuit": { flag: "🇯🇵", country: "Japan", imageUrl: "/tracks/wiki/circuit-ti-aida.png" },
  "Tsukuba Circuit": { flag: "🇯🇵", country: "Japan", imageUrl: "/tracks/wiki/tsukuba-circuit.png" },
  // Australia
  "Mount Panorama Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: "/tracks/wiki/mount-panorama-circuit-map-overview.png" },
  "Phillip Island Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: "/tracks/wiki/phillip-island-grand-prix-circuit-v2022.png" },
  "Sandown International Motor Raceway": { flag: "🇦🇺", country: "Australia", imageUrl: "/tracks/wiki/sandown-australia-track-map.png" },
  "Winton Motor Raceway": { flag: "🇦🇺", country: "Australia", imageUrl: "/tracks/wiki/winton-motor-raceway-australia-track-map-with-extension.png" },
  "Shell V-Power Motorsport Park at The Bend": { flag: "🇦🇺", country: "Australia", imageUrl: "/tracks/wiki/the-bend-motorsport-park-layout-international.png" },
  "Oran Park Raceway": { flag: "🇦🇺", country: "Australia", imageUrl: "/tracks/maps/oran-park-grand-prix.webp" },
  "Adelaide Street Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: "/tracks/wiki/adelaide-short-route.png" },
  // Portugal
  "Algarve International Circuit": { flag: "🇵🇹", country: "Portugal", imageUrl: "/tracks/wiki/autodromo-do-algarve-f1-sectors.png" },
  // Norway
  "Lånkebanen (Hell RX)": { flag: "🇳🇴", country: "Norway", imageUrl: "/tracks/wiki/lankebanen-map.png" },
  "Rudskogen Motorsenter": { flag: "🇳🇴", country: "Norway", imageUrl: "/tracks/wiki/banetegning-rudskogen.png" },
};

export function getTrackInfo(track: string): TrackInfo | null {
  if (TRACK_DATA[track]) return TRACK_DATA[track];
  const base = track.split(" - ")[0].trim();
  return TRACK_DATA[base] || null;
}
