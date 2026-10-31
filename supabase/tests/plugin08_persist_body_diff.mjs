#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Plugin 0.8 — bewijs dat de body van simhub_persist_v3 niets is kwijtgeraakt
// ---------------------------------------------------------------------------
// De harde eis is "identiek aan nu" voor een aanroep met vijf of zes
// argumenten. Een volledige oude kopie in de testfixture zou 500 regels
// dupliceren en dan test je de kopie in plaats van de functie. Daarom deze
// structurele controle op de bronbestanden:
//
//   Elke regel uit de body van 20261031140000 (de definitie die vandaag leeft)
//   moet in dezelfde volgorde terugkomen in de body van 20261031180300. Er mag
//   dus niets zijn verwijderd of gewijzigd; er mogen alleen regels BIJ zijn
//   gekomen, en die moeten in hoogstens vier aaneengesloten blokken staan.
//
// Wat dit niet bewijst: dat de nieuwe blokken zelf correct zijn. Dat doen de
// SQL-tests (supabase/tests/plugin08_server_proposal.sql).
//
// Gebruik: node supabase/tests/plugin08_persist_body_diff.mjs
// Exitcode 0 = PASS, 1 = FAIL.
import { readFileSync } from "node:fs";

const LEGACY = "supabase/migrations/20261031140000_endurance_connector_version.sql";
const NIEUW = "supabase/migrations/20261031180300_plugin08_persist_v3_aggregates.sql";

const bodyOf = (path) => {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("AS $function$");
  const end = text.indexOf("$function$;", start);
  if (start < 0 || end < 0) throw new Error(`geen functiebody gevonden in ${path}`);
  return text.slice(start + "AS $function$".length, end).split("\n");
};

const legacy = bodyOf(LEGACY).map((l) => l.replace(/\r$/, ""));
const nieuw = bodyOf(NIEUW).map((l) => l.replace(/\r$/, ""));

// Volgordecontrole: elke oude regel moet als volgende voorkomen.
const ontbreekt = [];
const toegevoegd = [];
let i = 0;
for (const regel of legacy) {
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

// Aaneengesloten blokken van toegevoegde regels.
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

const resultaat = [];
const check = (ok, label) => resultaat.push({ ok, label });

check(ontbreekt.length === 0, `geen enkele regel uit de oude body is verdwenen of gewijzigd (${legacy.length} regels)`);
check(blokken.length <= 4, `de toevoegingen staan in hoogstens vier blokken (gevonden: ${blokken.length})`);
check(!toegevoegd.some(({ regel }) => /^\s*RETURN QUERY SELECT 'accepted'/.test(regel)),
  "de bestaande return van 'accepted' is niet verplaatst of gedupliceerd");

for (const r of resultaat) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}`);

console.log(`\ntoegevoegd: ${toegevoegd.length} regels in ${blokken.length} blok(ken)`);
for (const b of blokken) {
  console.log(`  regels ${b.start}-${b.eind} (${b.regels.length}): ${b.regels.find((l) => l.trim())?.trim().slice(0, 70) ?? ""}`);
}
if (ontbreekt.length) {
  console.log(`\nONTBREEKT (${ontbreekt.length}):`);
  for (const r of ontbreekt.slice(0, 10)) console.log("  " + r);
}
process.exitCode = resultaat.every((r) => r.ok) ? 0 : 1;
