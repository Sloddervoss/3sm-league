import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Plus, Trophy, Calendar, Trash2, Settings, Users, Car, Shield, BarChart2, Upload, Save, FileText, X, Check, ImagePlus, Clock, Pencil, MapPin, Flag, CloudSun, Gauge, Timer } from "lucide-react";
import { getTrackInfo } from "@/lib/trackData";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

type AdminTab = "overview" | "seasons" | "teams" | "results" | "points" | "drivers";

const DEFAULT_POINTS = [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

// Tijdzone utilities — admin voert altijd Amsterdam (CET/CEST) tijd in
const TZ = "Europe/Amsterdam";

/** Amsterdam lokale tijd string → UTC ISO string (voor opslaan in DB) */
function amsToUTC(localStr: string): string {
  const temp = new Date(localStr + ":00.000Z");
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(temp);
  const p: Record<string, string> = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  const amsDate = new Date(`${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:00.000Z`);
  return new Date(temp.getTime() - (amsDate.getTime() - temp.getTime())).toISOString();
}

/** UTC ISO string → "YYYY-MM-DDTHH:mm" in Amsterdam tijd (voor datetime-local input) */
function utcToAmsLocal(utcStr: string): string {
  const date = new Date(utcStr);
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const p: Record<string, string> = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

const IRACING_TRACKS = [...new Set([
  "Adelaide Street Circuit",
  "Algarve International Circuit",
  "Algarve International Circuit - Grand Prix",
  "Algarve International Circuit - Grand Prix - Chicanes",
  "Algarve International Circuit - Moto",
  "Algarve International Circuit - Moto - Chicanes",
  "Auto Club Speedway",
  "Auto Club Speedway - Oval",
  "Auto Club Speedway - Competition",
  "Auto Club Speedway - Interior",
  "Auto Club Speedway - Moto",
  "Autódromo Hermanos Rodríguez (Mexico City)",
  "Autódromo Hermanos Rodríguez (Mexico City) - Grand Prix",
  "Autódromo Hermanos Rodríguez (Mexico City) - Grand Prix Historic",
  "Autódromo Hermanos Rodríguez (Mexico City) - National",
  "Autódromo Hermanos Rodríguez (Mexico City) - National Historic",
  "Autódromo Hermanos Rodríguez (Mexico City) - EV Circuit",
  "Autódromo Hermanos Rodríguez (Mexico City) - Oval",
  "Autódromo Hermanos Rodríguez (Mexico City) - Oval Stadium",
  "Autodromo Internazionale del Mugello - Short",
  "Autodromo Internazionale Enzo e Dino Ferrari",
  "Autodromo Internazionale Enzo e Dino Ferrari - Grand Prix",
  "Autodromo Internazionale Enzo e Dino Ferrari - Moto",
  "Autódromo José Carlos Pace",
  "Autódromo José Carlos Pace - Grand Prix",
  "Autódromo José Carlos Pace - Moto",
  "Autodromo Nazionale Monza",
  "Autodromo Nazionale Monza - Grand Prix",
  "Autodromo Nazionale Monza - GP without chicanes",
  "Autodromo Nazionale Monza - GP without first chicane",
  "Autodromo Nazionale Monza - Combined",
  "Autodromo Nazionale Monza - Combined without chicanes",
  "Autodromo Nazionale Monza - Combined without first chicane",
  "Autodromo Nazionale Monza - Junior",
  "Autodromo Nazionale Monza - Oval - Left turning",
  "Autodromo Nazionale Monza - Oval - Right turning",
  "Barber Motorsports Park",
  "Barber Motorsports Park - Full Course",
  "Barber Motorsports Park - Short A",
  "Barber Motorsports Park - Short B",
  "Bark River International Raceway",
  "Brands Hatch Circuit",
  "Brands Hatch Circuit - Grand Prix",
  "Brands Hatch Circuit - Indy",
  "Brands Hatch Circuit - Rallycross",
  "Bristol Motor Speedway",
  "Bristol Motor Speedway - Dual Pit Roads",
  "Bristol Motor Speedway - Single Pit Road",
  "Bristol Motor Speedway - Dirt",
  "Bristol Motor Speedway - Dirt - 2021",
  "Cadwell Park Circuit",
  "Cadwell Park Circuit - Full",
  "Cadwell Park Circuit - Club",
  "Cadwell Park Circuit - Moto",
  "Cadwell Park Circuit - Woodlands",
  "Canadian Tire Motorsports Park",
  "Cedar Lake Speedway",
  "Centripetal Circuit",
  "Charlotte Motor Speedway",
  "Charlotte Motor Speedway - Oval - 2018",
  "Charlotte Motor Speedway - Roval",
  "Charlotte Motor Speedway - Roval Long",
  "Charlotte Motor Speedway - Roval - 2018",
  "Charlotte Motor Speedway - Legends Oval",
  "Charlotte Motor Speedway - Legends RC Oval Long",
  "Charlotte Motor Speedway - Legends RC Oval Medium",
  "Charlotte Motor Speedway - Legends RC Oval Short",
  "Charlotte Motor Speedway - Rallycross",
  "Chicago Street Course",
  "Chicago Street Course - 2023 Cup",
  "Chicago Street Course - Prototype",
  "Chicagoland Speedway",
  "Chili Bowl",
  "Circuit de Barcelona Catalunya",
  "Circuit de Barcelona-Catalunya - Grand Prix",
  "Circuit de Barcelona-Catalunya - National",
  "Circuit de Barcelona-Catalunya - Moto",
  "Circuit de Barcelona-Catalunya - Club",
  "Circuit de Barcelona-Catalunya - Historic",
  "Circuit de Barcelona-Catalunya - Rallycross",
  "Circuit de Lédenon",
  "Circuit de Nevers Magny-Cours",
  "Circuit de Nevers Magny-Cours - Grand Prix",
  "Circuit de Spa-Francorchamps",
  "Circuit de Spa-Francorchamps - Grand Prix Pits",
  "Circuit de Spa-Francorchamps - Classic Pits",
  "Circuit de Spa-Francorchamps - Endurance",
  "Circuit de Spa-Francorchamps - Bike",
  "Circuit de Spa-Francorchamps - Grand Prix Pits - 2010",
  "Circuit de Spa-Francorchamps - Classic Pits - 2010",
  "Circuit de Spa-Francorchamps - Endurance - 2010",
  "Circuit des 24 Heures du Mans",
  "Circuit des 24 Heures du Mans - 24 Heures du Man",
  "Circuit des 24 Heures du Mans - Historic",
  "Circuit Gilles Villeneuve",
  "Circuit of the Americas",
  "Circuit of the Americas - Grand Prix",
  "Circuit of the Americas - East",
  "Circuit of the Americas - West",
  "Circuit Park Zandvoort",
  "Circuit Park Zandvoort - Grand Prix - 2009",
  "Circuit Park Zandvoort - National - 2009",
  "Circuit Park Zandvoort - Chicane - 2009",
  "Circuit Park Zandvoort - Club - 2009",
  "Circuit Park Zandvoort - Oostelijk - 2009",
  "Circuit Zandvoort",
  "Circuit Zandvoort - Grand Prix",
  "Circuit Zandvoort - Grand Prix w/2 Chicane",
  "Circuit Zandvoort - Nationaal",
  "Circuit Zandvoort - Oostelijk",
  "Circuit Zolder",
  "Circuit Zolder - Grand Prix",
  "Circuit Zolder - Alternate",
  "Circuito de Jerez - Ángel Nieto",
  "Circuito de Jerez - Ángel Nieto - Grand Prix",
  "Circuito de Jerez - Ángel Nieto - Moto",
  "Circuito de Navarra",
  "Circuito de Navarra - Speed Circuit",
  "Circuito de Navarra - Speed Circuit - Medium",
  "Circuito de Navarra - Speed Circuit - Short",
  "Concord Speedway",
  "Crandon International Raceway",
  "Crandon International Raceway - Full",
  "Crandon International Raceway - Short",
  "Darlington Raceway",
  "Daytona International Speedway",
  "Daytona International Speedway - Oval",
  "Daytona International Speedway - Road Course",
  "Daytona International Speedway - NASCAR Road Course",
  "Daytona International Speedway - Moto",
  "Daytona International Speedway - Short",
  "Daytona International Speedway - Oval - 2008",
  "Daytona International Speedway - Road Course - 2008",
  "Daytona International Speedway - Moto - 2008",
  "Daytona International Speedway - Short - 2008",
  "Daytona Rallycross and Dirt Road",
  "Daytona Rallycross and Dirt Road - Dirt Road Long",
  "Daytona Rallycross and Dirt Road - Dirt Road Short",
  "Daytona Rallycross and Dirt Road - Rallycross Long",
  "Daytona Rallycross and Dirt Road - Rallycross Short",
  "Detroit Grand Prix at Belle Isle",
  "Donington Park Racing Circuit",
  "Donington Park Racing Circuit - Grand Prix",
  "Donington Park Racing Circuit - National",
  "Dover Motor Speedway",
  "EchoPark Speedway (Atlanta)",
  "EchoPark Speedway (Atlanta) - Oval",
  "EchoPark Speedway (Atlanta) - Rallycross Long",
  "EchoPark Speedway (Atlanta) - Rallycross Short",
  "EchoPark Speedway (Atlanta) - Oval - 2008",
  "EchoPark Speedway (Atlanta) - Legends Oval - 2008",
  "EchoPark Speedway (Atlanta) - Road Course - 2008",
  "Eldora Speedway",
  "Fairbury Speedway",
  "Federated Auto Parts Raceway at I-55",
  "Firebird Motorsports Park",
  "Five Flags Speedway",
  "Fuji International Speedway",
  "Fuji International Speedway - Grand Prix",
  "Fuji International Speedway - No Chicane",
  "Hickory Motor Speedway",
  "Hockenheimring Baden-Württemberg",
  "Hockenheimring Baden-Württemberg - Grand Prix",
  "Hockenheimring Baden-Württemberg - National A",
  "Hockenheimring Baden-Württemberg - National B",
  "Hockenheimring Baden-Württemberg - Outer",
  "Hockenheimring Baden-Württemberg - PEC - East",
  "Hockenheimring Baden-Württemberg - PEC - Handling",
  "Hockenheimring Baden-Württemberg - PEC - Outer",
  "Hockenheimring Baden-Württemberg - PEC - West",
  "Hockenheimring Baden-Württemberg - Short A",
  "Hockenheimring Baden-Württemberg - Short B",
  "Homestead Miami Speedway",
  "Homestead Miami Speedway - Oval",
  "Homestead Miami Speedway - Open Wheel Oval",
  "Homestead Miami Speedway - Road Course A",
  "Homestead Miami Speedway - Road Course B",
  "Hungaroring Circuit",
  "Huset's Speedway",
  "Indianapolis Motor Speedway",
  "Indianapolis Motor Speedway - Oval",
  "Indianapolis Motor Speedway - Open Wheel Oval",
  "Indianapolis Motor Speedway - Road Course",
  "Indianapolis Motor Speedway - Bike",
  "Indianapolis Motor Speedway - Oval - 2009",
  "Indianapolis Motor Speedway - Open Wheel Oval - 2009",
  "Indianapolis Motor Speedway - Road Course - 2009",
  "Iowa Speedway",
  "Iowa Speedway - Oval",
  "Iowa Speedway - Oval - 2011",
  "Iowa Speedway - Road Course",
  "Iowa Speedway - Infield Road Course",
  "Iowa Speedway - Legends",
  "Iowa Speedway - Infield Legends",
  "Iowa Speedway - Rallycross",
  "iRacing Superspeedway",
  "Irwindale Speedway",
  "Irwindale Speedway - Outer",
  "Irwindale Speedway - Inner",
  "Irwindale Speedway - Outer - Inner",
  "Irwindale Speedway - Figure Eight",
  "Irwindale Speedway - Figure Eight Jump",
  "Kansas Speedway",
  "Kansas Speedway - Oval",
  "Kansas Speedway - Road Course",
  "Kansas Speedway - Infield Road Course",
  "Kentucky Speedway",
  "Kentucky Speedway - Oval",
  "Kevin Harvick's Kern Raceway",
  "Kevin Harvick's Kern Raceway - Asphalt Track",
  "Kevin Harvick's Kern Raceway - Legends",
  "Kevin Harvick's Kern Raceway - Dirt Track",
  "Kevin Harvick's Kern Raceway - Dirt Mini Oval",
  "Knockhill Racing Circuit",
  "Knockhill Racing Circuit - International",
  "Knockhill Racing Circuit - International Reverse",
  "Knockhill Racing Circuit - National",
  "Knockhill Racing Circuit - National Reverse",
  "Knockhill Racing Circuit - Tri-Oval",
  "Knockhill Racing Circuit - Rallycross",
  "Knoxville Raceway",
  "Kokomo Speedway",
  "Kokomo Speedway - Tires In",
  "Kokomo Speedway - Tires Out",
  "Langley Speedway",
  "Lanier National Speedway",
  "Lanier National Speedway - Asphalt",
  "Lanier National Speedway - Dirt",
  "Lånkebanen (Hell RX)",
  "Lånkebanen (Hell RX) - Club",
  "Lånkebanen (Hell RX) - Hell Rallycross",
  "Lånkebanen (Hell RX) - Rallycross Short",
  "Lånkebanen (Hell RX) - Road Long",
  "Lånkebanen (Hell RX) - Road Short",
  "Las Vegas Motor Speedway",
  "Las Vegas Motor Speedway - Infield Legends Oval",
  "Las Vegas Motor Speedway - Legends Oval",
  "Las Vegas Motor Speedway - Oval",
  "Las Vegas Motor Speedway - Road Course Combined",
  "Las Vegas Motor Speedway - Road Course Long",
  "Las Vegas Motor Speedway - Road Course Short",
  "Lernerville Speedway",
  "Limaland Motorsports Park",
  "Lime Rock Park",
  "Lime Rock Park - Chicanes",
  "Lime Rock Park - Classic",
  "Lime Rock Park - Grand Prix",
  "Lime Rock Park - School",
  "Lime Rock Park - West Bend Chicane",
  "Lincoln Speedway",
  "Long Beach Street Circuit",
  "Los Angeles Memorial Coliseum",
  "Lucas Oil Indianapolis Raceway Park",
  "Lucas Oil Indianapolis Raceway Park - Oval",
  "Lucas Oil Indianapolis Raceway Park - Rallycross",
  "Lucas Oil Speedway",
  "Lucas Oil Speedway - Dirt Oval",
  "Lucas Oil Speedway - Off Road",
  "Martinsville Speedway",
  "Miami International Autodrome",
  "Miami International Autodrome - Grand Prix",
  "Miami International Autodrome - Marina Loop",
  "Miami International Autodrome - MIA Loop",
  "Miami International Autodrome - Extended MIA Loop",
  "Miami International Autodrome - Extended Marina Loop",
  "Michigan International Speedway",
  "Mid-Ohio Sports Car Course",
  "Mid-Ohio Sports Car Course - Alt Oval",
  "Mid-Ohio Sports Car Course - Chicane",
  "Mid-Ohio Sports Car Course - Full Course",
  "Mid-Ohio Sports Car Course - Oval",
  "Mid-Ohio Sports Car Course - Short",
  "Millbridge Speedway",
  "Misano World Circuit Marco Simoncelli",
  "Misano World Circuit Marco Simoncelli - Club",
  "Misano World Circuit Marco Simoncelli - Grand Prix",
  "Misano World Circuit Marco Simoncelli - Grand Prix - Historic",
  "Misano World Circuit Marco Simoncelli - Grand Prix 2007",
  "Misano World Circuit Marco Simoncelli - Truck",
  "Mobility Resort Motegi",
  "Mobility Resort Motegi - East",
  "Mobility Resort Motegi - Grand Prix",
  "Mobility Resort Motegi - Oval",
  "Mobility Resort Motegi - West",
  "MotorLand Aragón",
  "MotorLand Aragón - Grand Prix",
  "MotorLand Aragón - Motorcycle Grand Prix",
  "MotorLand Aragón - Motorcycle National",
  "MotorLand Aragón - National",
  "MotorLand Aragón - Outer",
  "MotorLand Aragón - Touring Car",
  "MotorLand Aragón - West",
  "Motorsport Arena Oschersleben",
  "Motorsport Arena Oschersleben - Alternate",
  "Motorsport Arena Oschersleben - B Course",
  "Motorsport Arena Oschersleben - C Course",
  "Motorsport Arena Oschersleben - Grand Prix",
  "Mount Panorama Circuit",
  "Mount Washington Auto Road",
  "Mount Washington Auto Road - Descent",
  "Mount Washington Auto Road - Hillclimb",
  "Myrtle Beach Speedway",
  "Nashville Fairgrounds Speedway",
  "Nashville Fairgrounds Speedway - Mini",
  "Nashville Fairgrounds Speedway - Oval",
  "Nashville Superspeedway",
  "New Hampshire Motor Speedway",
  "New Hampshire Motor Speedway - Legends",
  "New Hampshire Motor Speedway - Oval",
  "New Hampshire Motor Speedway - Road Course",
  "New Hampshire Motor Speedway - Road Course with North Oval",
  "New Hampshire Motor Speedway - Road Course with South Oval",
  "New Jersey Motorsports Park",
  "New Jersey Motorsports Park - Thunderbolt",
  "New Jersey Motorsports Park - Thunderbolt w/both chicanes",
  "New Jersey Motorsports Park - Thunderbolt w/first chicane",
  "New Jersey Motorsports Park - Thunderbolt w/second chicane",
  "New Smyrna Speedway",
  "North Wilkesboro Speedway",
  "North Wilkesboro Speedway - 1987",
  "Nürburgring Combined",
  "Nürburgring Combined - Gesamtstrecke 24h",
  "Nürburgring Combined - Gesamtstrecke Long",
  "Nürburgring Combined - Gesamtstrecke Short w/o Arena",
  "Nürburgring Combined - Gesamtstrecke VLN",
  "Nürburgring Grand-Prix-Strecke",
  "Nürburgring Grand-Prix-Strecke - BES/WEC",
  "Nürburgring Grand-Prix-Strecke - Grand Prix",
  "Nürburgring Grand-Prix-Strecke - Grand Prix w/out Arena",
  "Nürburgring Grand-Prix-Strecke - Kurzanbindung w/out Arena",
  "Nürburgring Grand-Prix-Strecke - Müllenbachschleife",
  "Nürburgring Grand-Prix-Strecke - Sprintstrecke",
  "Nürburgring Nordschleife",
  "Nürburgring Nordschleife - Industriefahrten",
  "Nürburgring Nordschleife - Touristenfahrten",
  "Okayama International Circuit",
  "Okayama International Circuit - Full Course",
  "Okayama International Circuit - Short",
  "Oran Park Raceway",
  "Oran Park Raceway - Grand Prix",
  "Oran Park Raceway - Moto",
  "Oran Park Raceway - North",
  "Oran Park Raceway - North A",
  "Oran Park Raceway - North B",
  "Oran Park Raceway - South",
  "Oswego Speedway",
  "Oswego Speedway - Dirt",
  "Oswego Speedway - Mini Oval",
  "Oswego Speedway - Oval",
  "Oulton Park Circuit",
  "Oulton Park Circuit - Fosters",
  "Oulton Park Circuit - Fosters w/Hislop",
  "Oulton Park Circuit - International",
  "Oulton Park Circuit - Intl w/out Brittens",
  "Oulton Park Circuit - Intl w/out Chicane",
  "Oulton Park Circuit - Intl w/out Hislop",
  "Oulton Park Circuit - Island",
  "Oulton Park Circuit - Island Historic",
  "Oxford Plains Speedway",
  "Phillip Island Circuit",
  "Phoenix Raceway",
  "Phoenix Raceway - Oval",
  "Phoenix Raceway - Oval w/open Dogleg",
  "Pocono Raceway",
  "Portland International Raceway",
  "Portland International Raceway - Full",
  "Portland International Raceway - No Chicane",
  "Port Royal Speedway",
  "Red Bull Ring",
  "Red Bull Ring - Grand Prix",
  "Red Bull Ring - National",
  "Red Bull Ring - North",
  "Richmond Raceway",
  "Road America",
  "Road America - Bend",
  "Road America - Full",
  "Road Atlanta",
  "Road Atlanta - Club",
  "Road Atlanta - Full Course",
  "Road Atlanta - Short",
  "Rockingham Speedway",
  "Rockingham Speedway - Oval",
  "Rockingham Speedway - Infield Road Course",
  "Rockingham Speedway - Road Course",
  "Rockingham Speedway - Short Road Course",
  "Rudskogen Motorsenter",
  "Sachsenring",
  "Sandown International Motor Raceway",
  "Sebring International Raceway",
  "Sebring International Raceway - Club",
  "Sebring International Raceway - International",
  "Sebring International Raceway - Modified",
  "Shell V-Power Motorsport Park at The Bend",
  "Shell V-Power Motorsport Park at The Bend - International Circuit",
  "Shell V-Power Motorsport Park at The Bend - GT Circuit",
  "Shell V-Power Motorsport Park at The Bend - Sprint Circuit",
  "Shell V-Power Motorsport Park at The Bend - East Circuit",
  "Shell V-Power Motorsport Park at The Bend - South-West Circuit",
  "Shell V-Power Motorsport Park at The Bend - West Circuit",
  "Shell V-Power Motorsport Park at The Bend - West Plus Circuit",
  "Silverstone Circuit",
  "Silverstone Circuit - Grand Prix",
  "Silverstone Circuit - International",
  "Silverstone Circuit - National",
  "Slinger Speedway",
  "Slinger Speedway - Figure Eight",
  "Slinger Speedway - Oval",
  "Snetterton Circuit",
  "St. Petersburg Street Circuit",
  "St. Petersburg Grand Prix",
  "Snetterton Circuit - 100",
  "Snetterton Circuit - 200",
  "Snetterton Circuit - 300",
  "Sonoma Raceway",
  "Sonoma Raceway - NASCAR Long",
  "Sonoma Raceway - NASCAR Short",
  "Sonoma Raceway - Open Wheel 2008-2011",
  "Sonoma Raceway - Open Wheel 2012-2018",
  "Sonoma Raceway - Open Wheel pre-2008",
  "Sonoma Raceway - Rallycross",
  "South Boston Speedway",
  "Southern National Motorsports Park",
  "Stafford Motor Speedway",
  "Stafford Motor Speedway - Full Course",
  "Stafford Motor Speedway - Mini Mile",
  "Summit Point Raceway",
  "Summit Point Raceway - Jefferson Circuit",
  "Summit Point Raceway - Jefferson Reverse",
  "Summit Point Raceway - Oval",
  "Summit Point Raceway - School",
  "Summit Point Raceway - Short",
  "Summit Point Raceway - Summit Point Raceway",
  "Suzuka International Racing Course",
  "Suzuka International Racing Course - East",
  "Suzuka International Racing Course - Grand Prix",
  "Suzuka International Racing Course - Moto",
  "Suzuka International Racing Course - West",
  "Suzuka International Racing Course - West w/chicane",
  "Talladega Superspeedway",
  "Texas Motor Speedway",
  "Texas Motor Speedway - Legends Oval",
  "Texas Motor Speedway - Oval",
  "The Bullring",
  "The Dirt Track at Charlotte",
  "The Milwaukee Mile",
  "Thompson Speedway Motorsports Park",
  "Thruxton Circuit",
  "Tsukuba Circuit",
  "Tsukuba Circuit - 1000 - Chicane",
  "Tsukuba Circuit - 1000 - Full",
  "Tsukuba Circuit - 1000 - Outer",
  "Tsukuba Circuit - 1000 - Reverse",
  "Tsukuba Circuit - 2000 - Full",
  "Tsukuba Circuit - 2000 - Moto",
  "Tsukuba Circuit - 2000 - Short",
  "USA International Speedway",
  "USA International Speedway - Asphalt",
  "USA International Speedway - Dirt",
  "Virginia International Raceway",
  "Virginia International Raceway - Full Course",
  "Virginia International Raceway - Grand Course",
  "Virginia International Raceway - North Course",
  "Virginia International Raceway - Patriot Course",
  "Virginia International Raceway - South Course",
  "Volusia Speedway Park",
  "Watkins Glen International",
  "Watkins Glen International - Boot",
  "Watkins Glen International - Classic",
  "Watkins Glen International - Classic Boot",
  "Watkins Glen International - Cup",
  "WeatherTech Raceway Laguna Seca",
  "WeatherTech Raceway Laguna Seca - School",
  "Weedsport Speedway",
  "Wild West Motorsports Park",
  "Williams Grove Speedway",
  "Willow Springs International Raceway",
  "Winton Motor Raceway",
  "Winton Motor Raceway - Club",
  "Winton Motor Raceway - National",
  "Winton Motor Raceway - Rallycross",
  "World Wide Technology Raceway (Gateway)",
  "World Wide Technology Raceway (Gateway) - Oval",
  "World Wide Technology Raceway (Gateway) - Road Course",
  "World Wide Technology Raceway (Gateway) - 2025 - Oval",
  "[Legacy] Charlotte Motor Speedway - 2008",
  "[Legacy] Charlotte Motor Speedway - 2008 - Infield Road Course",
  "[Legacy] Charlotte Motor Speedway - 2008 - Legends Oval",
  "[Legacy] Charlotte Motor Speedway - 2008 - Oval",
  "[Legacy] Charlotte Motor Speedway - 2008 - Road Course",
  "[Legacy] Kentucky Speedway - 2011",
  "[Legacy] Kentucky Speedway - Legends",
  "[Legacy] Kentucky Speedway - Oval",
  "[Legacy] Michigan International Speedway - 2009",
  "[Legacy] Phoenix Raceway - 2008",
  "[Legacy] Phoenix Raceway - 2008 - Dirt Road",
  "[Legacy] Phoenix Raceway - 2008 - Oval",
  "[Legacy] Silverstone Circuit - 2008 - Historical Grand Prix",
  "[Legacy] Silverstone Circuit - 2008 - International",
  "[Legacy] Silverstone Circuit - 2008 - National",
  "[Legacy] Silverstone Circuit - 2008 - Southern",
  "[Legacy] Texas Motor Speedway - 2009",
  "[Legacy] Texas Motor Speedway - 2009 - Legends Oval",
  "[Legacy] Texas Motor Speedway - 2009 - Oval",
  "[Legacy] Texas Motor Speedway - 2009 - Road Course Combined",
  "[Legacy] Texas Motor Speedway - 2009 - Road Course Long",
  "[Legacy] Texas Motor Speedway - 2009 - Road Course Short A",
  "[Legacy] Texas Motor Speedway - 2009 - Road Course Short B",
])].sort();

const TrackSelect = ({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = query.length > 1 ? IRACING_TRACKS.filter(t => t.toLowerCase().includes(query.toLowerCase())).slice(0, 40) : [];
  return (
    <div className="relative">
      <input
        type="text"
        value={open ? query : value}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={value || "Zoek circuit..."}
        className={className || "w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-xl max-h-56 overflow-y-auto">
          {filtered.map(t => (
            <button
              key={t}
              type="button"
              onMouseDown={() => { onChange(t); setQuery(""); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors truncate"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const DriversList = () => {
  const queryClient = useQueryClient();
  const { user: currentUser, isSuperAdmin: currentIsSuperAdmin } = useAuth();

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["admin-all-profiles"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_get_all_profiles");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_get_user_roles");
      if (error) throw error;
      return data || [];
    },
  });

  const isAdmin = (userId: string) =>
    (userRoles || []).some((r: any) => r.user_id === userId && r.role === "admin");
  const isSuperAdmin = (userId: string) =>
    (userRoles || []).some((r: any) => r.user_id === userId && r.role === "super_admin");

  const toggleAdmin = useMutation({
    mutationFn: async ({ userId, grant }: { userId: string; grant: boolean }) => {
      const fn = grant ? "admin_grant_role" : "admin_revoke_role";
      const { error } = await (supabase as any).rpc(fn, { target_user_id: userId, target_role: "admin" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteDriver = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await (supabase as any).rpc("admin_delete_user", { target_user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Driver verwijderd");
      queryClient.invalidateQueries({ queryKey: ["admin-all-profiles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-card rounded-lg animate-pulse" />)}</div>;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="grid grid-cols-[1fr_8rem_6rem_5rem_6rem_3rem] gap-3 px-4 py-2.5 bg-secondary/40 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <span>Driver</span>
        <span>iRacing ID</span>
        <span>iRating</span>
        <span>Safety</span>
        <span>Rol</span>
        <span></span>
      </div>
      {profiles?.map((p: any) => {
        const admin = isAdmin(p.user_id);
        const superAdmin = isSuperAdmin(p.user_id);
        const isMe = p.user_id === currentUser?.id;
        return (
          <div key={p.user_id} className="grid grid-cols-[1fr_8rem_6rem_5rem_6rem_3rem] gap-3 px-4 py-3 items-center border-b border-border/40 hover:bg-secondary/20 transition-colors">
            <div>
              <div className="font-heading font-bold text-sm flex items-center gap-2">
                {p.display_name || p.iracing_name || "—"}
                {superAdmin && (
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: "rgba(250,204,21,0.12)", color: "#facc15", border: "1px solid rgba(250,204,21,0.3)" }}>
                    ★ Super Admin
                  </span>
                )}
              </div>
              {p.iracing_name && p.display_name !== p.iracing_name && (
                <div className="text-xs text-muted-foreground">{p.iracing_name}</div>
              )}
            </div>
            <span className="text-xs font-mono text-muted-foreground">{p.iracing_id || "—"}</span>
            <span className="text-sm font-heading font-bold">{p.irating ? p.irating.toLocaleString() : "—"}</span>
            <span className="text-sm text-muted-foreground">{p.safety_rating || "—"}</span>
            {/* Role toggle: only super_admin can change roles, super_admin row is locked */}
            {superAdmin ? (
              <span className="text-xs px-2 py-1 rounded font-bold" style={{ background: "rgba(250,204,21,0.12)", color: "#facc15", border: "1px solid rgba(250,204,21,0.3)" }}>
                Super Admin
              </span>
            ) : currentIsSuperAdmin ? (
              <button
                onClick={() => toggleAdmin.mutate({ userId: p.user_id, grant: !admin })}
                disabled={toggleAdmin.isPending}
                className={`text-xs px-2 py-1 rounded font-bold transition-colors ${admin ? "bg-accent/20 text-accent border border-accent/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30" : "bg-secondary text-muted-foreground border border-border hover:bg-accent/10 hover:text-accent"}`}
              >
                {admin ? "Admin" : "—"}
              </button>
            ) : (
              <span className={`text-xs px-2 py-1 rounded font-bold ${admin ? "bg-accent/20 text-accent border border-accent/30" : "text-muted-foreground"}`}>
                {admin ? "Admin" : "—"}
              </span>
            )}
            <button
              onClick={() => {
                if (confirm(`Weet je zeker dat je ${p.display_name || p.iracing_name} wilt verwijderen?`)) {
                  deleteDriver.mutate(p.user_id);
                }
              }}
              disabled={deleteDriver.isPending || superAdmin || isMe}
              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
      {!profiles?.length && (
        <div className="py-12 text-center text-muted-foreground text-sm">Geen drivers gevonden.</div>
      )}
    </div>
  );
};

const AdminPage = () => {
  const { user, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  const [newLeague, setNewLeague] = useState({ name: "", description: "", season: "", car_class: "", raceCount: 6 });
  const [races, setRaces] = useState<{ name: string; track: string; date: string; time: string; race_type: string; race_duration: string; practice_duration: string; qualifying_duration: string; start_type: string; weather: string; setup: string }[]>([]);
  const [showLeagueForm, setShowLeagueForm] = useState(false);
  const [editingLeagueId, setEditingLeagueId] = useState<string | null>(null);
  const [editingLeagueData, setEditingLeagueData] = useState({ name: "", description: "", season: "", car_class: "" });
  const [editingRaces, setEditingRaces] = useState<Record<string, any>>({});

  const [showSoloRaceForm, setShowSoloRaceForm] = useState(false);
  const [newSoloRace, setNewSoloRace] = useState({ name: "", track: "", date: "", time: "20:00", race_type: "Feature", race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min", start_type: "Standing", weather: "Fixed", setup: "Fixed" });
  const [editingSoloRaceId, setEditingSoloRaceId] = useState<string | null>(null);
  const [editingSoloRaceData, setEditingSoloRaceData] = useState<any>({});

  const [newTeam, setNewTeam] = useState({ name: "", description: "", color: "#f97316", logo_url: "" });
  const [newTeamLogoPreview, setNewTeamLogoPreview] = useState<string>("");
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamLogo, setEditingTeamLogo] = useState<string>("");
  const [editingTeamCurrentLogo, setEditingTeamCurrentLogo] = useState<string>("");
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [iratingSyncing, setIratingSyncing] = useState(false);
  const [iratingSyncResult, setIratingSyncResult] = useState<{ updated?: number; error?: string } | null>(null);

  const [importRaceId, setImportRaceId] = useState("");
  const [importRows, setImportRows] = useState<
    { position: number; display_name: string; laps: number; best_lap: string; incidents: number; fastest_lap: boolean; iracing_cust_id?: string; new_irating?: number; new_license_level?: number; new_license_sub_level?: number; car_name?: string }[]
  >([{ position: 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }]);
  const [pointsConfig] = useState<number[]>(DEFAULT_POINTS);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [jsonFileName, setJsonFileName] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"manual" | "csv" | "json">("csv");

  const [selectedLeagueForPoints, setSelectedLeagueForPoints] = useState("");
  const [leaguePoints, setLeaguePoints] = useState<number[]>(DEFAULT_POINTS);

  const { data: leagues } = useQuery({
    queryKey: ["admin-leagues"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leagues").select("*, races(*)");
      if (error) throw error;
      return data;
    },
  });

  const { data: teams } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name, description, color, created_at, team_memberships(id, user_id, profiles(display_name, iracing_name))");
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, display_name, iracing_name, iracing_id");
      if (error) throw error;
      return data;
    },
  });

  const { data: allRaces } = useQuery({
    queryKey: ["all-races-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("races").select("id, name, track, race_date, league_id, status, practice_duration, qualifying_duration, race_duration, start_type, weather, setup, leagues(name, season)").order("race_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: totalDrivers } = useQuery({
    queryKey: ["total-drivers"],
    queryFn: async () => {
      const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: seasonRegistrations } = useQuery({
    queryKey: ["admin-season-registrations"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("season_registrations")
        .select("league_id, user_id, status, created_at, car_choice, car_locked");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: raceRegistrations } = useQuery({
    queryKey: ["admin-race-registrations"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("race_registrations")
        .select("race_id, user_id, status, created_at, car_choice, car_locked");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: creationRequests } = useQuery({
    queryKey: ["team-creation-requests"],
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("team_creation_requests")
        .select("*, profiles(display_name, iracing_name)")
        .eq("status", "pending");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: totalResults } = useQuery({
    queryKey: ["total-results"],
    queryFn: async () => {
      const { count } = await supabase.from("race_results").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const createLeague = useMutation({
    mutationFn: async () => {
      const { data: league, error } = await supabase
        .from("leagues")
        .insert({ name: newLeague.name, description: newLeague.description, season: newLeague.season, car_class: newLeague.car_class, created_by: user!.id })
        .select().single();
      if (error) throw error;
      if (races.length > 0) {
        const { error: re } = await supabase.from("races").insert(
          races.map((r, i) => ({ league_id: league.id, round: i + 1, name: r.name, track: r.track, race_date: amsToUTC(`${r.date}T${r.time}`), status: "upcoming" as const, race_type: r.race_type || null, race_duration: r.race_duration || null, practice_duration: r.practice_duration || null, qualifying_duration: r.qualifying_duration || null, start_type: r.start_type || null, weather: r.weather || null, setup: r.setup || null } as any))
        );
        if (re) throw re;
      }
      return league;
    },
    onSuccess: () => {
      toast.success("Seizoen aangemaakt!");
      queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
      queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
      setShowLeagueForm(false);
      setNewLeague({ name: "", description: "", season: "", car_class: "", raceCount: 6 });
      setRaces([]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteLeague = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leagues").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Verwijderd"); queryClient.invalidateQueries({ queryKey: ["admin-leagues"] }); },
  });

  const createSoloRace = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("races").insert({
        league_id: null,
        name: newSoloRace.name,
        track: newSoloRace.track,
        race_date: amsToUTC(`${newSoloRace.date}T${newSoloRace.time}`),
        status: "upcoming",
        race_type: newSoloRace.race_type || null,
        race_duration: newSoloRace.race_duration || null,
        practice_duration: newSoloRace.practice_duration || null,
        qualifying_duration: newSoloRace.qualifying_duration || null,
        start_type: newSoloRace.start_type || null,
        weather: newSoloRace.weather || null,
        setup: newSoloRace.setup || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Losse race aangemaakt!");
      queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
      setShowSoloRaceForm(false);
      setNewSoloRace({ name: "", track: "", date: "", time: "20:00", race_type: "Feature", race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min", start_type: "Standing", weather: "Fixed", setup: "Fixed" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteSoloRace = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("races").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Race verwijderd"); queryClient.invalidateQueries({ queryKey: ["all-races-admin"] }); },
  });

  const updateRace = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { error } = await (supabase as any).from("races").update({
        name: data.name,
        track: data.track,
        race_date: amsToUTC(data.race_date),
        race_type: data.race_type || null,
        race_duration: data.race_duration || null,
        practice_duration: data.practice_duration || null,
        qualifying_duration: data.qualifying_duration || null,
        start_type: data.start_type || null,
        weather: data.weather || null,
        setup: data.setup || null,
        status: data.status || "upcoming",
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Race opgeslagen!");
      queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateLeague = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editingLeagueData }) => {
      const { error } = await supabase.from("leagues").update({ name: data.name, description: data.description || null, season: data.season || null, car_class: data.car_class || null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Seizoen bijgewerkt!");
      queryClient.invalidateQueries({ queryKey: ["admin-leagues"] });
      setEditingLeagueId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createTeam = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("teams").insert({ name: newTeam.name, description: newTeam.description || null, color: newTeam.color, logo_url: newTeamLogoPreview || null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team aangemaakt!");
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      setShowTeamForm(false);
      setNewTeam({ name: "", description: "", color: "#f97316", logo_url: "" });
      setNewTeamLogoPreview("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTeam = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Team verwijderd"); queryClient.invalidateQueries({ queryKey: ["admin-teams"] }); },
  });

  const approveCreationRequest = useMutation({
    mutationFn: async (req: any) => {
      // Create the new team
      const { data: team, error: teamErr } = await (supabase as any).from("teams").insert({
        name: req.team_name,
        description: req.team_description || null,
        color: req.team_color || "#f97316",
        logo_url: req.logo_url || null,
      }).select().single();
      if (teamErr) throw teamErr;
      // Set team_id on the requester's profile
      await supabase.from("profiles").update({ team_id: team.id } as any).eq("user_id", req.user_id);
      // Create team_membership
      await (supabase as any).from("team_memberships").insert({ user_id: req.user_id, team_id: team.id, role: "driver" });
      // Delete request
      await (supabase as any).from("team_creation_requests").delete().eq("id", req.id);
    },
    onSuccess: () => {
      toast.success("Team aangemaakt en goedgekeurd!");
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["all-profiles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const denyCreationRequest = useMutation({
    mutationFn: async (reqId: string) => {
      await (supabase as any).from("team_creation_requests").delete().eq("id", reqId);
    },
    onSuccess: () => {
      toast.success("Aanvraag afgewezen.");
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests"] });
    },
  });

  const updateTeamLogo = useMutation({
    mutationFn: async ({ teamId, logoUrl }: { teamId: string; logoUrl: string }) => {
      const { error } = await (supabase as any).from("teams").update({ logo_url: logoUrl || null }).eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Logo bijgewerkt!");
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      setEditingTeamId(null);
      setEditingTeamLogo("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const importResults = useMutation({
    mutationFn: async () => {
      if (!importRaceId) throw new Error("Selecteer een race");
      let iRatingUpdates = 0;
      for (const row of importRows) {
        if (!row.display_name.trim()) continue;
        // Match by iRacing Customer ID first, then by name
        const profile = profiles?.find((p: any) =>
          (row.iracing_cust_id && String((p as any).iracing_id) === String(row.iracing_cust_id)) ||
          (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
          (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
        );
        if (!profile) { toast.error(`Driver niet gevonden: ${row.display_name}`); continue; }
        const pts = (pointsConfig[row.position - 1] ?? 0) + (row.fastest_lap ? 1 : 0);
        const { error } = await supabase.from("race_results").upsert(
          { race_id: importRaceId, user_id: profile.user_id, position: row.position, points: pts, fastest_lap: row.fastest_lap, laps: row.laps, best_lap: row.best_lap || null, incidents: row.incidents, dnf: false, irating_snapshot: (row as any).new_irating ?? null },
          { onConflict: "race_id,user_id" }
        );
        if (error) throw error;
        // Auto-update iRating + safety rating from CSV data
        if (row.new_irating && row.new_license_level && row.new_license_sub_level !== undefined) {
          const licLetters = ["", "R", "D", "C", "B", "A"];
          const licIdx = Math.min(Math.ceil(row.new_license_level / 4), 5);
          const safetyRating = `${licLetters[licIdx]} ${(row.new_license_sub_level / 100).toFixed(2)}`;
          const { error: profErr } = await supabase.from("profiles").update({ irating: row.new_irating, safety_rating: safetyRating }).eq("user_id", profile.user_id);
          if (profErr) toast.error(`iRating update mislukt voor ${row.display_name}: ${profErr.message}`);
          else iRatingUpdates++;
        }
      }
      await supabase.from("races").update({ status: "completed", counts_for_3sr: true }).eq("id", importRaceId);
      await supabase.rpc("recalculate_3sr_for_race", { p_race_id: importRaceId });
      // Auto-fill car_choice in season_registrations (only if not locked)
      const raceForCar = (allRaces || []).find((r: any) => r.id === importRaceId);
      if (raceForCar?.league_id) {
        const { data: freshProfiles } = await supabase.from("profiles").select("user_id, iracing_id, display_name, iracing_name");
        console.log("[car_choice] league_id:", raceForCar.league_id);
        console.log("[car_choice] profiles:", freshProfiles?.map((p: any) => ({ id: p.iracing_id, name: p.display_name })));
        for (const row of importRows) {
          if (!row.car_name) continue;
          const profile = freshProfiles?.find((p: any) =>
            (row.iracing_cust_id && String(p.iracing_id) === String(row.iracing_cust_id)) ||
            (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
            (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
          );
          console.log(`[car_choice] ${row.display_name} (${row.iracing_cust_id}) → car: ${row.car_name} → profile: ${profile?.user_id ?? "NOT FOUND"}`);
          if (!profile) continue;
          const { error: carErr } = await (supabase as any).from("season_registrations")
            .update({ car_choice: row.car_name })
            .eq("league_id", raceForCar.league_id)
            .eq("user_id", profile.user_id)
            .eq("car_locked", false);
          if (carErr) console.error("[car_choice] update error:", carErr.message);
        }
      }
      if (iRatingUpdates > 0) toast.success(`iRating bijgewerkt voor ${iRatingUpdates} drivers`);
    },
    onSuccess: () => {
      toast.success("Resultaten geïmporteerd!");
      queryClient.invalidateQueries({ queryKey: ["all-results-with-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
      queryClient.invalidateQueries({ queryKey: ["completed-races"] });
      setImportRaceId("");
      setImportRows([{ position: 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }]);
      setCsvFileName(null);
      setJsonFileName(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const savePointsConfig = useMutation({
    mutationFn: async () => {
      if (!selectedLeagueForPoints) throw new Error("Selecteer een league");
      const { error } = await supabase.from("points_config").upsert(
        leaguePoints.map((pts, i) => ({ league_id: selectedLeagueForPoints, position: i + 1, points: pts })),
        { onConflict: "league_id,position" }
      );
      if (error) throw error;
    },
    onSuccess: () => toast.success("Punten systeem opgeslagen!"),
    onError: (err: Error) => toast.error(err.message),
  });

  const generateRaceSlots = () => {
    setRaces(Array.from({ length: newLeague.raceCount }, (_, i) => ({ name: `Race ${i + 1}`, track: "", date: "", time: "20:00", race_type: "Feature", race_duration: "60 min", practice_duration: "15 min", qualifying_duration: "10 min", start_type: "Standing", weather: "Fixed", setup: "Fixed" })));
  };

  if (loading) return null;
  if (!user) return <Navigate to="/auth" />;
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-16 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <Settings className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h1 className="font-heading text-2xl font-black mb-2">GEEN TOEGANG</h1>
            <p className="text-muted-foreground">Je hebt admin rechten nodig om deze pagina te bekijken.</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const nextRace = allRaces?.find((r: any) => r.status !== "completed");
  const activeLeague = leagues?.find((l: any) => l.status === "active");

  const tabs: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Dashboard", icon: BarChart2 },
    { id: "seasons", label: "Seizoenen", icon: Trophy },
    { id: "teams", label: "Teams", icon: Car },
    { id: "drivers", label: "Drivers", icon: Users },
    { id: "results", label: "Resultaten", icon: Upload },
    { id: "points", label: "Punten", icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="py-10 bg-gradient-to-b from-card/50 to-transparent border-b border-border">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-1">
              <Settings className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">Admin</span>
            </div>
            <h1 className="font-heading text-4xl font-black">ADMIN PANEL</h1>
          </div>
        </section>

        <div className="border-b border-border bg-card/30 sticky top-16 z-40">
          <div className="container mx-auto px-4">
            <div className="flex overflow-x-auto gap-1 py-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === tab.id ? "bg-gradient-racing text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="py-10">
          <div className="container mx-auto px-4">

            {activeTab === "overview" && (
              <div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                  {[
                    { label: "Drivers", value: totalDrivers ?? 0, icon: Users, color: "text-blue-400" },
                    { label: "Teams", value: teams?.length ?? 0, icon: Car, color: "text-green-400" },
                    { label: "Seizoenen", value: leagues?.length ?? 0, icon: Trophy, color: "text-yellow-400" },
                    { label: "Resultaten", value: totalResults ?? 0, icon: BarChart2, color: "text-accent" },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-card border border-border rounded-lg p-5 text-center">
                      <stat.icon className={`w-6 h-6 mx-auto mb-2 ${stat.color}`} />
                      <div className="font-heading font-black text-3xl">{stat.value}</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  {nextRace && (() => {
                    const nr = nextRace as any;
                    const trackInfo = getTrackInfo(nr.track);
                    const diff = new Date(nr.race_date).getTime() - Date.now();
                    const d = Math.floor(diff / 86400000);
                    const h = Math.floor((diff % 86400000) / 3600000);
                    const m = Math.floor((diff % 3600000) / 60000);
                    const countdown = diff > 0 ? (d > 0 ? `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m` : `${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m`) : null;
                    const sessions = [
                      nr.practice_duration  && { label: "Practice",   dur: nr.practice_duration,   color: "bg-blue-500/70" },
                      nr.qualifying_duration && { label: "Qualifying", dur: nr.qualifying_duration, color: "bg-yellow-500/70" },
                      nr.race_duration       && { label: "Race",       dur: nr.race_duration,       color: "bg-primary/80" },
                    ].filter(Boolean) as { label: string; dur: string; color: string }[];
                    return (
                      <div className="bg-card border border-primary/30 rounded-lg p-5 racing-stripe-left relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />
                        <div className="relative flex gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-primary uppercase tracking-[0.1em] flex items-center gap-2 mb-2"><Calendar className="w-4 h-4" />Volgende Race</div>
                            <h3 className="font-heading font-black text-xl mb-1">{nr.name}</h3>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              <span>{nr.track}</span>
                              {trackInfo?.country && <span className="opacity-60 text-xs">— {trackInfo.country}</span>}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2 flex-wrap">
                              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(nr.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })}</span>
                              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(nr.race_date).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}</span>
                              {!nr.leagues ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide" style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>Losse Race</span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide" style={{ background: "rgba(249,115,22,0.08)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)" }}>{nr.leagues.name}{nr.leagues.season ? ` · ${nr.leagues.season}` : ""}</span>
                              )}
                            </div>
                            {sessions.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                                {sessions.map((s, i) => (
                                  <span key={i} className={`${s.color} px-2 py-0.5 rounded text-[10px] font-bold text-white tracking-wide`}>{s.label} · {s.dur}</span>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-3 flex-wrap">
                              {nr.start_type && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Flag className="w-3 h-3" /> {nr.start_type} start</span>}
                              {nr.weather && <span className="flex items-center gap-1 text-xs text-muted-foreground"><CloudSun className="w-3 h-3" /> Weather: {nr.weather}</span>}
                              {nr.setup && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Gauge className="w-3 h-3" /> Setup: {nr.setup}</span>}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-3 shrink-0">
                            {trackInfo?.imageUrl && (
                              <img src={trackInfo.imageUrl} alt="" aria-hidden className="w-24 h-16 object-contain invert opacity-25" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            )}
                            {countdown && (
                              <div className="text-right">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Aftellen</p>
                                <p className="font-heading font-black text-xl tabular-nums flex items-center gap-1"><Timer className="w-4 h-4 text-primary" />{countdown}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {activeLeague && (
                    <div className="bg-card border border-border rounded-lg p-5 racing-stripe-left">
                      <div className="text-sm font-medium text-accent uppercase tracking-[0.1em] flex items-center gap-2 mb-1"><Trophy className="w-4 h-4" />Actief Seizoen</div>
                      <h3 className="font-heading font-black text-xl">{activeLeague.name}</h3>
                      <p className="text-muted-foreground text-sm mt-1">{activeLeague.season} {activeLeague.car_class && `• ${activeLeague.car_class}`} • {(activeLeague as any).races?.length || 0} races</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "seasons" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-heading text-2xl font-black">SEIZOENEN</h2>
                  <button onClick={() => { setShowLeagueForm(!showLeagueForm); if (!showLeagueForm) generateRaceSlots(); }} className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity">
                    <Plus className="w-4 h-4" />Nieuw Seizoen
                  </button>
                </div>
                {showLeagueForm && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-6 racing-stripe-left">
                    <h3 className="font-heading text-lg font-bold mb-4">NIEUW SEIZOEN</h3>
                    <div className="grid gap-4 md:grid-cols-2 mb-4">
                      {[
                        { label: "Naam *", key: "name", placeholder: "GT3 Championship" },
                        { label: "Seizoen", key: "season", placeholder: "2026 S1" },
                        { label: "Auto Klasse", key: "car_class", placeholder: "GT3" },
                      ].map(({ label, key, placeholder }) => (
                        <div key={key}>
                          <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{label}</label>
                          <input type="text" value={(newLeague as any)[key]} onChange={(e) => setNewLeague({ ...newLeague, [key]: e.target.value })} placeholder={placeholder} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                      ))}
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Aantal Races</label>
                        <input type="number" min={1} max={24} value={newLeague.raceCount} onChange={(e) => setNewLeague({ ...newLeague, raceCount: parseInt(e.target.value) || 1 })} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Beschrijving</label>
                        <textarea value={newLeague.description} onChange={(e) => setNewLeague({ ...newLeague, description: e.target.value })} rows={2} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
                      </div>
                    </div>
                    <button onClick={generateRaceSlots} className="mb-4 px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Genereer {newLeague.raceCount} race slots</button>
                    {races.length > 0 && (
                      <div className="space-y-3 mb-4">
                        {races.map((race, i) => {
                          const upd = (key: string, val: string) => { const u = [...races]; (u[i] as any)[key] = val; setRaces(u); };
                          return (
                            <div key={i} className="p-3 bg-secondary/50 rounded-md border border-border/50 space-y-2">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <input type="text" value={race.name} onChange={(e) => upd("name", e.target.value)} placeholder={`Race ${i + 1}`} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                <TrackSelect value={race.track} onChange={v => upd("track", v)} />
                                <input type="date" value={race.date} onChange={(e) => upd("date", e.target.value)} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                <input type="time" value={race.time} onChange={(e) => upd("time", e.target.value)} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race type</label>
                                  <select value={race.race_type} onChange={(e) => upd("race_type", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    {["Sprint", "Feature", "Endurance"].map((v) => <option key={v}>{v}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Duur race</label>
                                  <input type="text" value={race.race_duration} onChange={(e) => upd("race_duration", e.target.value)} placeholder="60 min / 30 laps" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Start type</label>
                                  <select value={race.start_type} onChange={(e) => upd("start_type", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    {["Standing", "Rolling"].map((v) => <option key={v}>{v}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Practice</label>
                                  <input type="text" value={race.practice_duration} onChange={(e) => upd("practice_duration", e.target.value)} placeholder="15 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Qualifying</label>
                                  <input type="text" value={race.qualifying_duration} onChange={(e) => upd("qualifying_duration", e.target.value)} placeholder="10 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Weather</label>
                                  <select value={race.weather} onChange={(e) => upd("weather", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    {["Fixed", "Dynamic"].map((v) => <option key={v}>{v}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Setup</label>
                                  <select value={race.setup} onChange={(e) => upd("setup", e.target.value)} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    {["Fixed", "Open"].map((v) => <option key={v}>{v}</option>)}
                                  </select>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button onClick={() => createLeague.mutate()} disabled={!newLeague.name || createLeague.isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{createLeague.isPending ? "Aanmaken..." : "Aanmaken"}</button>
                      <button onClick={() => setShowLeagueForm(false)} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Annuleren</button>
                    </div>
                  </motion.div>
                )}
                <div className="space-y-3">
                  {leagues?.map((league: any) => {
                    const regs = (seasonRegistrations || []).filter((r: any) => r.league_id === league.id);
                    const isEditing = editingLeagueId === league.id;
                    return (
                      <div key={league.id} className="bg-card border border-border rounded-lg p-5 racing-stripe-left">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-heading font-bold text-lg">{league.name}</h3>
                            <div className="flex gap-3 text-sm text-muted-foreground mt-1">
                              {league.season && <span>{league.season}</span>}
                              {league.car_class && <span>• {league.car_class}</span>}
                              <span>• {(league as any).races?.length || 0} races</span>
                              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{regs.length} ingeschreven</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                if (isEditing) { setEditingLeagueId(null); setEditingRaces({}); return; }
                                setEditingLeagueId(league.id);
                                setEditingLeagueData({ name: league.name, description: league.description || "", season: league.season || "", car_class: league.car_class || "" });
                                const raceMap: Record<string, any> = {};
                                (league as any).races?.forEach((r: any) => { raceMap[r.id] = { ...r }; });
                                setEditingRaces(raceMap);
                              }}
                              className="p-2 text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => deleteLeague.mutate(league.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>

                        {isEditing && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 pt-4 border-t border-border space-y-4">
                            {/* Seizoen info */}
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Seizoen bewerken</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {([["Naam", "name", "GT3 Championship"], ["Seizoen", "season", "2026 S1"], ["Auto klasse", "car_class", "GT3"], ["Beschrijving", "description", ""]] as const).map(([label, key, ph]) => (
                                <div key={key}>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
                                  <input type="text" value={(editingLeagueData as any)[key]} onChange={(e) => setEditingLeagueData({ ...editingLeagueData, [key]: e.target.value })} placeholder={ph} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => updateLeague.mutate({ id: league.id, data: editingLeagueData })} disabled={updateLeague.isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50">
                                <Save className="w-3 h-3" /> Opslaan
                              </button>
                              <button onClick={() => { setEditingLeagueId(null); setEditingRaces({}); }} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border">Annuleren</button>
                            </div>

                            {/* Races bewerken */}
                            {(league as any).races?.length > 0 && (
                              <div className="pt-3 border-t border-border/50 space-y-3">
                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Races bewerken</p>
                                {[...(league as any).races].sort((a: any, b: any) => a.round - b.round).map((race: any) => {
                                  const rd = editingRaces[race.id] || race;
                                  const setRd = (field: string, val: string) => setEditingRaces(prev => ({ ...prev, [race.id]: { ...prev[race.id], [field]: val } }));
                                  return (
                                    <div key={race.id} className="p-3 rounded-md bg-secondary/30 border border-border/50 space-y-2">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="font-heading font-black text-sm text-muted-foreground">R{String(race.round).padStart(2, "0")}</span>
                                      </div>
                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Naam</label>
                                          <input type="text" value={rd.name || ""} onChange={e => setRd("name", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Circuit</label>
                                          <TrackSelect value={rd.track || ""} onChange={v => setRd("track", v)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Datum & tijd</label>
                                          <input type="datetime-local" value={rd.race_date ? (rd.race_date.length > 16 ? utcToAmsLocal(rd.race_date) : rd.race_date) : ""} onChange={e => setRd("race_date", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race type</label>
                                          <select value={rd.race_type || ""} onChange={e => setRd("race_type", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                            <option value="">—</option>
                                            {["Laps", "Timed", "Laps + Timed"].map(t => <option key={t} value={t}>{t}</option>)}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race duur</label>
                                          <input type="text" value={rd.race_duration || ""} onChange={e => setRd("race_duration", e.target.value)} placeholder="bv. 45 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Practice</label>
                                          <input type="text" value={rd.practice_duration || ""} onChange={e => setRd("practice_duration", e.target.value)} placeholder="bv. 15 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Qualifying</label>
                                          <input type="text" value={rd.qualifying_duration || ""} onChange={e => setRd("qualifying_duration", e.target.value)} placeholder="bv. 10 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Start type</label>
                                          <select value={rd.start_type || ""} onChange={e => setRd("start_type", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                            <option value="">—</option>
                                            {["Rolling", "Standing"].map(t => <option key={t} value={t}>{t}</option>)}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Weather</label>
                                          <select value={rd.weather || ""} onChange={e => setRd("weather", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                            <option value="">—</option>
                                            {["Clear", "Partly Cloudy", "Overcast", "Rain", "Dynamic"].map(t => <option key={t} value={t}>{t}</option>)}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Setup</label>
                                          <select value={rd.setup || ""} onChange={e => setRd("setup", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                            <option value="">—</option>
                                            {["Fixed", "Open"].map(t => <option key={t} value={t}>{t}</option>)}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Status</label>
                                          <select value={rd.status || "upcoming"} onChange={e => setRd("status", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                            {["upcoming", "live", "completed", "cancelled"].map(t => <option key={t} value={t}>{t}</option>)}
                                          </select>
                                        </div>
                                      </div>
                                      <button
                                        onClick={() => updateRace.mutate({ id: race.id, data: rd })}
                                        disabled={updateRace.isPending}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-secondary border border-border hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50"
                                      >
                                        <Save className="w-3 h-3" /> Race opslaan
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </motion.div>
                        )}

                        {(() => {
                          // Season registrations for this league
                          const seasonRegs = regs;
                          const seasonUserIds = new Set(seasonRegs.map((r: any) => r.user_id));

                          // Race registrations for races in this league, excluding season-registered users
                          const leagueRaceIds = new Set(((league as any).races || []).map((r: any) => r.id));
                          const raceRegsForLeague = (raceRegistrations || []).filter(
                            (r: any) => leagueRaceIds.has(r.race_id) && !seasonUserIds.has(r.user_id)
                          );
                          // Group by user
                          const raceRegsByUser: Record<string, { userId: string; raceIds: string[] }> = {};
                          raceRegsForLeague.forEach((r: any) => {
                            if (!raceRegsByUser[r.user_id]) raceRegsByUser[r.user_id] = { userId: r.user_id, raceIds: [] };
                            raceRegsByUser[r.user_id].raceIds.push(r.race_id);
                          });
                          const raceRegUsers = Object.values(raceRegsByUser);

                          if (seasonRegs.length === 0 && raceRegUsers.length === 0) return null;

                          return (
                            <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
                              {seasonRegs.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-accent inline-block" />
                                    Heel seizoen ({seasonRegs.length})
                                  </p>
                                  <div className="space-y-1.5">
                                    {seasonRegs.map((r: any) => {
                                      const p = (profiles || []).find((p: any) => p.user_id === r.user_id);
                                      return (
                                        <div key={r.user_id} className="flex items-center gap-2">
                                          <span className="w-28 shrink-0 px-2.5 py-1 rounded-full bg-accent/15 text-accent text-xs font-medium border border-accent/30 truncate">
                                            {p?.display_name || p?.iracing_name || r.user_id.slice(0, 8)}
                                          </span>
                                          <input
                                            type="text"
                                            defaultValue={r.car_choice || ""}
                                            disabled={r.car_locked}
                                            placeholder="Auto..."
                                            className="flex-1 px-2 py-1 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            onBlur={async (e) => {
                                              const val = e.target.value.trim();
                                              if (val === (r.car_choice || "")) return;
                                              await (supabase as any).from("season_registrations")
                                                .update({ car_choice: val || null })
                                                .eq("league_id", r.league_id).eq("user_id", r.user_id);
                                              queryClient.invalidateQueries({ queryKey: ["admin-season-registrations"] });
                                            }}
                                          />
                                          <button
                                            title={r.car_locked ? "Klik om te unlocken" : "Klik om te locken"}
                                            onClick={async () => {
                                              await (supabase as any).from("season_registrations")
                                                .update({ car_locked: !r.car_locked })
                                                .eq("league_id", r.league_id).eq("user_id", r.user_id);
                                              queryClient.invalidateQueries({ queryKey: ["admin-season-registrations"] });
                                            }}
                                            className="text-base leading-none hover:scale-110 transition-transform"
                                          >
                                            {r.car_locked ? "🔒" : "🔓"}
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              {raceRegUsers.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                                    Los per race ({raceRegUsers.length})
                                  </p>
                                  <div className="space-y-1.5">
                                    {raceRegUsers.map(({ userId, raceIds }) => {
                                      const p = (profiles || []).find((p: any) => p.user_id === userId);
                                      const raceNames = raceIds.map(rid => {
                                        const race = ((league as any).races || []).find((r: any) => r.id === rid);
                                        return race ? `R${String(race.round).padStart(2, "0")}` : rid.slice(0, 6);
                                      }).sort().join(", ");
                                      // Gebruik eerste race_registratie entry voor car_choice/car_locked
                                      const firstReg = (raceRegistrations || []).find((r: any) => r.user_id === userId && raceIds.includes(r.race_id));
                                      return (
                                        <div key={userId} className="flex items-center gap-2">
                                          <span className="w-28 shrink-0 px-2.5 py-1 rounded-full bg-secondary text-foreground text-xs font-medium border border-border truncate">
                                            {p?.display_name || p?.iracing_name || userId.slice(0, 8)}
                                          </span>
                                          <span className="text-muted-foreground text-xs w-12 shrink-0">{raceNames}</span>
                                          <input
                                            type="text"
                                            defaultValue={firstReg?.car_choice || ""}
                                            disabled={firstReg?.car_locked}
                                            placeholder="Auto..."
                                            className="flex-1 px-2 py-1 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            onBlur={async (e) => {
                                              const val = e.target.value.trim();
                                              if (val === (firstReg?.car_choice || "")) return;
                                              for (const rid of raceIds) {
                                                await (supabase as any).from("race_registrations")
                                                  .update({ car_choice: val || null })
                                                  .eq("race_id", rid).eq("user_id", userId).eq("car_locked", false);
                                              }
                                              queryClient.invalidateQueries({ queryKey: ["admin-race-registrations"] });
                                            }}
                                          />
                                          <button
                                            title={firstReg?.car_locked ? "Klik om te unlocken" : "Klik om te locken"}
                                            onClick={async () => {
                                              for (const rid of raceIds) {
                                                await (supabase as any).from("race_registrations")
                                                  .update({ car_locked: !firstReg?.car_locked })
                                                  .eq("race_id", rid).eq("user_id", userId);
                                              }
                                              queryClient.invalidateQueries({ queryKey: ["admin-race-registrations"] });
                                            }}
                                            className="text-base leading-none hover:scale-110 transition-transform"
                                          >
                                            {firstReg?.car_locked ? "🔒" : "🔓"}
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                  {!leagues?.length && <div className="text-center py-16 text-muted-foreground"><Trophy className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>Nog geen seizoenen.</p></div>}
                </div>

                {/* ── Losse Races ── */}
                <div className="mt-10">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="font-heading text-2xl font-black">LOSSE RACES</h2>
                    <button onClick={() => setShowSoloRaceForm(!showSoloRaceForm)} className="flex items-center gap-2 px-4 py-2 rounded-md bg-secondary border border-border text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity">
                      <Plus className="w-4 h-4" />Losse Race
                    </button>
                  </div>

                  {showSoloRaceForm && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-6">
                      <h3 className="font-heading text-lg font-bold mb-4">NIEUWE LOSSE RACE</h3>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <input type="text" value={newSoloRace.name} onChange={(e) => setNewSoloRace({ ...newSoloRace, name: e.target.value })} placeholder="Race naam *" className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          <TrackSelect value={newSoloRace.track} onChange={v => setNewSoloRace({ ...newSoloRace, track: v })} />
                          <input type="date" value={newSoloRace.date} onChange={(e) => setNewSoloRace({ ...newSoloRace, date: e.target.value })} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          <input type="time" value={newSoloRace.time} onChange={(e) => setNewSoloRace({ ...newSoloRace, time: e.target.value })} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race type</label>
                            <select value={newSoloRace.race_type} onChange={(e) => setNewSoloRace({ ...newSoloRace, race_type: e.target.value })} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                              {["Sprint", "Feature", "Endurance"].map((v) => <option key={v}>{v}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Duur race</label>
                            <input type="text" value={newSoloRace.race_duration} onChange={(e) => setNewSoloRace({ ...newSoloRace, race_duration: e.target.value })} placeholder="60 min / 30 laps" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Start type</label>
                            <select value={newSoloRace.start_type} onChange={(e) => setNewSoloRace({ ...newSoloRace, start_type: e.target.value })} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                              {["Standing", "Rolling"].map((v) => <option key={v}>{v}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Practice</label>
                            <input type="text" value={newSoloRace.practice_duration} onChange={(e) => setNewSoloRace({ ...newSoloRace, practice_duration: e.target.value })} placeholder="15 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Qualifying</label>
                            <input type="text" value={newSoloRace.qualifying_duration} onChange={(e) => setNewSoloRace({ ...newSoloRace, qualifying_duration: e.target.value })} placeholder="10 min" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Weather</label>
                            <select value={newSoloRace.weather} onChange={(e) => setNewSoloRace({ ...newSoloRace, weather: e.target.value })} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                              {["Fixed", "Dynamic"].map((v) => <option key={v}>{v}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Setup</label>
                            <select value={newSoloRace.setup} onChange={(e) => setNewSoloRace({ ...newSoloRace, setup: e.target.value })} className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                              {["Fixed", "Open"].map((v) => <option key={v}>{v}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3 mt-4">
                        <button onClick={() => createSoloRace.mutate()} disabled={!newSoloRace.name || !newSoloRace.track || !newSoloRace.date || createSoloRace.isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{createSoloRace.isPending ? "Aanmaken..." : "Aanmaken"}</button>
                        <button onClick={() => setShowSoloRaceForm(false)} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Annuleren</button>
                      </div>
                    </motion.div>
                  )}

                  <div className="space-y-3">
                    {(allRaces || []).filter((r: any) => !r.league_id).map((race: any) => {
                      const raceRegs = (raceRegistrations || []).filter((r: any) => r.race_id === race.id);
                      const isEditingSolo = editingSoloRaceId === race.id;
                      const srd = editingSoloRaceData;
                      const setSrd = (field: string, val: string) => setEditingSoloRaceData((prev: any) => ({ ...prev, [field]: val }));
                      return (
                        <div key={race.id} className="bg-card border border-border rounded-lg p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="font-heading font-bold">{race.name}</div>
                              <div className="text-sm text-muted-foreground flex gap-3 mt-0.5 flex-wrap">
                                <span>{race.track}</span>
                                <span>•</span>
                                <span>{new Date(race.race_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}</span>
                                <span>•</span>
                                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{raceRegs.length} ingeschreven</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  if (isEditingSolo) { setEditingSoloRaceId(null); setEditingSoloRaceData({}); }
                                  else { setEditingSoloRaceId(race.id); setEditingSoloRaceData({ ...race, race_date: race.race_date ? utcToAmsLocal(race.race_date) : "" }); }
                                }}
                                className="p-2 text-muted-foreground hover:text-primary transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button onClick={() => deleteSoloRace.mutate(race.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </div>

                          {/* Registrant badges */}
                          {raceRegs.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-border/50">
                              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
                                Ingeschreven ({raceRegs.length})
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {raceRegs.map((reg: any) => {
                                  const p = (profiles || []).find((p: any) => p.user_id === reg.user_id);
                                  return (
                                    <span key={reg.user_id} className="px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-400 text-xs font-medium border border-violet-500/30">
                                      {p?.display_name || p?.iracing_name || reg.user_id.slice(0, 8)}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Edit form */}
                          {isEditingSolo && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 pt-3 border-t border-border/50 space-y-3">
                              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Race bewerken</p>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Naam</label>
                                  <input type="text" value={srd.name || ""} onChange={e => setSrd("name", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Circuit</label>
                                  <TrackSelect value={srd.track || ""} onChange={v => setSrd("track", v)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Datum & tijd</label>
                                  <input type="datetime-local" value={srd.race_date || ""} onChange={e => setSrd("race_date", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Race duur</label>
                                  <input type="text" value={srd.race_duration || ""} onChange={e => setSrd("race_duration", e.target.value)} placeholder="bv. 60 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Practice</label>
                                  <input type="text" value={srd.practice_duration || ""} onChange={e => setSrd("practice_duration", e.target.value)} placeholder="bv. 15 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Qualifying</label>
                                  <input type="text" value={srd.qualifying_duration || ""} onChange={e => setSrd("qualifying_duration", e.target.value)} placeholder="bv. 10 min" className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Weather</label>
                                  <select value={srd.weather || ""} onChange={e => setSrd("weather", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    <option value="">—</option>
                                    {["Clear", "Partly Cloudy", "Overcast", "Rain", "Dynamic"].map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Setup</label>
                                  <select value={srd.setup || ""} onChange={e => setSrd("setup", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    <option value="">—</option>
                                    {["Fixed", "Open"].map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Status</label>
                                  <select value={srd.status || ""} onChange={e => setSrd("status", e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    {["upcoming", "live", "completed", "cancelled"].map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => updateRace.mutate({ id: race.id, data: srd }, { onSuccess: () => { setEditingSoloRaceId(null); setEditingSoloRaceData({}); } })}
                                  disabled={updateRace.isPending}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50"
                                >
                                  <Save className="w-3 h-3" /> Opslaan
                                </button>
                                <button onClick={() => { setEditingSoloRaceId(null); setEditingSoloRaceData({}); }} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border">Annuleren</button>
                              </div>
                            </motion.div>
                          )}
                        </div>
                      );
                    })}
                    {!(allRaces || []).some((r: any) => !r.league_id) && (
                      <div className="text-center py-10 text-muted-foreground text-sm">Geen losse races aangemaakt.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "teams" && (
              <div>
                {/* Team creation requests */}
                {creationRequests && creationRequests.length > 0 && (
                  <div className="mb-8">
                    <h2 className="font-heading text-xl font-black mb-4 flex items-center gap-2">
                      <Clock className="w-5 h-5 text-yellow-400" />
                      NIEUWE TEAM AANVRAGEN
                      <span className="ml-1 px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-sm font-bold">{creationRequests.length}</span>
                    </h2>
                    <div className="space-y-3">
                      {creationRequests.map((req: any) => (
                        <div key={req.id} className="bg-card border border-yellow-500/20 rounded-lg p-4 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            {req.logo_url ? (
                              <img src={req.logo_url} alt={req.team_name} className="w-10 h-10 object-contain rounded-md border border-border bg-secondary/50" />
                            ) : (
                              <div className="w-3 h-10 rounded-sm shrink-0" style={{ backgroundColor: req.team_color || "#f97316" }} />
                            )}
                            <div>
                              <div className="font-heading font-bold text-base" style={{ color: req.team_color || "#f97316" }}>{req.team_name}</div>
                              {req.team_description && <div className="text-xs text-muted-foreground">{req.team_description}</div>}
                              <div className="text-xs text-muted-foreground mt-0.5">
                                Aangevraagd door <span className="font-medium text-foreground">{req.profiles?.display_name || req.profiles?.iracing_name || "Onbekend"}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => approveCreationRequest.mutate(req)}
                              disabled={approveCreationRequest.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" /> Goedkeuren
                            </button>
                            <button
                              onClick={() => denyCreationRequest.mutate(req.id)}
                              disabled={denyCreationRequest.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" /> Afwijzen
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-heading text-2xl font-black">TEAMS</h2>
                  <button onClick={() => setShowTeamForm(!showTeamForm)} className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity">
                    <Plus className="w-4 h-4" />Nieuw Team
                  </button>
                </div>
                {showTeamForm && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 mb-6 racing-stripe-left">
                    <h3 className="font-heading text-lg font-bold mb-4">NIEUW TEAM</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Team Naam *</label>
                        <input type="text" value={newTeam.name} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} placeholder="Red Bull Racing" className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Team Kleur</label>
                        <div className="flex gap-2">
                          <input type="color" value={newTeam.color} onChange={(e) => setNewTeam({ ...newTeam, color: e.target.value })} className="w-12 h-10 rounded-md border border-border cursor-pointer bg-secondary" />
                          <input type="text" value={newTeam.color} onChange={(e) => setNewTeam({ ...newTeam, color: e.target.value })} className="flex-1 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Team Logo</label>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors">
                            <ImagePlus className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">{newTeamLogoPreview ? "Logo geladen" : "Logo uploaden..."}</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const img = new Image();
                                const url = URL.createObjectURL(file);
                                img.onload = () => {
                                  const canvas = document.createElement("canvas");
                                  const max = 256;
                                  const scale = Math.min(max / img.width, max / img.height, 1);
                                  canvas.width = Math.round(img.width * scale);
                                  canvas.height = Math.round(img.height * scale);
                                  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
                                  setNewTeamLogoPreview(canvas.toDataURL("image/png"));
                                  URL.revokeObjectURL(url);
                                };
                                img.src = url;
                              }}
                            />
                          </label>
                          {newTeamLogoPreview && (
                            <div className="flex items-center gap-2">
                              <img src={newTeamLogoPreview} alt="preview" className="w-10 h-10 object-contain rounded-md border border-border bg-secondary/50" />
                              <button onClick={() => setNewTeamLogoPreview("")} className="text-muted-foreground hover:text-destructive transition-colors"><X className="w-4 h-4" /></button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Beschrijving</label>
                        <input type="text" value={newTeam.description} onChange={(e) => setNewTeam({ ...newTeam, description: e.target.value })} className="w-full px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button onClick={() => createTeam.mutate()} disabled={!newTeam.name || createTeam.isPending} className="px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">{createTeam.isPending ? "Aanmaken..." : "Team Aanmaken"}</button>
                      <button onClick={() => { setShowTeamForm(false); setNewTeamLogoPreview(""); }} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Annuleren</button>
                    </div>
                  </motion.div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  {teams?.map((team: any) => (
                    <div key={team.id} className="bg-card border border-border rounded-lg p-5" style={{ borderTopColor: team.color, borderTopWidth: 3 }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-md border border-border bg-secondary/50 flex items-center justify-center" style={{ backgroundColor: team.color + "33" }}>
                            <Car className="w-5 h-5 text-muted-foreground/50" />
                          </div>
                          <div>
                            <h3 className="font-heading font-bold text-lg">{team.name}</h3>
                            <p className="text-xs text-muted-foreground">{(team as any).team_memberships?.length || 0} drivers</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              if (editingTeamId === team.id) {
                                setEditingTeamId(null);
                                setEditingTeamLogo("");
                                setEditingTeamCurrentLogo("");
                              } else {
                                setEditingTeamId(team.id);
                                setEditingTeamLogo("");
                                setEditingTeamCurrentLogo("");
                                supabase.from("teams").select("logo_url").eq("id", team.id).single()
                                  .then(({ data }) => setEditingTeamCurrentLogo((data as any)?.logo_url || ""));
                              }
                            }}
                            className="p-2 text-muted-foreground hover:text-primary transition-colors"
                            title="Logo wijzigen"
                          >
                            <ImagePlus className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteTeam.mutate(team.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>

                      {/* Inline logo editor */}
                      {editingTeamId === team.id && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-3 p-3 rounded-md bg-secondary/40 border border-border space-y-2">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Logo wijzigen</p>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors text-xs text-muted-foreground">
                              <ImagePlus className="w-3.5 h-3.5" />
                              {editingTeamLogo ? "Ander bestand" : "Kies afbeelding..."}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const img = new Image();
                                  const url = URL.createObjectURL(file);
                                  img.onload = () => {
                                    const canvas = document.createElement("canvas");
                                    const max = 256;
                                    const scale = Math.min(max / img.width, max / img.height, 1);
                                    canvas.width = Math.round(img.width * scale);
                                    canvas.height = Math.round(img.height * scale);
                                    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
                                    setEditingTeamLogo(canvas.toDataURL("image/png"));
                                    URL.revokeObjectURL(url);
                                  };
                                  img.src = url;
                                }}
                              />
                            </label>
                            {(editingTeamLogo || editingTeamCurrentLogo) && (
                              <img
                                src={editingTeamLogo || editingTeamCurrentLogo}
                                alt="preview"
                                className="w-10 h-10 object-contain rounded-md border border-border bg-secondary/50"
                              />
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateTeamLogo.mutate({ teamId: team.id, logoUrl: editingTeamLogo })}
                              disabled={!editingTeamLogo || updateTeamLogo.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-gradient-racing text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                            >
                              <Save className="w-3 h-3" /> Opslaan
                            </button>
                            {editingTeamCurrentLogo && (
                              <button
                                onClick={() => { updateTeamLogo.mutate({ teamId: team.id, logoUrl: "" }); setEditingTeamCurrentLogo(""); }}
                                disabled={updateTeamLogo.isPending}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold border border-border text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <X className="w-3 h-3" /> Verwijderen
                              </button>
                            )}
                            <button onClick={() => { setEditingTeamId(null); setEditingTeamLogo(""); setEditingTeamCurrentLogo(""); }} className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">Annuleren</button>
                          </div>
                        </motion.div>
                      )}

                      {(team as any).team_memberships?.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                          {(team as any).team_memberships.map((m: any) => (
                            <div key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: team.color }} />
                              {m.profiles?.display_name || m.profiles?.iracing_name || "Unknown"}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {!teams?.length && <div className="col-span-2 text-center py-16 text-muted-foreground"><Car className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>Nog geen teams.</p></div>}
                </div>
              </div>
            )}

            {activeTab === "results" && (
              <div>
                <h2 className="font-heading text-2xl font-black mb-6">RESULTATEN IMPORTEREN</h2>

                {/* Mode toggle */}
                <div className="flex gap-2 mb-6">
                  <button onClick={() => setImportMode("csv")} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-colors ${importMode === "csv" ? "bg-gradient-racing text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                    <FileText className="w-4 h-4" /> CSV Upload
                  </button>
                  <button onClick={() => setImportMode("json")} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-colors ${importMode === "json" ? "bg-gradient-racing text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                    <BarChart2 className="w-4 h-4" /> JSON Export
                  </button>
                  <button onClick={() => setImportMode("manual")} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-colors ${importMode === "manual" ? "bg-gradient-racing text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                    <Upload className="w-4 h-4" /> Handmatig
                  </button>
                </div>

                <div className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
                  {/* Race selector — always shown */}
                  <div className="mb-6">
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Selecteer Race *</label>
                    <select value={importRaceId} onChange={(e) => setImportRaceId(e.target.value)} className="w-full md:w-96 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Kies een race...</option>
                      {allRaces?.map((race: any) => (
                        <option key={race.id} value={race.id}>{race.name} — {race.track} ({new Date(race.race_date).toLocaleDateString("nl-NL")})</option>
                      ))}
                    </select>
                  </div>

                  {/* ── CSV MODE ── */}
                  {importMode === "csv" && (
                    <div>
                      {/* Info box */}
                      <div className="mb-5 p-4 rounded-md bg-blue-500/10 border border-blue-500/20 text-sm text-blue-300">
                        <div className="font-bold mb-1">📄 iRacing CSV Export</div>
                        <p className="text-xs leading-relaxed mb-2">Download de race resultaten als CSV van <strong>members.iracing.com</strong> → Race Results → Export. De CSV wordt automatisch ingelezen en gekoppeld aan drivers op basis van iRacing naam of Customer ID.</p>
                        <p className="text-xs text-blue-400 font-bold">Verwacht formaat: FinPos, CustID, Display Name, Laps, Best Lap Time, Incidents (iRacing standaard export)</p>
                      </div>

                      {/* File upload */}
                      <div className="mb-5">
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">CSV Bestand</label>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">{csvFileName || "Kies CSV bestand..."}</span>
                            <input
                              type="file"
                              accept=".csv,.txt"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setCsvFileName(file.name);
                                const reader = new FileReader();
                                reader.onload = (ev) => {
                                  const text = ev.target?.result as string;
                                  if (!text) return;
                                  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
                                  if (lines.length < 2) { toast.error("CSV lijkt leeg"); return; }

                                  // Detect header row — skip metadata rows (iRacing CSV has 2 header rows)
                                  let headerLineIdx = 0;
                                  for (let li = 0; li < Math.min(lines.length, 5); li++) {
                                    if (lines[li].toLowerCase().includes("fin pos") || lines[li].toLowerCase().includes("finpos") || lines[li].toLowerCase().startsWith('"fin pos"')) { headerLineIdx = li; break; }
                                  }
                                  const header = lines[headerLineIdx].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
                                  const finPosIdx        = header.findIndex(h => h === "fin pos" || h === "finpos" || h === "pos" || h === "finish");
                                  const custIdIdx        = header.findIndex(h => h === "cust id" || h.includes("custid") || h.includes("customerid"));
                                  const nameIdx          = header.findIndex(h => h === "name" || h.includes("display name") || h.includes("driver"));
                                  const lapsIdx          = header.findIndex(h => h === "laps comp" || h === "laps" || h === "laps completed");
                                  const bestLapIdx       = header.findIndex(h => h === "fastest lap time" || h.includes("best lap") || h.includes("bestlap") || h.includes("fastest lap"));
                                  const incIdx           = header.findIndex(h => h === "inc" || h.includes("incident"));
                                  const newIRatingIdx    = header.findIndex(h => h === "new irating");
                                  const newLicLevelIdx   = header.findIndex(h => h === "new license level");
                                  const newLicSubIdx     = header.findIndex(h => h === "new license sub-level");

                                  const parsed = lines.slice(headerLineIdx + 1).map((line, i) => {
                                    const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
                                    if (cols.length < 3) return null;
                                    const pos      = finPosIdx >= 0  ? parseInt(cols[finPosIdx]) || i + 1 : i + 1;
                                    const name     = nameIdx >= 0    ? cols[nameIdx]   : `Driver ${i + 1}`;
                                    const laps     = lapsIdx >= 0    ? parseInt(cols[lapsIdx]) || 0 : 0;
                                    const bestLap  = bestLapIdx >= 0 ? cols[bestLapIdx] : "";
                                    const incidents= incIdx >= 0     ? parseInt(cols[incIdx]) || 0 : 0;
                                    const custId   = custIdIdx >= 0  ? cols[custIdIdx] : undefined;
                                    const newIR    = newIRatingIdx >= 0 && cols[newIRatingIdx]  ? parseInt(cols[newIRatingIdx])  : undefined;
                                    const newLL    = newLicLevelIdx >= 0 && cols[newLicLevelIdx] ? parseInt(cols[newLicLevelIdx]) : undefined;
                                    const newLS    = newLicSubIdx >= 0 && cols[newLicSubIdx] !== "" ? parseInt(cols[newLicSubIdx])  : undefined;
                                    return { position: pos, display_name: name, laps, best_lap: bestLap, incidents, fastest_lap: false, iracing_cust_id: custId, new_irating: newIR, new_license_level: newLL, new_license_sub_level: newLS };
                                  }).filter((r): r is NonNullable<typeof r> => !!r && !!r.display_name && !isNaN(r.position));

                                  // Auto-detect fastest lap: find driver with lowest parseable best_lap string
                                  const parseLapMs = (s: string) => {
                                    const m = s.match(/^(\d+):(\d+)[.,](\d+)$/);
                                    if (!m) return Infinity;
                                    return parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000 + parseInt(m[3].padEnd(3, "0").slice(0, 3));
                                  };
                                  const withLaps = parsed.filter(r => r.best_lap && parseLapMs(r.best_lap) < Infinity);
                                  if (withLaps.length) {
                                    const fastest = withLaps.reduce((a, b) => parseLapMs(a.best_lap) < parseLapMs(b.best_lap) ? a : b);
                                    fastest.fastest_lap = true;
                                  }

                                  if (parsed.length === 0) { toast.error("Geen geldige rijen gevonden in CSV"); return; }
                                  setImportRows(parsed);
                                  toast.success(`${parsed.length} drivers geladen uit CSV`);
                                };
                                reader.readAsText(file);
                              }}
                            />
                          </label>
                          {csvFileName && (
                            <button onClick={() => { setCsvFileName(null); setImportRows([{ position: 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }]); }} className="p-2 text-muted-foreground hover:text-destructive transition-colors">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Preview of parsed rows */}
                      {importRows.length > 0 && importRows[0].display_name && (
                        <div className="mb-5">
                          <div className="text-sm font-medium text-muted-foreground mb-2">{importRows.length} drivers geladen — preview:</div>
                          <div className="bg-secondary/30 rounded-md border border-border overflow-hidden">
                            <div className="grid grid-cols-[3rem_1fr_4rem_8rem_4rem_5rem] gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                              <span>Pos</span><span>Driver</span><span>Laps</span><span>Best Lap</span><span>Inc.</span><span className="text-center">FL</span>
                            </div>
                            {importRows.slice(0, 10).map((row, i) => {
                              const matched = profiles?.find((p: any) =>
                                (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
                                (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
                              );
                              return (
                                <div key={i} className={`grid grid-cols-[3rem_1fr_4rem_8rem_4rem_5rem] gap-2 px-3 py-2 items-center border-b border-border/30 text-sm ${matched ? "" : "opacity-60"}`}>
                                  <span className="font-heading font-bold">{row.position}</span>
                                  <div>
                                    <span>{row.display_name}</span>
                                    {matched ? <span className="ml-2 text-[10px] text-green-400 font-bold">✓ gevonden</span> : <span className="ml-2 text-[10px] text-red-400 font-bold">✗ niet gevonden</span>}
                                  </div>
                                  <span className="text-muted-foreground">{row.laps}</span>
                                  <span className="font-mono text-muted-foreground text-xs">{row.best_lap || "—"}</span>
                                  <span className="text-muted-foreground">{row.incidents}x</span>
                                  <div className="flex items-center justify-center">
                                    <input type="checkbox" checked={row.fastest_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], fastest_lap: e.target.checked }; setImportRows(u); }} className="w-4 h-4 accent-primary cursor-pointer" />
                                  </div>
                                </div>
                              );
                            })}
                            {importRows.length > 10 && <div className="px-3 py-2 text-xs text-muted-foreground">...en {importRows.length - 10} meer</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── JSON MODE ── */}
                  {importMode === "json" && (
                    <div>
                      {/* Info box */}
                      <div className="mb-5 p-4 rounded-md bg-purple-500/10 border border-purple-500/20 text-sm text-purple-300">
                        <div className="font-bold mb-1">📊 iRacing JSON Export</div>
                        <p className="text-xs leading-relaxed mb-2">Download de race resultaten als JSON van <strong>members.iracing.com</strong> → Race Results → Export to JSON. De JSON bevat ook iRating-data per driver en wordt automatisch ingelezen.</p>
                        <p className="text-xs text-purple-400 font-bold">iRating, licentieniveau en positie worden automatisch ingevuld vanuit de JSON.</p>
                      </div>

                      {/* File upload */}
                      <div className="mb-5">
                        <label className="text-sm font-medium text-muted-foreground mb-1.5 block">JSON Bestand</label>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors">
                            <BarChart2 className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">{jsonFileName || "Kies JSON bestand..."}</span>
                            <input
                              type="file"
                              accept=".json"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setJsonFileName(file.name);
                                const reader = new FileReader();
                                reader.onload = (ev) => {
                                  try {
                                    const json = JSON.parse(ev.target?.result as string);
                                    // iRacing JSON export has a "data" wrapper: { type, data: { session_results: [] } }
                                    const root = json.data ?? json;
                                    // simsession_type 6 = Race, or match by name, or fallback to session with most results
                                    const sessions: any[] = root.session_results || [];
                                    const raceSession = sessions.find((s: any) =>
                                      s.simsession_type === 6 ||
                                      (s.simsession_type_name || "").toLowerCase().includes("race") ||
                                      s.simsession_number === 0
                                    ) ?? sessions.sort((a: any, b: any) => (b.results?.length ?? 0) - (a.results?.length ?? 0))[0];
                                    if (!raceSession) {
                                      toast.error("Geen Race sessie gevonden in JSON — controleer of het een iRacing event result JSON is");
                                      return;
                                    }
                                    const results: any[] = raceSession.results || [];
                                    if (!results.length) {
                                      toast.error("Geen resultaten gevonden in Race sessie");
                                      return;
                                    }
                                    // Best lap: iRacing stores in ten-thousandths of a second, -1 = no lap
                                    const fmtLap = (us: number) => {
                                      if (!us || us < 0) return "";
                                      const totalMs = Math.round(us / 10);
                                      const mins = Math.floor(totalMs / 60000);
                                      const secs = Math.floor((totalMs % 60000) / 1000);
                                      const ms = totalMs % 1000;
                                      return `${mins}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
                                    };
                                    // Auto-detect fastest lap: lowest best_lap_time (excluding -1)
                                    const validLaps = results.filter((r: any) => r.best_lap_time > 0);
                                    const fastestCustId = validLaps.length
                                      ? validLaps.reduce((a: any, b: any) => a.best_lap_time < b.best_lap_time ? a : b).cust_id
                                      : null;
                                    const parsed = results
                                      .sort((a: any, b: any) => a.finish_position - b.finish_position)
                                      .map((r: any) => ({
                                        position: r.finish_position + 1,
                                        display_name: r.display_name || "",
                                        laps: r.laps_complete || 0,
                                        best_lap: fmtLap(r.best_lap_time),
                                        incidents: r.incidents || 0,
                                        fastest_lap: r.cust_id === fastestCustId,
                                        iracing_cust_id: String(r.cust_id),
                                        new_irating: r.newi_rating ?? undefined,
                                        new_license_level: r.new_license_level ?? undefined,
                                        new_license_sub_level: r.new_sub_level ?? undefined,
                                        car_name: r.car_name || r.livery?.car_name || undefined,
                                      }))
                                      .filter((r: any) => r.display_name);
                                    if (!parsed.length) {
                                      toast.error("Geen geldige drivers gevonden in JSON");
                                      return;
                                    }
                                    setImportRows(parsed);
                                    toast.success(`${parsed.length} drivers geladen uit JSON (inclusief iRating)`);
                                  } catch {
                                    toast.error("Ongeldig JSON bestand");
                                  }
                                };
                                reader.readAsText(file);
                              }}
                            />
                          </label>
                          {jsonFileName && (
                            <button onClick={() => { setJsonFileName(null); setImportRows([{ position: 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }]); }} className="p-2 text-muted-foreground hover:text-destructive transition-colors">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Preview of parsed rows */}
                      {importRows.length > 0 && importRows[0].display_name && (
                        <div className="mb-5">
                          <div className="text-sm font-medium text-muted-foreground mb-2">{importRows.length} drivers geladen — preview:</div>
                          <div className="bg-secondary/30 rounded-md border border-border overflow-hidden">
                            <div className="grid grid-cols-[3rem_1fr_4rem_8rem_4rem_6rem_5rem] gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                              <span>Pos</span><span>Driver</span><span>Laps</span><span>Best Lap</span><span>Inc.</span><span>iRating</span><span className="text-center">FL</span>
                            </div>
                            {importRows.slice(0, 10).map((row, i) => {
                              const matched = profiles?.find((p: any) =>
                                (p.iracing_cust_id && row.iracing_cust_id && String(p.iracing_cust_id) === String(row.iracing_cust_id)) ||
                                (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
                                (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
                              );
                              return (
                                <div key={i} className={`grid grid-cols-[3rem_1fr_4rem_8rem_4rem_6rem_5rem] gap-2 px-3 py-2 items-center border-b border-border/30 text-sm ${matched ? "" : "opacity-60"}`}>
                                  <span className="font-heading font-bold">{row.position}</span>
                                  <div>
                                    <span>{row.display_name}</span>
                                    {matched ? <span className="ml-2 text-[10px] text-green-400 font-bold">✓ gevonden</span> : <span className="ml-2 text-[10px] text-red-400 font-bold">✗ niet gevonden</span>}
                                  </div>
                                  <span className="text-muted-foreground">{row.laps}</span>
                                  <span className="font-mono text-muted-foreground text-xs">{row.best_lap || "—"}</span>
                                  <span className="text-muted-foreground">{row.incidents}x</span>
                                  <span className="text-purple-400 font-bold text-xs">{(row as any).new_irating ?? "—"}</span>
                                  <div className="flex items-center justify-center">
                                    <input type="checkbox" checked={row.fastest_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], fastest_lap: e.target.checked }; setImportRows(u); }} className="w-4 h-4 accent-primary cursor-pointer" />
                                  </div>
                                </div>
                              );
                            })}
                            {importRows.length > 10 && <div className="px-3 py-2 text-xs text-muted-foreground">...en {importRows.length - 10} meer</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── MANUAL MODE ── */}
                  {importMode === "manual" && (
                    <div>
                      <div className="overflow-x-auto mb-4">
                        <div className="min-w-[640px]">
                          <div className="grid grid-cols-[3rem_1fr_5rem_8rem_5rem_6rem_3rem] gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                            <span>Pos</span><span>Driver</span><span className="text-center">Laps</span><span className="text-center">Best Lap</span><span className="text-center">Inc.</span><span className="text-center">FL</span><span></span>
                          </div>
                          {importRows.map((row, i) => (
                            <div key={i} className="grid grid-cols-[3rem_1fr_5rem_8rem_5rem_6rem_3rem] gap-2 mb-2 items-center">
                              <div className="py-2 rounded-md bg-secondary border border-border text-center text-sm font-heading font-bold">{row.position}</div>
                              <input type="text" value={row.display_name} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], display_name: e.target.value }; setImportRows(u); }} placeholder="Driver naam" list="driver-names-import" className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              <input type="number" min={0} value={row.laps} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], laps: parseInt(e.target.value) || 0 }; setImportRows(u); }} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              <input type="text" value={row.best_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], best_lap: e.target.value }; setImportRows(u); }} placeholder="1:23.456" className="px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              <input type="number" min={0} value={row.incidents} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], incidents: parseInt(e.target.value) || 0 }; setImportRows(u); }} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              <div className="flex items-center justify-center"><input type="checkbox" checked={row.fastest_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], fastest_lap: e.target.checked }; setImportRows(u); }} className="w-4 h-4 accent-primary cursor-pointer" /></div>
                              <button onClick={() => setImportRows(importRows.filter((_, j) => j !== i))} className="flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          ))}
                          <datalist id="driver-names-import">
                            {profiles?.map((p: any) => <option key={p.user_id} value={p.display_name || p.iracing_name || ""} />)}
                          </datalist>
                        </div>
                      </div>
                      <button onClick={() => setImportRows([...importRows, { position: importRows.length + 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }])} className="flex items-center gap-1 px-3 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-4">
                        <Plus className="w-4 h-4" /> Driver toevoegen
                      </button>
                    </div>
                  )}

                  {/* Submit */}
                  <div className="border-t border-border pt-4">
                    <div className="text-xs text-muted-foreground mb-3 flex flex-wrap gap-2">
                      <span className="font-bold uppercase tracking-wider">Punten preview:</span>
                      {importRows.slice(0, 8).map((row) => (
                        <span key={row.position} className="px-2 py-0.5 rounded bg-secondary">P{row.position}: {(pointsConfig[row.position - 1] ?? 0) + (row.fastest_lap ? 1 : 0)} pts</span>
                      ))}
                    </div>
                    <button onClick={() => importResults.mutate()} disabled={!importRaceId || importResults.isPending} className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity">
                      <Upload className="w-4 h-4" />{importResults.isPending ? "Importeren..." : "Resultaten Importeren"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "drivers" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-heading text-2xl font-black">DRIVERS</h2>
                  <button
                    onClick={async () => {
                      setIratingSyncing(true);
                      setIratingSyncResult(null);
                      try {
                        const { data: { session } } = await supabase.auth.getSession();
                        const resp = await fetch(
                          "https://cwwfriypwdluynajubhz.supabase.co/functions/v1/sync-irating",
                          { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" } },
                        );
                        const result = await resp.json();
                        setIratingSyncResult(result);
                        if (result.updated !== undefined) {
                          toast.success(`iRating gesynchroniseerd — ${result.updated} drivers bijgewerkt`);
                          queryClient.invalidateQueries({ queryKey: ["all-profiles"] });
                        } else {
                          toast.error(result.error ?? "Sync mislukt");
                        }
                      } catch (e: any) {
                        toast.error(e.message);
                        setIratingSyncResult({ error: e.message });
                      } finally {
                        setIratingSyncing(false);
                      }
                    }}
                    disabled={iratingSyncing}
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {iratingSyncing ? (
                      <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Synchroniseren...</>
                    ) : (
                      <><BarChart2 className="w-4 h-4" />iRating Sync</>
                    )}
                  </button>
                </div>
                {iratingSyncResult && (
                  <div className={`mb-4 px-4 py-3 rounded-md text-sm font-medium border ${iratingSyncResult.error ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-accent/10 text-accent border-accent/30"}`}>
                    {iratingSyncResult.error ? `Fout: ${iratingSyncResult.error}` : `${iratingSyncResult.updated} driver${iratingSyncResult.updated !== 1 ? "s" : ""} bijgewerkt met iRating & safety rating van iRacing.`}
                  </div>
                )}
                <DriversList />
              </div>
            )}

            {activeTab === "points" && (
              <div>
                <h2 className="font-heading text-2xl font-black mb-6">PUNTEN SYSTEEM</h2>
                <div className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
                  <div className="mb-6">
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">League / Seizoen</label>
                    <select value={selectedLeagueForPoints} onChange={(e) => setSelectedLeagueForPoints(e.target.value)} className="w-full md:w-96 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                      <option value="">Kies een league...</option>
                      {leagues?.map((l: any) => <option key={l.id} value={l.id}>{l.name} {l.season && `(${l.season})`}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mb-6">
                    {leaguePoints.map((pts, i) => (
                      <div key={i} className="bg-secondary/50 rounded-md p-3 border border-border">
                        <div className="text-xs font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">P{i + 1}</div>
                        <input type="number" min={0} value={pts} onChange={(e) => { const u = [...leaguePoints]; u[i] = parseInt(e.target.value) || 0; setLeaguePoints(u); }} className="w-full px-2 py-1.5 rounded-md bg-secondary border border-border text-sm font-heading font-bold text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 flex-wrap mb-6">
                    <button onClick={() => savePointsConfig.mutate()} disabled={!selectedLeagueForPoints || savePointsConfig.isPending} className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity">
                      <Save className="w-4 h-4" />{savePointsConfig.isPending ? "Opslaan..." : "Opslaan"}
                    </button>
                    <button onClick={() => setLeaguePoints(DEFAULT_POINTS)} className="px-6 py-2.5 rounded-md border border-border text-muted-foreground font-heading font-bold text-sm hover:text-foreground transition-colors">Reset standaard</button>
                  </div>
                  <div className="p-4 bg-secondary/30 rounded-md border border-border">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Standaard F1-stijl systeem</div>
                    <div className="flex flex-wrap gap-2">
                      {DEFAULT_POINTS.map((p, i) => <span key={i} className="text-xs px-2 py-1 rounded bg-secondary">P{i + 1}: {p}</span>)}
                      <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">Fastest Lap: +1</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default AdminPage;
