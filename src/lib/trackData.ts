export interface TrackInfo {
  flag: string;
  country: string;
  imageUrl?: string;
}

const WM = "https://commons.wikimedia.org/wiki/Special:FilePath/";
const WP = "https://upload.wikimedia.org/wikipedia/commons/thumb/";

export const TRACK_DATA: Record<string, TrackInfo> = {
  // Belgium
  "Circuit de Spa-Francorchamps": { flag: "🇧🇪", country: "Belgium", imageUrl: `${WP}5/54/Spa-Francorchamps_of_Belgium.svg/330px-Spa-Francorchamps_of_Belgium.svg.png` },
  "Circuit Zolder": { flag: "🇧🇪", country: "Belgium", imageUrl: `${WP}e/e2/Zolder.svg/330px-Zolder.svg.png` },
  // Italy
  "Autodromo Nazionale Monza": { flag: "🇮🇹", country: "Italy", imageUrl: `${WM}Autodromo_Nazionale_Monza_track_map.svg` },
  "Autodromo Internazionale Enzo e Dino Ferrari": { flag: "🇮🇹", country: "Italy", imageUrl: `${WP}2/22/Imola_2009.svg/330px-Imola_2009.svg.png` },
  "Autodromo Internazionale del Mugello": { flag: "🇮🇹", country: "Italy", imageUrl: `${WP}3/38/Mugello_Racing_Circuit_track_map_15_turns.svg/330px-Mugello_Racing_Circuit_track_map_15_turns.svg.png` },
  "Misano World Circuit Marco Simoncelli": { flag: "🇮🇹", country: "Italy", imageUrl: `${WP}5/56/Misano_World_Circuit.svg/330px-Misano_World_Circuit.svg.png` },
  // United Kingdom
  "Silverstone Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}b/bd/Silverstone_Circuit_2020.png/330px-Silverstone_Circuit_2020.png` },
  "Brands Hatch Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WM}Brands_Hatch_circuit.svg` },
  "Donington Park Racing Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}0/07/Donington_circuit.svg/330px-Donington_circuit.svg.png` },
  "Oulton Park Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}3/32/Oulton_Park_Circuit_Map_2013.svg/330px-Oulton_Park_Circuit_Map_2013.svg.png` },
  "Snetterton Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}2/26/Snetterton_2011_300_annotated.svg/330px-Snetterton_2011_300_annotated.svg.png` },
  "Cadwell Park Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WM}Cadwell_Park_circuit.svg` },
  "Knockhill Racing Circuit": { flag: "🇬🇧", country: "United Kingdom" },
  "Thruxton Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WM}Thruxton_circuit.svg` },
  "Rockingham Speedway": { flag: "🇬🇧", country: "United Kingdom" },
  // Monaco
  "Circuit de Monaco": { flag: "🇲🇨", country: "Monaco", imageUrl: `${WP}3/36/Monte_Carlo_Formula_1_track_map.svg/330px-Monte_Carlo_Formula_1_track_map.svg.png` },
  // Spain
  "Circuit de Barcelona-Catalunya": { flag: "🇪🇸", country: "Spain", imageUrl: `${WP}8/87/Circuit_de_Catalunya_moto_2021.svg/330px-Circuit_de_Catalunya_moto_2021.svg.png` },
  "Circuit de Barcelona Catalunya": { flag: "🇪🇸", country: "Spain", imageUrl: `${WP}8/87/Circuit_de_Catalunya_moto_2021.svg/330px-Circuit_de_Catalunya_moto_2021.svg.png` },
  "Circuito de Jerez - Ángel Nieto": { flag: "🇪🇸", country: "Spain", imageUrl: `${WP}a/aa/Circuito_de_Jerez_v2.svg/330px-Circuito_de_Jerez_v2.svg.png` },
  "Circuito de Navarra": { flag: "🇪🇸", country: "Spain" },
  "MotorLand Aragón": { flag: "🇪🇸", country: "Spain", imageUrl: `${WM}Motorland_Aragon_track_map.svg` },
  // Netherlands
  "Circuit Zandvoort": { flag: "🇳🇱", country: "Netherlands", imageUrl: `${WM}Circuit_Zandvoort.svg` },
  "Circuit Park Zandvoort": { flag: "🇳🇱", country: "Netherlands", imageUrl: `${WM}Circuit_Zandvoort.svg` },
  // Germany
  "Nürburgring Combined": { flag: "🇩🇪", country: "Germany", imageUrl: `${WM}N%C3%BCrburgring_circuit_2002.svg` },
  "Nürburgring Grand-Prix-Strecke": { flag: "🇩🇪", country: "Germany", imageUrl: `${WM}N%C3%BCrburgring_circuit_2002.svg` },
  "Nürburgring Nordschleife": { flag: "🇩🇪", country: "Germany", imageUrl: `${WM}N%C3%BCrburgring_nordschleife.svg` },
  "Hockenheimring Baden-Württemberg": { flag: "🇩🇪", country: "Germany", imageUrl: `${WM}Hockenheim_layout.svg` },
  "Motorsport Arena Oschersleben": { flag: "🇩🇪", country: "Germany", imageUrl: `${WM}Motorsport_Arena_Oschersleben.svg` },
  "Sachsenring": { flag: "🇩🇪", country: "Germany", imageUrl: `${WM}Sachsenring_circuit.svg` },
  // Austria
  "Red Bull Ring": { flag: "🇦🇹", country: "Austria", imageUrl: `${WM}RedBullRing.svg` },
  // Hungary
  "Hungaroring Circuit": { flag: "🇭🇺", country: "Hungary", imageUrl: `${WM}Hungaroring.svg` },
  // France
  "Circuit de Nevers Magny-Cours": { flag: "🇫🇷", country: "France", imageUrl: `${WP}8/87/Circuit_de_Nevers_Magny-Cours.svg/330px-Circuit_de_Nevers_Magny-Cours.svg.png` },
  "Circuit des 24 Heures du Mans": { flag: "🇫🇷", country: "France", imageUrl: `${WM}Circuit_de_la_Sarthe_2008.svg` },
  "Circuit de Lédenon": { flag: "🇫🇷", country: "France" },
  // Canada
  "Circuit Gilles Villeneuve": { flag: "🇨🇦", country: "Canada", imageUrl: `${WP}f/f9/%C3%8Ele_Notre-Dame_%28Circuit_Gilles_Villeneuve%29.svg/330px-%C3%8Ele_Notre-Dame_%28Circuit_Gilles_Villeneuve%29.svg.png` },
  "Canadian Tire Motorsports Park": { flag: "🇨🇦", country: "Canada", imageUrl: `${WP}5/51/Mosport-CTMP.svg/330px-Mosport-CTMP.svg.png` },
  // USA
  "Circuit of the Americas": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}a/a5/Austin_circuit.svg/330px-Austin_circuit.svg.png` },
  "Daytona International Speedway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}a/a0/Daytona_International_Speedway_2024.svg/330px-Daytona_International_Speedway_2024.svg.png` },
  "WeatherTech Raceway Laguna Seca": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}5/57/Laguna_Seca.svg/330px-Laguna_Seca.svg.png` },
  "Road America": { flag: "🇺🇸", country: "USA", imageUrl: `${WM}Road_America.svg` },
  "Road Atlanta": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}8/8a/Road_Atlanta_track_map.svg/330px-Road_Atlanta_track_map.svg.png` },
  "Watkins Glen International": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}6/6a/Watkins_Glen_International_Long_Circuit_2024.svg/330px-Watkins_Glen_International_Long_Circuit_2024.svg.png` },
  "Sebring International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}4/45/Sebring_International_Raceway.svg/330px-Sebring_International_Raceway.svg.png` },
  "Virginia International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}4/46/Virginia_International_Raceway_-_Full_Course.svg/330px-Virginia_International_Raceway_-_Full_Course.svg.png` },
  "Indianapolis Motor Speedway": { flag: "🇺🇸", country: "USA", imageUrl: `${WM}Indianapolis_Motor_Speedway_road_course.svg` },
  "Mid-Ohio Sports Car Course": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}1/1f/Mid-Ohio.svg/330px-Mid-Ohio.svg.png` },
  "Lime Rock Park": { flag: "🇺🇸", country: "USA", imageUrl: `${WM}Lime_Rock_Park_track_map.svg` },
  "Portland International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}e/eb/Portland_international_raceway.svg/330px-Portland_international_raceway.svg.png` },
  "Sonoma Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}b/b8/Sonoma_Raceway_2024.svg/330px-Sonoma_Raceway_2024.svg.png` },
  "Long Beach Street Circuit": { flag: "🇺🇸", country: "USA" },
  "Detroit Grand Prix at Belle Isle": { flag: "🇺🇸", country: "USA" },
  "Barber Motorsports Park": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}1/1c/Barber_Motorsports_Park.svg/330px-Barber_Motorsports_Park.svg.png` },
  "Summit Point Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}0/08/Summit_Point_-_Original_Track.svg/330px-Summit_Point_-_Original_Track.svg.png` },
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
  "Autódromo Hermanos Rodríguez (Mexico City)": { flag: "🇲🇽", country: "Mexico", imageUrl: `${WM}Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez_track_map.svg` },
  // Brazil
  "Autódromo José Carlos Pace": { flag: "🇧🇷", country: "Brazil", imageUrl: `${WP}c/cf/Aut%C3%B3dromo_Jos%C3%A9_Carlos_Pace_%28AKA_Interlagos%29_track_map.svg/330px-Aut%C3%B3dromo_Jos%C3%A9_Carlos_Pace_%28AKA_Interlagos%29_track_map.svg.png` },
  // Japan
  "Suzuka International Racing Course": { flag: "🇯🇵", country: "Japan", imageUrl: `${WP}e/ec/Suzuka_circuit_map--2005.svg/330px-Suzuka_circuit_map--2005.svg.png` },
  "Fuji International Speedway": { flag: "🇯🇵", country: "Japan", imageUrl: `${WP}2/2c/Fuji.svg/330px-Fuji.svg.png` },
  "Mobility Resort Motegi": { flag: "🇯🇵", country: "Japan", imageUrl: `${WM}Motegi_circuit_map.svg` },
  "Okayama International Circuit": { flag: "🇯🇵", country: "Japan", imageUrl: `${WP}b/b4/Circuit_TI_%28Aida%29.png/330px-Circuit_TI_%28Aida%29.png` },
  "Tsukuba Circuit": { flag: "🇯🇵", country: "Japan" },
  // Australia
  "Mount Panorama Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: `${WP}d/df/Mount_Panorama_Circuit_Map_Overview.PNG/330px-Mount_Panorama_Circuit_Map_Overview.PNG` },
  "Phillip Island Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: `${WP}8/88/Phillip_Island_Grand_Prix_Circuit_v2022.svg/330px-Phillip_Island_Grand_Prix_Circuit_v2022.svg.png` },
  "Sandown International Motor Raceway": { flag: "🇦🇺", country: "Australia" },
  "Winton Motor Raceway": { flag: "🇦🇺", country: "Australia" },
  "Shell V-Power Motorsport Park at The Bend": { flag: "🇦🇺", country: "Australia" },
  "Oran Park Raceway": { flag: "🇦🇺", country: "Australia" },
  "Adelaide Street Circuit": { flag: "🇦🇺", country: "Australia" },
  // Portugal
  "Algarve International Circuit": { flag: "🇵🇹", country: "Portugal", imageUrl: `${WP}0/0a/Aut%C3%B3dromo_do_Algarve_F1_Sectors.svg/330px-Aut%C3%B3dromo_do_Algarve_F1_Sectors.svg.png` },
  // Norway
  "Lånkebanen (Hell RX)": { flag: "🇳🇴", country: "Norway" },
  "Rudskogen Motorsenter": { flag: "🇳🇴", country: "Norway" },
};

export function getTrackInfo(track: string): TrackInfo | null {
  if (TRACK_DATA[track]) return TRACK_DATA[track];
  const base = track.split(" - ")[0].trim();
  return TRACK_DATA[base] || null;
}
