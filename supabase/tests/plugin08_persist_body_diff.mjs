#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Plugin 0.7.2.0 — bewijs dat de body van simhub_persist_v3 niets kwijt is
// ---------------------------------------------------------------------------
// De harde eis is "identiek aan nu" voor een aanroep met vijf of zes
// argumenten. Een volledige oude kopie in de testfixture zou 500 regels
// dupliceren en dan test je de kopie in plaats van de functie. Daarom deze
// structurele controle op de bronbestanden, in twee stappen:
//
//   A. 20261031140000 (de definitie die vandaag leeft) tegenover 20261031190200:
//      geen enkele oude regel mag verdwijnen of wijzigen, en de toevoegingen
//      moeten in hoogstens acht aaneengesloten blokken staan.
//
//   B. 20261031180300 (de 0.8-voorstelversie met de meetbatch) tegenover
//      20261031190200: er mogen precies twee regels vervangen zijn — de aanroep
//      van de meetbatch, die nu een jsonb-rapport teruggeeft in plaats van vier
//      tellers. Al het andere moet letterlijk gelijk zijn.
//
// Normalisatie: het derde retourargument (het meetrapport) wordt weggehaald
// voordat er vergeleken wordt. Dat is geen gedragswijziging: de eerste twee
// kolommen zijn identiek en de derde is null of een expliciete afwijzing.
//
// Wat dit niet bewijst: dat de nieuwe blokken zelf correct zijn. Dat doen de
// SQL-tests (plugin08_server_proposal.sql en plugin08_review_repairs.sql).
//
// Gebruik: node supabase/tests/plugin08_persist_body_diff.mjs
// Exitcode 0 = PASS, 1 = FAIL.
import { readFileSync } from "node:fs";

const BASIS = "supabase/migrations/20261031140000_endurance_connector_version.sql";
const VOORSTEL = "supabase/migrations/20261031180300_plugin08_persist_v3_aggregates.sql";
const NIEUW = "supabase/migrations/20261031190200_plugin08_measurement_ack.sql";

const bodyOf = (path) => {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("AS $function$");
  const end = text.indexOf("$function$;", start);
  if (start < 0 || end < 0) throw new Error(`geen functiebody gevonden in ${path}`);
  return text.slice(start + "AS $function$".length, end).split("\n");
};

// Alleen het derde retourargument wordt genormaliseerd, niets anders.
const normaliseer = (regel) =>
  regel
    .replace(/,\s*jsonb_build_object\('ok', false, 'error', 'frame_[a-z_]+'\);/, ";")
    .replace(/,\s*NULL::jsonb;/, ";")
    .replace(/,\s*v_agg_ack;/, ";")
    .replace(/\s+$/, "");

const lees = (pad) => bodyOf(pad).map((l) => normaliseer(l.replace(/\r$/, "")));

const diff = (oud, nieuw) => {
  const ontbreekt = [];
  const toegevoegd = [];
  let i = 0;
  for (const regel of oud) {
    if (i < nieuw.length && nieuw[i] === regel) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < nieuw.length && nieuw[j] !== regel) {
      toegevoegd.push({ index: j + 1, regel: nieuw[j] });
      j += 1;
    }
    if (j >= nieuw.length) {
      ontbreekt.push(regel);
      continue;
    }
    i = j + 1;
  }
  for (; i < nieuw.length; i += 1) toegevoegd.push({ index: i + 1, regel: nieuw[i] });

  const blokken = [];
  for (const { index, regel } of toegevoegd) {
    const laatste = blokken[blokken.length - 1];
    if (laatste && index === laatste.eind + 1) {
      laatste.eind = index;
      laatste.regels.push(regel);
    } else {
      blokken.push({ start: index, eind: index, regels: [regel] });
    }
  }
  return { ontbreekt, toegevoegd, blokken };
};

const resultaat = [];
const check = (ok, label) => resultaat.push({ ok, label });

// ---- A. tegenover de definitie die vandaag leeft -------------------------
const basis = lees(BASIS);
const nieuw = lees(NIEUW);
const a = diff(basis, nieuw);
check(a.ontbreekt.length === 0,
  `A: geen enkele regel uit de oude body is verdwenen of gewijzigd (${basis.length} regels)`);
check(a.blokken.length <= 8,
  `A: de toevoegingen staan in hoogstens acht blokken (gevonden: ${a.blokken.length})`);

// ---- B. tegenover de 0.8-voorstelversie ---------------------------------
const voorstel = lees(VOORSTEL);
const b = diff(voorstel, nieuw);
const VERVANGINGEN = new Set([
  "      SELECT * INTO v_agg_events, v_agg_laps, v_agg_rejected, v_agg_duplicates",
  "        FROM public.simhub_persist_measurement_batch(d.id, p_session_id, p_events, p_laps);",
]);
const onverwachtWeg = b.ontbreekt.filter((r) => !VERVANGINGEN.has(r));
const vervangen = b.ontbreekt.filter((r) => VERVANGINGEN.has(r));
check(onverwachtWeg.length === 0,
  "B: niets anders uit de voorstelversie is verdwenen of gewijzigd");
check(vervangen.length === VERVANGINGEN.size,
  `B: precies de twee regels van de meetbatchaanroep zijn vervangen (gevonden: ${vervangen.length})`);
check(nieuw.some((r) => r.includes("v_agg_ack := public.simhub_persist_measurement_batch(d.id, p_session_id, p_events, p_laps);")),
  "B: de meetbatch wordt aangeroepen en levert het rapport op");
check(b.blokken.length <= 8,
  `B: de toevoegingen staan in hoogstens acht blokken (gevonden: ${b.blokken.length})`);

// ---- C. de retourvorm ---------------------------------------------------
const rawNieuw = bodyOf(NIEUW).map((l) => l.replace(/\r$/, ""));
check(rawNieuw.some((r) => r.includes("RETURN QUERY SELECT 'accepted'::text, now_at, v_agg_ack;")),
  "C: de return van 'accepted' geeft het meetrapport als derde kolom");
check(!rawNieuw.some((r) => /RETURN QUERY SELECT '[a-z_]+'::text, (NULL::timestamptz|now_at);/.test(r)),
  "C: geen enkele vroege return heeft nog twee kolommen");
check(!a.toegevoegd.some(({ regel }) => /^\s*RETURN QUERY SELECT 'accepted'/.test(regel)),
  "C: de bestaande return van 'accepted' is niet verplaatst of gedupliceerd");

for (const r of resultaat) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}`);

console.log(`\nA: ${a.toegevoegd.length} toegevoegde regels in ${a.blokken.length} blok(ken)`);
for (const blk of a.blokken) {
  console.log(`  regels ${blk.start}-${blk.eind} (${blk.regels.length}): ${blk.regels.find((l) => l.trim())?.trim().slice(0, 70) ?? ""}`);
}
console.log(`B: ${b.toegevoegd.length} toegevoegde regels in ${b.blokken.length} blok(ken)`);
for (const blk of b.blokken) {
  console.log(`  regels ${blk.start}-${blk.eind} (${blk.regels.length}): ${blk.regels.find((l) => l.trim())?.trim().slice(0, 70) ?? ""}`);
}
if (onverwachtWeg.length) {
  console.log(`\nONVERWACHT WEG (${onverwachtWeg.length}):`);
  for (const r of onverwachtWeg.slice(0, 10)) console.log("  " + r);
}
process.exitCode = resultaat.every((r) => r.ok) ? 0 : 1;
