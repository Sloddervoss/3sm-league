/**
 * Tailwind 4 zet achter elke kleur met een opacity-modifier (`bg-card/36`) een
 * tweede declaratie in `@supports (color: color-mix(in lab, red, red))`, met
 * dezelfde kleur maar dan in oklab. Die fallback kost bij ons 20% van de CSS.
 *
 * De fallback die ervoor staat is zelf ook `color-mix(in srgb, ...)`, dus een
 * browser zonder color-mix-support kreeg die declaratie sowieso niet. De wrapper
 * weghalen is daarom render-neutraal: elke browser die het @supports-blok haalt,
 * krijgt exact dezelfde kleur als voorheen.
 *
 * Deze plugin pakt een blok ALLEEN uit als elke regel erin aantoonbaar dezelfde
 * selector heeft als de regel er direct voor. In elk ander geval blijft het blok
 * intact en verschijnt een waarschuwing, zodat een toekomstige Tailwind-versie
 * met een andere emit-vorm niet stil kleuren sloopt.
 */

const MARKER = /^\(color:\s*color-mix/i;

export function dropColorMixFallback() {
  return {
    name: 'drop-colormix-fallback',
    enforce: 'post',
    apply: 'build',

    async generateBundle(_options, bundle) {
      const postcss = (await import('postcss')).default;
      let totaalVerwijderd = 0;
      let totaalOvergeslagen = 0;

      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue;

        const bron = typeof file.source === 'string'
          ? file.source
          : new TextDecoder().decode(file.source);
        const root = postcss.parse(bron);
        let verwijderd = 0;
        let overgeslagen = 0;

        root.walkAtRules('supports', (atRule) => {
          if (!MARKER.test(atRule.params)) return;

          const regels = [];
          let alleenRegels = true;
          atRule.each((node) => {
            if (node.type === 'rule') regels.push(node);
            else if (node.type !== 'comment') alleenRegels = false;
          });

          if (regels.length === 0 || !alleenRegels) {
            overgeslagen += 1;
            return;
          }

          // Elke regel moet een voorganger met dezelfde selector hebben. Voor de
          // eerste regel is dat de regel vlak vóór het hele @supports-blok; bij
          // meerdere regels in één blok is dat de regel er direct voor.
          const voorafgaand = atRule.prev();
          const allesGedekt = regels.every((regel, index) => {
            let vorige = index === 0 ? voorafgaand : regel.prev();
            while (vorige && vorige.type === 'comment') vorige = vorige.prev();
            if (!vorige || vorige.type !== 'rule' || vorige.selector !== regel.selector) {
              return false;
            }
            // De voorganger moet dezelfde eigenschappen kennen; anders is het geen
            // fallback van deze regel maar een losse regel met toevallig dezelfde
            // selector, en zou verwijderen een echte declaratie kosten.
            const props = new Set();
            vorige.walkDecls((decl) => props.add(decl.prop));
            let gedekt = true;
            regel.walkDecls((decl) => { if (!props.has(decl.prop)) gedekt = false; });
            return gedekt;
          });

          if (!allesGedekt) {
            overgeslagen += 1;
            return;
          }

          // De oklab-regels blijven staan; de fallbackregel ervoor verdwijnt en de
          // @supports-wrapper gaat eraf. Dat is render-neutraal: de fallback was
          // zelf ook color-mix, dus wie het blok niet haalt, kreeg hem al niet.
          regels.forEach((regel, index) => {
            let vorige = index === 0 ? voorafgaand : regel.prev();
            // Dezelfde comment-sprong als bij de controle hierboven; anders
            // verdwijnt de comment en blijft de fallback staan.
            while (vorige && vorige.type === 'comment') vorige = vorige.prev();
            vorige.remove();
            verwijderd += 1;
          });
          atRule.replaceWith(...atRule.nodes);
        });

        if (verwijderd === 0 && overgeslagen === 0) continue;

        totaalVerwijderd += verwijderd;
        totaalOvergeslagen += overgeslagen;

        if (overgeslagen > 0) {
          this.warn(
            `${file.fileName}: ${overgeslagen} @supports-blok(ken) met color-mix niet uitgepakt `
            + 'omdat de duplicate-vorm afwijkt; die zijn ongewijzigd gelaten.',
          );
        }

        file.source = root.toString();
      }

      // Geen melding bij succes: alleen als er blokken zijn overgeslagen, want
      // dan wijkt de Tailwind-output af van wat de plugin verwacht.
    },
  };
}
