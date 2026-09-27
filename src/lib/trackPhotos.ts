/**
 * trackPhotos.ts — iRacing track photos (lokaal geserveerd)
 * Images gedownload via scripts/fetchIRacingTrackImages.js
 * Opgeslagen in public/tracks/photos/
 */

const PHOTOS: Record<string, string> = {
  // Belgium
  "Circuit de Spa-Francorchamps":                     "/tracks/photos/circuitdespa-francorchamps.webp",
  "Circuit Zolder":                                   "/tracks/photos/circuit-zolder.webp",
  // Italy
  "Autodromo Nazionale Monza":                        "/tracks/photos/monza.webp",
  "Autodromo Internazionale del Mugello":             "/tracks/photos/mugello.webp",
  "Autodromo Internazionale Enzo e Dino Ferrari":     "/tracks/photos/imola.webp",
  "Misano World Circuit Marco Simoncelli":            "/tracks/photos/misano.webp",
  // UK
  "Silverstone Circuit":                              "/tracks/photos/silverstone.webp",
  "Brands Hatch Circuit":                             "/tracks/photos/brandshatchcircuit-sm.webp",
  "Donington Park Racing Circuit":                    "/tracks/photos/update-doningtonpark.webp",
  "Snetterton Circuit":                               "/tracks/photos/snetterton.webp",
  "Oulton Park Circuit":                              "/tracks/photos/oultonpark.webp",
  "Cadwell Park Circuit":                             "/tracks/photos/cadwell.webp",
  "Thruxton Circuit":                                 "/tracks/photos/thruxton.webp",
  "Knockhill Racing Circuit":                         "/tracks/photos/knockhill-racing-circuit.webp",
  "Rockingham Speedway":                              "/tracks/photos/rockingham.webp",
  // Netherlands
  "Circuit Zandvoort":                                "/tracks/photos/circuit-zandvoort.webp",
  "Circuit Park Zandvoort":                           "/tracks/photos/circuit-zandvoort.webp",
  // Germany
  "Nürburgring Combined":                             "/tracks/photos/hock.webp",
  "Nürburgring Grand Prix Circuit":                   "/tracks/photos/hock.webp",
  "Nürburgring Grand-Prix-Strecke":                   "/tracks/photos/hock.webp",
  "Hockenheimring Baden-Württemberg":                 "/tracks/photos/hock.webp",
  "Sachsenring":                                      "/tracks/photos/sachsenring.webp",
  "Motorsport Arena Oschersleben":                    "/tracks/photos/motorsportarenaoschersleben.webp",
  // Austria
  "Red Bull Ring":                                    "/tracks/photos/rbr.webp",
  // Hungary
  "Hungaroring":                                      "/tracks/photos/hungaroring.webp",
  "Hungaroring Circuit":                              "/tracks/photos/hungaroring.webp",
  // Spain
  "Circuit de Barcelona-Catalunya":                   "/tracks/photos/update-circuitdebarcelona.webp",
  "Circuit de Barcelona Catalunya":                   "/tracks/photos/update-circuitdebarcelona.webp",
  "Circuito de Jerez - Ángel Nieto":                  "/tracks/photos/circuitodejerez.webp",
  "Circuito de Navarra":                              "/tracks/photos/navarra-included.webp",
  "MotorLand Aragón":                                 "/tracks/photos/aragon.webp",
  // France
  "Circuit Paul Ricard":                              "/tracks/photos/magnycours.webp",
  "Circuit de Nevers Magny-Cours":                    "/tracks/photos/magnycours.webp",
  "Circuit de la Sarthe":                             "/tracks/photos/24hlemans.webp",
  "Circuit des 24 Heures du Mans":                    "/tracks/photos/24hlemans.webp",
  "Lédenon":                                          "/tracks/photos/circuitdeledenon.webp",
  "Circuit de Lédenon":                               "/tracks/photos/circuitdeledenon.webp",
  // Monaco
  "Circuit de Monaco":                                "/tracks/photos/circuitgillesvilleneuve-sm.webp",
  // USA
  "Indianapolis Motor Speedway":                      "/tracks/photos/indianapolis.webp",
  "Watkins Glen International":                       "/tracks/photos/watkinsglen.webp",
  "Road America":                                     "/tracks/photos/update-roadamerica.webp",
  "WeatherTech Raceway at Laguna Seca":               "/tracks/photos/lagunaseca.webp",
  "WeatherTech Raceway Laguna Seca":                  "/tracks/photos/lagunaseca.webp",
  "Laguna Seca Raceway":                              "/tracks/photos/lagunaseca.webp",
  "Sebring International Raceway":                    "/tracks/photos/sebring.webp",
  "Daytona International Speedway":                   "/tracks/photos/daytona.webp",
  "Circuit of the Americas":                          "/tracks/photos/circuitoftheamericas.webp",
  "Sonoma Raceway":                                   "/tracks/photos/sonoma.webp",
  "Road Atlanta":                                     "/tracks/photos/update-roadatlanta.webp",
  "Barber Motorsports Park":                          "/tracks/photos/barbermotorsportspark-iracing.webp",
  "Detroit Grand Prix at Belle Isle":                 "/tracks/photos/detroit-grand-prix-belle-isle.webp",
  "Nürburgring Nordschleife":                         "/tracks/photos/nurburgring-nordschleife.webp",
  "Virginia International Raceway":                   "/tracks/photos/virginiainternationalraceway.webp",
  "Mid-Ohio Sports Car Course":                       "/tracks/photos/update-midohiosportscarcourse.webp",
  "Summit Point Raceway":                             "/tracks/photos/included-summitpointmotorsportspark.webp",
  "Summit Point Motorsports Park":                    "/tracks/photos/included-summitpointmotorsportspark.webp",
  "Long Beach Street Circuit":                        "/tracks/photos/longbeach.webp",
  "Chicago Street Course":                            "/tracks/photos/chicagostreetcourse.webp",
  "Chicagoland Speedway":                             "/tracks/photos/update-chicagolandspeedway.webp",
  "Phoenix Raceway":                                  "/tracks/photos/phoenix.webp",
  "Homestead-Miami Speedway":                         "/tracks/photos/homestead-miami-speedway.webp",
  "Homestead Miami Speedway":                         "/tracks/photos/homestead-miami-speedway.webp",
  "Kansas Speedway":                                  "/tracks/photos/kansasspeedway.webp",
  "Iowa Speedway":                                    "/tracks/photos/iowa.webp",
  "Lime Rock Park":                                   "/tracks/photos/limerock2019.webp",
  "Miami International Autodrome":                    "/tracks/photos/miami-international-autodrome.webp",
  "Portland International Raceway":                   "/tracks/photos/portland.webp",
  "St. Petersburg Street Circuit":                    "/tracks/photos/st-petersburg.webp",
  "St. Petersburg Grand Prix":                        "/tracks/photos/st-petersburg-grand-prix.webp",
  "Autodromo Hermanos Rodriguez":                     "/tracks/photos/mexicocity.webp",
  "Autódromo Hermanos Rodríguez (Mexico City)":       "/tracks/photos/mexicocity.webp",
  "Charlotte Motor Speedway":                         "/tracks/photos/charlottemotorspeedway.webp",
  "EchoPark Speedway (Atlanta)":                      "/tracks/photos/echoparkspeedway.webp",
  "New Jersey Motorsports Park":                      "/tracks/photos/newjerseymotorsportspark-sm.webp",
  "World Wide Technology Raceway (Gateway)":          "/tracks/photos/worldwidetechnologyraceway.webp",
  "Willow Springs Raceway":                           "/tracks/photos/willow-springs-raceway.webp",
  "Willow Springs International Raceway":             "/tracks/photos/willow-springs-raceway.webp",
  // Japan
  "Mobility Resort Motegi":                           "/tracks/photos/mobilityresortmotegi.webp",
  "Twin Ring Motegi":                                 "/tracks/photos/mobilityresortmotegi.webp",
  "Fuji International Speedway":                      "/tracks/photos/fuji-international-speedway.webp",
  "Suzuka International Racing Course":               "/tracks/photos/suzukainternationracingcourse.webp",
  "Tsukuba Circuit":                                  "/tracks/photos/included-tsukubacircuit.webp",
  // Canada
  "Canadian Tire Motorsports Park":                   "/tracks/photos/canadiantiremotorsportspark-sm.webp",
  "Circuit Gilles Villeneuve":                        "/tracks/photos/circuitgillesvilleneuve-sm.webp",
  // Australia
  "The Bend Motorsport Park":                         "/tracks/photos/the-bend.webp",
  "Shell V-Power Motorsport Park at The Bend":        "/tracks/photos/the-bend.webp",
  "Adelaide Street Circuit":                          "/tracks/photos/adelaide-street-circuit.webp",
  "Sandown Motor Raceway":                            "/tracks/photos/sandown-motor-raceway.webp",
  "Sandown International Motor Raceway":              "/tracks/photos/sandown-motor-raceway.webp",
  "Winton Motor Raceway":                             "/tracks/photos/winton-motor-raceway-included.webp",
  "Phillip Island Circuit":                           "/tracks/photos/phillipisland-sm.webp",
  "Mount Panorama Circuit":                           "/tracks/photos/update-mountpanoramacircuit.webp",
  "Oran Park Raceway":                                "/tracks/photos/included-oranparkraceway.webp",
  // Brazil
  "Autodromo Jose Carlos Pace":                       "/tracks/photos/autodromojosecarlospace.webp",
  "Autódromo José Carlos Pace":                       "/tracks/photos/autodromojosecarlospace.webp",
  // Norway
  "Rudskogen Motorsenter":                            "/tracks/photos/rudskogen-motorsenter.webp",
  "Lånkebanen":                                       "/tracks/photos/update-hellrxlaankebanen.webp",
  "Lånkebanen (Hell RX)":                             "/tracks/photos/update-hellrxlaankebanen.webp",
  // Portugal
  "Autodromo Internacional do Algarve":               "/tracks/photos/algarve.webp",
  "Algarve International Circuit":                    "/tracks/photos/algarve.webp",
  // Japan
  "Okayama International Circuit":                    "/tracks/photos/included-okayamainternationalcircuit.webp",
  // USA — ovals & short tracks
  "Bristol Motor Speedway":                           "/tracks/photos/bristolmotorspeedway-sm.webp",
  "Talladega Superspeedway":                          "/tracks/photos/talladega.webp",
  "Darlington Raceway":                               "/tracks/photos/update-darlingtonraceway.webp",
  "Dover Motor Speedway":                             "/tracks/photos/dover-ms.webp",
  "Pocono Raceway":                                   "/tracks/photos/pocono.webp",
  "Martinsville Speedway":                            "/tracks/photos/martinsville.webp",
  "Richmond Raceway":                                 "/tracks/photos/richmond.webp",
  "Michigan International Speedway":                  "/tracks/photos/michigan.webp",
  "Texas Motor Speedway":                             "/tracks/photos/texasmotorspeedway.webp",
  "Kentucky Speedway":                                "/tracks/photos/kentuckyspeedway-sm.webp",
  "Las Vegas Motor Speedway":                         "/tracks/photos/lasvegasmotorspeedway-sm.webp",
  "Nashville Superspeedway":                          "/tracks/photos/nashvilless.webp",
  "Nashville Fairgrounds Speedway":                   "/tracks/photos/nashvillefairgroundsspeedway.webp",
  "New Hampshire Motor Speedway":                     "/tracks/photos/newhampshiremotorspeedway-sm.webp",
  "New Smyrna Speedway":                              "/tracks/photos/newsmyrnaspeedway-sm.webp",
  "North Wilkesboro Speedway":                        "/tracks/photos/northwilkesborospeedway.webp",
  "The Milwaukee Mile":                               "/tracks/photos/themilwaukeemile-sm.webp",
  "Irwindale Speedway":                               "/tracks/photos/irwindalespeedway-sm.webp",
  "Slinger Speedway":                                 "/tracks/photos/slingerspeedway.webp",
  "South Boston Speedway":                            "/tracks/photos/southbostonspeedway-included.webp",
  "Stafford Motor Speedway":                          "/tracks/photos/staffordmotorspeedway-sm.webp",
  "Lucas Oil Indianapolis Raceway Park":              "/tracks/photos/irp.webp",
  "Lucas Oil Speedway":                               "/tracks/photos/lucas-oil-speedway.webp",
  "Millbridge Speedway":                              "/tracks/photos/millbridgespeedway.webp",
  "Los Angeles Memorial Coliseum":                    "/tracks/photos/la-coliseum.webp",
  "Auto Club Speedway":                               "/tracks/photos/autoclubspeedway-sm1.webp",
  "Daytona Rallycross and Dirt Road":                 "/tracks/photos/daytona-rallycross.webp",
  "The Dirt Track at Charlotte":                      "/tracks/photos/update-thedirttrackatcharlotte.webp",
  "The Bullring":                                     "/tracks/photos/bullring-tile.webp",
  "Volusia Speedway Park":                            "/tracks/photos/volusia-tile.webp",
  "Eldora Speedway":                                  "/tracks/photos/eldora-tile1.webp",
  "Weedsport Speedway":                               "/tracks/photos/weedsport-speedway.webp",
  "Oswego Speedway":                                  "/tracks/photos/oswego.webp",
  "Port Royal Speedway":                              "/tracks/photos/port-royal-speedway.webp",
  "Firebird Motorsports Park":                        "/tracks/photos/firebird-motorsports-park.webp",
  "Wild West Motorsports Park":                       "/tracks/photos/wild-west-motorsports-park.webp",
  "Cedar Lake Speedway":                              "/tracks/photos/cedarlakespeedway.webp",
  "Crandon International Raceway":                    "/tracks/photos/crandoninternationalraceway.webp",
  "Chili Bowl":                                       "/tracks/photos/chilibowl.webp",
  "Fairbury Speedway":                                "/tracks/photos/update-fairburyspeedway.webp",
  "Federated Auto Parts Raceway at I-55":             "/tracks/photos/federated-auto-parts-raceway-at-i-55.webp",
  "Hickory Motor Speedway":                           "/tracks/photos/hickory-motor-speedwa.webp",
  "Huset's Speedway":                                 "/tracks/photos/husets.webp",
  "Kevin Harvick's Kern Raceway":                     "/tracks/photos/kern.webp",
  "Lernerville Speedway":                             "/tracks/photos/lerner-main-1.webp",
  "Lincoln Speedway":                                 "/tracks/photos/lincolnspeedway.webp",
  "Centripetal Circuit":                              "/tracks/photos/included-centripetalcircuit.webp",
  "Concord Speedway":                                 "/tracks/photos/included-concordspeedway.webp",
  "Langley Speedway":                                 "/tracks/photos/included-langleyspeedway.webp",
  "Lanier National Speedway":                         "/tracks/photos/included-laniernationalspeedway.webp",
  "Limaland Motorsports Park":                        "/tracks/photos/included-limalandmotorsportspark.webp",
  "Oxford Plains Speedway":                           "/tracks/photos/included-oxfordplainsspeedway.webp",
  "Southern National Motorsports Park":               "/tracks/photos/included-southernnationalmotorsportspark.webp",
  "Thompson Speedway Motorsports Park":               "/tracks/photos/included-thompsonmotorsportspark.webp",
  "USA International Speedway":                       "/tracks/photos/included-usainternationalspeedway.webp",
  "Mount Washington Auto Road":                       "/tracks/photos/mount-washington-auto-road-1.webp",
  // Legacy tracks
  "[Legacy] Charlotte Motor Speedway":                "/tracks/photos/charlottemotorspeedway.webp",
  "[Legacy] Kentucky Speedway":                       "/tracks/photos/kentuckyspeedway-sm.webp",
  "[Legacy] Michigan International Speedway":         "/tracks/photos/michigan.webp",
  "[Legacy] Phoenix Raceway":                         "/tracks/photos/phoenix.webp",
  "[Legacy] Silverstone Circuit":                     "/tracks/photos/legacy-silverstonecircuit-2008.webp",
  "[Legacy] Texas Motor Speedway":                    "/tracks/photos/legacy-texasmotorspeedway.webp",
};

/** Fallback als er geen specifieke foto is */
const FALLBACK = "/tracks/photos/daytona.webp";

/**
 * Geeft de lokale track foto terug.
 * Probeert exacte match → progressief kortere base naam → fallback.
 * Bijv. "Circuito de Jerez - Ángel Nieto - Grand Prix"
 *   → "Circuito de Jerez - Ángel Nieto" → gevonden!
 */
export function getTrackPhoto(trackName: string): string {
  if (PHOTOS[trackName]) return PHOTOS[trackName];

  // Probeer progressief kortere varianten door laatste " - ..." te verwijderen
  const parts = trackName.split(" - ");
  for (let i = parts.length - 1; i >= 1; i--) {
    const base = parts.slice(0, i).join(" - ").trim();
    if (PHOTOS[base]) return PHOTOS[base];
  }

  return FALLBACK;
}
