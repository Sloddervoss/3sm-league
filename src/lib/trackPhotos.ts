/**
 * trackPhotos.ts — iRacing track photos (lokaal geserveerd)
 * Images gedownload via scripts/fetchIRacingTrackImages.js
 * Opgeslagen in public/tracks/photos/
 */

const PHOTOS: Record<string, string> = {
  // Belgium
  "Circuit de Spa-Francorchamps":                     "/tracks/photos/circuitdespa-francorchamps.jpg",
  "Circuit Zolder":                                   "/tracks/photos/circuit-zolder.jpg",
  // Italy
  "Autodromo Nazionale Monza":                        "/tracks/photos/monza.jpg",
  "Autodromo Internazionale del Mugello":             "/tracks/photos/mugello.jpg",
  "Autodromo Internazionale Enzo e Dino Ferrari":     "/tracks/photos/imola.jpg",
  "Misano World Circuit Marco Simoncelli":            "/tracks/photos/misano.jpg",
  // UK
  "Silverstone Circuit":                              "/tracks/photos/silverstone.jpg",
  "Brands Hatch Circuit":                             "/tracks/photos/brandshatchcircuit-sm.jpg",
  "Donington Park Racing Circuit":                    "/tracks/photos/update-doningtonpark.jpg",
  "Snetterton Circuit":                               "/tracks/photos/snetterton.jpg",
  "Oulton Park Circuit":                              "/tracks/photos/oultonpark.jpg",
  "Cadwell Park Circuit":                             "/tracks/photos/cadwell.jpg",
  "Thruxton Circuit":                                 "/tracks/photos/thruxton.jpg",
  "Knockhill Racing Circuit":                         "/tracks/photos/knockhill-racing-circuit.png",
  "Rockingham Speedway":                              "/tracks/photos/rockingham.jpg",
  // Netherlands
  "Circuit Zandvoort":                                "/tracks/photos/circuit-zandvoort.jpg",
  "Circuit Park Zandvoort":                           "/tracks/photos/circuit-zandvoort.jpg",
  // Germany
  "Nürburgring Combined":                             "/tracks/photos/hock.jpg",
  "Nürburgring Grand Prix Circuit":                   "/tracks/photos/hock.jpg",
  "Nürburgring Grand-Prix-Strecke":                   "/tracks/photos/hock.jpg",
  "Hockenheimring Baden-Württemberg":                 "/tracks/photos/hock.jpg",
  "Sachsenring":                                      "/tracks/photos/sachsenring.jpg",
  "Motorsport Arena Oschersleben":                    "/tracks/photos/motorsportarenaoschersleben.jpg",
  // Austria
  "Red Bull Ring":                                    "/tracks/photos/rbr.jpg",
  // Hungary
  "Hungaroring":                                      "/tracks/photos/hungaroring.jpg",
  "Hungaroring Circuit":                              "/tracks/photos/hungaroring.jpg",
  // Spain
  "Circuit de Barcelona-Catalunya":                   "/tracks/photos/update-circuitdebarcelona.jpg",
  "Circuit de Barcelona Catalunya":                   "/tracks/photos/update-circuitdebarcelona.jpg",
  "Circuito de Jerez - Ángel Nieto":                  "/tracks/photos/circuitodejerez.jpg",
  "Circuito de Navarra":                              "/tracks/photos/navarra-included.jpg",
  "MotorLand Aragón":                                 "/tracks/photos/aragon.jpg",
  // France
  "Circuit Paul Ricard":                              "/tracks/photos/magnycours.jpg",
  "Circuit de Nevers Magny-Cours":                    "/tracks/photos/magnycours.jpg",
  "Circuit de la Sarthe":                             "/tracks/photos/24hlemans.jpg",
  "Circuit des 24 Heures du Mans":                    "/tracks/photos/24hlemans.jpg",
  "Lédenon":                                          "/tracks/photos/circuitdeledenon.jpg",
  "Circuit de Lédenon":                               "/tracks/photos/circuitdeledenon.jpg",
  // Monaco
  "Circuit de Monaco":                                "/tracks/photos/circuitgillesvilleneuve-sm.jpg",
  // USA
  "Indianapolis Motor Speedway":                      "/tracks/photos/indianapolis.jpg",
  "Watkins Glen International":                       "/tracks/photos/watkinsglen.jpg",
  "Road America":                                     "/tracks/photos/update-roadamerica.jpg",
  "WeatherTech Raceway at Laguna Seca":               "/tracks/photos/lagunaseca.jpg",
  "WeatherTech Raceway Laguna Seca":                  "/tracks/photos/lagunaseca.jpg",
  "Laguna Seca Raceway":                              "/tracks/photos/lagunaseca.jpg",
  "Sebring International Raceway":                    "/tracks/photos/sebring.jpg",
  "Daytona International Speedway":                   "/tracks/photos/daytona.jpg",
  "Circuit of the Americas":                          "/tracks/photos/circuitoftheamericas.jpg",
  "Sonoma Raceway":                                   "/tracks/photos/sonoma.jpg",
  "Road Atlanta":                                     "/tracks/photos/update-roadatlanta.jpg",
  "Barber Motorsports Park":                          "/tracks/photos/barbermotorsportspark.jpg",
  "Virginia International Raceway":                   "/tracks/photos/virginiainternationalraceway.jpg",
  "Mid-Ohio Sports Car Course":                       "/tracks/photos/update-midohiosportscarcourse.jpg",
  "Summit Point Raceway":                             "/tracks/photos/included-summitpointmotorsportspark.jpg",
  "Summit Point Motorsports Park":                    "/tracks/photos/included-summitpointmotorsportspark.jpg",
  "Long Beach Street Circuit":                        "/tracks/photos/longbeach.jpg",
  "Chicago Street Course":                            "/tracks/photos/chicagostreetcourse.jpg",
  "Chicagoland Speedway":                             "/tracks/photos/update-chicagolandspeedway.jpg",
  "Phoenix Raceway":                                  "/tracks/photos/phoenix.jpg",
  "Homestead-Miami Speedway":                         "/tracks/photos/homestead-miami-speedway.jpg",
  "Homestead Miami Speedway":                         "/tracks/photos/homestead-miami-speedway.jpg",
  "Kansas Speedway":                                  "/tracks/photos/kansasspeedway.jpg",
  "Iowa Speedway":                                    "/tracks/photos/iowa.jpg",
  "Lime Rock Park":                                   "/tracks/photos/limerock2019.jpg",
  "Miami International Autodrome":                    "/tracks/photos/miami-international-autodrome.jpg",
  "Portland International Raceway":                   "/tracks/photos/portland.jpg",
  "St. Petersburg Street Circuit":                    "/tracks/photos/st-petersburg.jpg",
  "Autodromo Hermanos Rodriguez":                     "/tracks/photos/mexicocity.jpg",
  "Autódromo Hermanos Rodríguez (Mexico City)":       "/tracks/photos/mexicocity.jpg",
  "Charlotte Motor Speedway":                         "/tracks/photos/charlottemotorspeedway.jpg",
  "EchoPark Speedway (Atlanta)":                      "/tracks/photos/echoparkspeedway.jpg",
  "New Jersey Motorsports Park":                      "/tracks/photos/newjerseymotorsportspark-sm.jpg",
  "Auto Club Speedway":                               "/tracks/photos/autoclubspeedway-sm1.jpg",
  "World Wide Technology Raceway (Gateway)":          "/tracks/photos/worldwidetechnologyraceway.jpg",
  "Willow Springs Raceway":                           "/tracks/photos/willow-springs-raceway.jpg",
  "Willow Springs International Raceway":             "/tracks/photos/willow-springs-raceway.jpg",
  // Japan
  "Mobility Resort Motegi":                           "/tracks/photos/mobilityresortmotegi.jpg",
  "Twin Ring Motegi":                                 "/tracks/photos/mobilityresortmotegi.jpg",
  "Fuji International Speedway":                      "/tracks/photos/fuji-international-speedway.jpg",
  "Suzuka International Racing Course":               "/tracks/photos/suzukainternationracingcourse.jpg",
  "Tsukuba Circuit":                                  "/tracks/photos/included-tsukubacircuit.jpg",
  // Canada
  "Canadian Tire Motorsports Park":                   "/tracks/photos/canadiantiremotorsportspark-sm.jpg",
  "Circuit Gilles Villeneuve":                        "/tracks/photos/circuitgillesvilleneuve-sm.jpg",
  // Australia
  "The Bend Motorsport Park":                         "/tracks/photos/the-bend.jpg",
  "Shell V-Power Motorsport Park at The Bend":        "/tracks/photos/the-bend.jpg",
  "Adelaide Street Circuit":                          "/tracks/photos/adelaide-street-circuit.jpg",
  "Sandown Motor Raceway":                            "/tracks/photos/sandown-motor-raceway.jpg",
  "Sandown International Motor Raceway":              "/tracks/photos/sandown-motor-raceway.jpg",
  "Winton Motor Raceway":                             "/tracks/photos/winton-motor-raceway-included.jpg",
  "Phillip Island Circuit":                           "/tracks/photos/phillipisland-sm.jpg",
  "Mount Panorama Circuit":                           "/tracks/photos/update-mountpanoramacircuit.jpg",
  "Oran Park Raceway":                                "/tracks/photos/included-oranparkraceway.jpg",
  // Brazil
  "Autodromo Jose Carlos Pace":                       "/tracks/photos/autodromojosecarlospace.jpg",
  "Autódromo José Carlos Pace":                       "/tracks/photos/autodromojosecarlospace.jpg",
  // Norway
  "Rudskogen Motorsenter":                            "/tracks/photos/rudskogen-motorsenter.jpg",
  "Lånkebanen":                                       "/tracks/photos/update-hellrxlaankebanen.jpg",
  "Lånkebanen (Hell RX)":                             "/tracks/photos/update-hellrxlaankebanen.jpg",
  // Portugal
  "Autodromo Internacional do Algarve":               "/tracks/photos/algarve.jpg",
  "Algarve International Circuit":                    "/tracks/photos/algarve.jpg",
  // Japan
  "Okayama International Circuit":                    "/tracks/photos/included-okayamainternationalcircuit.jpg",
};

/** Fallback als er geen specifieke foto is */
const FALLBACK = "/tracks/photos/daytona.jpg";

/**
 * Geeft de lokale track foto terug.
 * Probeert exacte match → base naam (splits op " - ") → fallback.
 */
export function getTrackPhoto(trackName: string): string {
  if (PHOTOS[trackName]) return PHOTOS[trackName];

  // iRacing varianten: "Silverstone Circuit - Grand Prix" → "Silverstone Circuit"
  const base = trackName.split(" - ")[0].trim();
  if (PHOTOS[base]) return PHOTOS[base];

  return FALLBACK;
}
