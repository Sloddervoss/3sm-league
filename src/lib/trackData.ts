export interface TrackInfo {
  flag: string;
  country: string;
  imageUrl?: string;
}

const WP = "https://upload.wikimedia.org/wikipedia/commons/thumb/";

export const TRACK_DATA: Record<string, TrackInfo> = {
  // Belgium
  "Circuit de Spa-Francorchamps": { flag: "🇧🇪", country: "Belgium", imageUrl: `${WP}5/54/Spa-Francorchamps_of_Belgium.svg/330px-Spa-Francorchamps_of_Belgium.svg.png` },
  "Circuit Zolder": { flag: "🇧🇪", country: "Belgium", imageUrl: `${WP}e/e2/Zolder.svg/330px-Zolder.svg.png` },
  // Italy
  "Autodromo Nazionale Monza": { flag: "🇮🇹", country: "Italy", imageUrl: `${WP}f/f8/Monza_track_map.svg/330px-Monza_track_map.svg.png` },
  "Autodromo Internazionale Enzo e Dino Ferrari": { flag: "🇮🇹", country: "Italy", imageUrl: `${WP}2/22/Imola_2009.svg/330px-Imola_2009.svg.png` },
  "Autodromo Internazionale del Mugello": { flag: "🇮🇹", country: "Italy", imageUrl: `${WP}3/38/Mugello_Racing_Circuit_track_map_15_turns.svg/330px-Mugello_Racing_Circuit_track_map_15_turns.svg.png` },
  "Misano World Circuit Marco Simoncelli": { flag: "🇮🇹", country: "Italy", imageUrl: `${WP}5/56/Misano_World_Circuit.svg/330px-Misano_World_Circuit.svg.png` },
  // United Kingdom
  "Silverstone Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}b/bd/Silverstone_Circuit_2020.png/330px-Silverstone_Circuit_2020.png` },
  "Brands Hatch Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}e/e4/Brands_Hatch.svg/330px-Brands_Hatch.svg.png` },
  "Donington Park Racing Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}0/07/Donington_circuit.svg/330px-Donington_circuit.svg.png` },
  "Oulton Park Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}3/32/Oulton_Park_Circuit_Map_2013.svg/330px-Oulton_Park_Circuit_Map_2013.svg.png` },
  "Snetterton Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}2/26/Snetterton_2011_300_annotated.svg/330px-Snetterton_2011_300_annotated.svg.png` },
  "Cadwell Park Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}6/67/Cadwell_Park_track_map.svg/330px-Cadwell_Park_track_map.svg.png` },
  "Knockhill Racing Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Knockhill_track_map.svg/330px-Knockhill_track_map.svg.png" },
  "Thruxton Circuit": { flag: "🇬🇧", country: "United Kingdom", imageUrl: `${WP}4/46/Thuxton_Motor_Racing_Circuit_map.svg/330px-Thuxton_Motor_Racing_Circuit_map.svg.png` },
  "Rockingham Speedway": { flag: "🇬🇧", country: "United Kingdom", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Rockingham_Motor_Speedway.svg/330px-Rockingham_Motor_Speedway.svg.png" },
  // Monaco
  "Circuit de Monaco": { flag: "🇲🇨", country: "Monaco", imageUrl: `${WP}3/36/Monte_Carlo_Formula_1_track_map.svg/330px-Monte_Carlo_Formula_1_track_map.svg.png` },
  // Spain
  "Circuit de Barcelona-Catalunya": { flag: "🇪🇸", country: "Spain", imageUrl: `${WP}8/87/Circuit_de_Catalunya_moto_2021.svg/330px-Circuit_de_Catalunya_moto_2021.svg.png` },
  "Circuit de Barcelona Catalunya": { flag: "🇪🇸", country: "Spain", imageUrl: `${WP}8/87/Circuit_de_Catalunya_moto_2021.svg/330px-Circuit_de_Catalunya_moto_2021.svg.png` },
  "Circuito de Jerez - Ángel Nieto": { flag: "🇪🇸", country: "Spain", imageUrl: `${WP}a/aa/Circuito_de_Jerez_v2.svg/330px-Circuito_de_Jerez_v2.svg.png` },
  "Circuito de Navarra": { flag: "🇪🇸", country: "Spain", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Circuito_de_Navarra_2024.svg/330px-Circuito_de_Navarra_2024.svg.png" },
  "MotorLand Aragón": { flag: "🇪🇸", country: "Spain", imageUrl: `${WP}2/2c/Motorland_Arag%C3%B3n_FIA.svg/330px-Motorland_Arag%C3%B3n_FIA.svg.png` },
  // Netherlands
  "Circuit Zandvoort": { flag: "🇳🇱", country: "Netherlands", imageUrl: `${WP}7/78/Zandvoort_Circuit.png/330px-Zandvoort_Circuit.png` },
  "Circuit Park Zandvoort": { flag: "🇳🇱", country: "Netherlands", imageUrl: `${WP}7/78/Zandvoort_Circuit.png/330px-Zandvoort_Circuit.png` },
  // Germany
  "Nürburgring Combined": { flag: "🇩🇪", country: "Germany", imageUrl: `${WP}3/36/Circuit_N%C3%BCrburgring-2013-GP.svg/330px-Circuit_N%C3%BCrburgring-2013-GP.svg.png` },
  "Nürburgring Grand-Prix-Strecke": { flag: "🇩🇪", country: "Germany", imageUrl: `${WP}3/36/Circuit_N%C3%BCrburgring-2013-GP.svg/330px-Circuit_N%C3%BCrburgring-2013-GP.svg.png` },
  "Nürburgring Nordschleife": { flag: "🇩🇪", country: "Germany", imageUrl: `${WP}1/1c/N%C3%BCrburgring_-_Nordschleife.svg/330px-N%C3%BCrburgring_-_Nordschleife.svg.png` },
  "Hockenheimring Baden-Württemberg": { flag: "🇩🇪", country: "Germany", imageUrl: `${WP}7/7e/Hockenheim_2002.png/330px-Hockenheim_2002.png` },
  "Motorsport Arena Oschersleben": { flag: "🇩🇪", country: "Germany", imageUrl: `${WP}5/50/Motorsport_Arena_Oschersleben.svg/330px-Motorsport_Arena_Oschersleben.svg.png` },
  "Sachsenring": { flag: "🇩🇪", country: "Germany", imageUrl: `${WP}8/8e/Sachsenring.svg/330px-Sachsenring.svg.png` },
  // Austria
  "Red Bull Ring": { flag: "🇦🇹", country: "Austria", imageUrl: `${WP}3/36/Red_Bull_Ring_moto_2022.svg/330px-Red_Bull_Ring_moto_2022.svg.png` },
  // Hungary
  "Hungaroring Circuit": { flag: "🇭🇺", country: "Hungary", imageUrl: `${WP}9/91/Hungaroring.svg/330px-Hungaroring.svg.png` },
  // France
  "Circuit de Nevers Magny-Cours": { flag: "🇫🇷", country: "France", imageUrl: `${WP}8/87/Circuit_de_Nevers_Magny-Cours.svg/330px-Circuit_de_Nevers_Magny-Cours.svg.png` },
  "Circuit des 24 Heures du Mans": { flag: "🇫🇷", country: "France", imageUrl: `${WP}b/ba/Circuit_de_la_Sarthe_track_map.svg/330px-Circuit_de_la_Sarthe_track_map.svg.png` },
  "Circuit de Lédenon": { flag: "🇫🇷", country: "France", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Circuit_Ledenon.svg/330px-Circuit_Ledenon.svg.png" },
  // Canada
  "Circuit Gilles Villeneuve": { flag: "🇨🇦", country: "Canada", imageUrl: `${WP}f/f9/%C3%8Ele_Notre-Dame_%28Circuit_Gilles_Villeneuve%29.svg/330px-%C3%8Ele_Notre-Dame_%28Circuit_Gilles_Villeneuve%29.svg.png` },
  "Canadian Tire Motorsports Park": { flag: "🇨🇦", country: "Canada", imageUrl: `${WP}5/51/Mosport-CTMP.svg/330px-Mosport-CTMP.svg.png` },
  // USA
  "Circuit of the Americas": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}a/a5/Austin_circuit.svg/330px-Austin_circuit.svg.png` },
  "Daytona International Speedway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}a/a0/Daytona_International_Speedway_2024.svg/330px-Daytona_International_Speedway_2024.svg.png` },
  "WeatherTech Raceway Laguna Seca": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}5/57/Laguna_Seca.svg/330px-Laguna_Seca.svg.png` },
  "Road America": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}9/9f/Road_America.svg/330px-Road_America.svg.png` },
  "Road Atlanta": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}8/8a/Road_Atlanta_track_map.svg/330px-Road_Atlanta_track_map.svg.png` },
  "Watkins Glen International": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}6/6a/Watkins_Glen_International_Long_Circuit_2024.svg/330px-Watkins_Glen_International_Long_Circuit_2024.svg.png` },
  "Sebring International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}4/45/Sebring_International_Raceway.svg/330px-Sebring_International_Raceway.svg.png` },
  "Virginia International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}4/46/Virginia_International_Raceway_-_Full_Course.svg/330px-Virginia_International_Raceway_-_Full_Course.svg.png` },
  "Indianapolis Motor Speedway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}6/63/Indianapolis_Motor_Speedway_Road_Course_2024.svg/330px-Indianapolis_Motor_Speedway_Road_Course_2024.svg.png` },
  "Mid-Ohio Sports Car Course": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}1/1f/Mid-Ohio.svg/330px-Mid-Ohio.svg.png` },
  "Lime Rock Park": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}9/93/Lime_Rock_Park.svg/330px-Lime_Rock_Park.svg.png` },
  "Portland International Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}e/eb/Portland_international_raceway.svg/330px-Portland_international_raceway.svg.png` },
  "Sonoma Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}b/b8/Sonoma_Raceway_2024.svg/330px-Sonoma_Raceway_2024.svg.png` },
  "Long Beach Street Circuit": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Long_Beach_Street_Circuit_IndyCar.svg/330px-Long_Beach_Street_Circuit_IndyCar.svg.png" },
  "Detroit Grand Prix at Belle Isle": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Detroit_Grand_Prix_on_Belle_Isle_1998-2001.svg/330px-Detroit_Grand_Prix_on_Belle_Isle_1998-2001.svg.png" },
  "Barber Motorsports Park": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}1/1c/Barber_Motorsports_Park.svg/330px-Barber_Motorsports_Park.svg.png` },
  "Summit Point Raceway": { flag: "🇺🇸", country: "USA", imageUrl: `${WP}0/08/Summit_Point_-_Original_Track.svg/330px-Summit_Point_-_Original_Track.svg.png` },
  "Chicago Street Course": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Chicago_Street_Course.svg/330px-Chicago_Street_Course.svg.png" },
  "Miami International Autodrome": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Hard_Rock_Stadium_Circuit_2022.svg/330px-Hard_Rock_Stadium_Circuit_2022.svg.png" },
  "New Jersey Motorsports Park": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/7/79/NJMP_Lightning.png" },
  "Charlotte Motor Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Charlotte_Motor_Speedway_2024.svg/330px-Charlotte_Motor_Speedway_2024.svg.png" },
  "EchoPark Speedway (Atlanta)": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Atlanta_Motor_Speedway_2024.svg/330px-Atlanta_Motor_Speedway_2024.svg.png" },
  "Phoenix Raceway": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Phoenix_Raceway_2024.svg/330px-Phoenix_Raceway_2024.svg.png" },
  "Homestead Miami Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Homestead_Miami_Speedway_2024.svg/330px-Homestead_Miami_Speedway_2024.svg.png" },
  "Las Vegas Motor Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Las_Vegas_Motor_Speedway_2024.svg/330px-Las_Vegas_Motor_Speedway_2024.svg.png" },
  "Iowa Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Iowa_Speedway_2024.svg/330px-Iowa_Speedway_2024.svg.png" },
  "Kansas Speedway": { flag: "🇺🇸", country: "USA", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Kansas_Speedway_2024.svg/330px-Kansas_Speedway_2024.svg.png" },
  // Mexico
  "Autódromo Hermanos Rodríguez (Mexico City)": { flag: "🇲🇽", country: "Mexico", imageUrl: `${WP}e/ef/Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez.svg/330px-Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez.svg.png` },
  // Brazil
  "Autódromo José Carlos Pace": { flag: "🇧🇷", country: "Brazil", imageUrl: `${WP}c/cf/Aut%C3%B3dromo_Jos%C3%A9_Carlos_Pace_%28AKA_Interlagos%29_track_map.svg/330px-Aut%C3%B3dromo_Jos%C3%A9_Carlos_Pace_%28AKA_Interlagos%29_track_map.svg.png` },
  // Japan
  "Suzuka International Racing Course": { flag: "🇯🇵", country: "Japan", imageUrl: `${WP}e/ec/Suzuka_circuit_map--2005.svg/330px-Suzuka_circuit_map--2005.svg.png` },
  "Fuji International Speedway": { flag: "🇯🇵", country: "Japan", imageUrl: `${WP}2/2c/Fuji.svg/330px-Fuji.svg.png` },
  "Mobility Resort Motegi": { flag: "🇯🇵", country: "Japan", imageUrl: `${WP}3/3e/Twin_Ring_Motegi_map-2.svg/330px-Twin_Ring_Motegi_map-2.svg.png` },
  "Okayama International Circuit": { flag: "🇯🇵", country: "Japan", imageUrl: `${WP}b/b4/Circuit_TI_%28Aida%29.png/330px-Circuit_TI_%28Aida%29.png` },
  "Tsukuba Circuit": { flag: "🇯🇵", country: "Japan", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Tsukuba-circuit.svg/330px-Tsukuba-circuit.svg.png" },
  // Australia
  "Mount Panorama Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: `${WP}d/df/Mount_Panorama_Circuit_Map_Overview.PNG/330px-Mount_Panorama_Circuit_Map_Overview.PNG` },
  "Phillip Island Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: `${WP}8/88/Phillip_Island_Grand_Prix_Circuit_v2022.svg/330px-Phillip_Island_Grand_Prix_Circuit_v2022.svg.png` },
  "Sandown International Motor Raceway": { flag: "🇦🇺", country: "Australia", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Sandown_%28Australia%29_track_map.svg/330px-Sandown_%28Australia%29_track_map.svg.png" },
  "Winton Motor Raceway": { flag: "🇦🇺", country: "Australia", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Winton_Motor_Raceway_%28Australia%29_track_map_--_with_extension.svg/330px-Winton_Motor_Raceway_%28Australia%29_track_map_--_with_extension.svg.png" },
  "Shell V-Power Motorsport Park at The Bend": { flag: "🇦🇺", country: "Australia", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/The_Bend_Motorsport_Park_layout_%28International%29.svg/330px-The_Bend_Motorsport_Park_layout_%28International%29.svg.png" },
  "Oran Park Raceway": { flag: "🇦🇺", country: "Australia", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Track_map_for_Oran_Park--Grand_Prix_circuit.svg/330px-Track_map_for_Oran_Park--Grand_Prix_circuit.svg.png" },
  "Adelaide Street Circuit": { flag: "🇦🇺", country: "Australia", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Adelaide_%28short_route%29.svg/330px-Adelaide_%28short_route%29.svg.png" },
  // Portugal
  "Algarve International Circuit": { flag: "🇵🇹", country: "Portugal", imageUrl: `${WP}0/0a/Aut%C3%B3dromo_do_Algarve_F1_Sectors.svg/330px-Aut%C3%B3dromo_do_Algarve_F1_Sectors.svg.png` },
  // Norway
  "Lånkebanen (Hell RX)": { flag: "🇳🇴", country: "Norway", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/L%C3%A5nkebanen_map.svg/330px-L%C3%A5nkebanen_map.svg.png" },
  "Rudskogen Motorsenter": { flag: "🇳🇴", country: "Norway", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Banetegning-rudskogen.jpg/330px-Banetegning-rudskogen.jpg" },
};

export function getTrackInfo(track: string): TrackInfo | null {
  if (TRACK_DATA[track]) return TRACK_DATA[track];
  const base = track.split(" - ")[0].trim();
  return TRACK_DATA[base] || null;
}
