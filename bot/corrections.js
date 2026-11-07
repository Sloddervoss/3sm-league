// Publicatievolgorde voor correctieberichten.
//
// Aanleiding: beide correctiepaden (abandon en steward) verwijderden het
// oorspronkelijke bericht vóórdat de vervangende melding was geplaatst én
// vastgelegd. Mislukte de send of de bevestiging, dan was het origineel weg en
// werd ook het nieuwe bericht opgeruimd: geen van beide stond er nog.
//
// Deze functie legt de volgorde vast en is daarom los testbaar:
//   1. het vervangende bericht plaatsen;
//   2. de vlag bevestigd wegschrijven (nul geraakte rijen is géén succes);
//   3. pas dán het originele bericht verwijderen.
// Faalt stap 2, dan verdwijnt alleen het nieuwe bericht en blijft het origineel
// staan, zodat de volgende ronde het opnieuw kan proberen.

/**
 * @returns {Promise<'verstuurd'|'dubbel'|'send_mislukt'|'opslaan_mislukt'>}
 */
export async function publiceerCorrectie({ origineelMessageId, stuur, verwijder, markeer }) {
  if (typeof stuur !== 'function' || typeof verwijder !== 'function' || typeof markeer !== 'function') {
    throw new TypeError('publiceerCorrectie: stuur, verwijder en markeer zijn verplicht');
  }

  const bericht = await stuur();
  if (!bericht) return 'send_mislukt';

  const uitkomst = await markeer();
  if (uitkomst === 'dubbel') {
    // Een andere run was eerder. Ons bericht is dan een tweede exemplaar.
    await veiligVerwijderen(verwijder, bericht);
    return 'dubbel';
  }
  if (uitkomst !== 'opgeslagen') {
    await veiligVerwijderen(verwijder, bericht);
    return 'opslaan_mislukt';
  }

  if (origineelMessageId) {
    await veiligVerwijderen(verwijder, origineelMessageId);
  }
  return 'verstuurd';
}

async function veiligVerwijderen(verwijder, doel) {
  try {
    await verwijder(doel);
  } catch {
    // Opruimen is best effort: een mislukte delete mag de publicatie niet
    // ongedaan maken of de volgende ronde blokkeren.
  }
}

/**
 * Wat te doen met een geplaatst bericht waarvan de bevestiging mislukte?
 *
 * Een timeout na een schrijfactie betekent niet dat de schrijfactie niet
 * gebeurd is. Staat de vlag in de database wél op true, dan is het bericht
 * onderdeel van de publicatie en mag het niet worden opgeruimd — anders
 * verdwijnt een melding die de database als verstuurd beschouwt.
 *
 * `opgeslagenMessageId` is null voor tabellen die het bericht-id niet bewaren;
 * dan telt alleen de vlag.
 */
export function beslisRollback({ vlagGezet, opgeslagenMessageId = null, onsMessageId = null }) {
  if (!vlagGezet) return 'verwijderen';
  if (!opgeslagenMessageId || !onsMessageId) return 'behouden';
  return String(opgeslagenMessageId) === String(onsMessageId) ? 'behouden' : 'verwijderen';
}
