/**
 * Tailwind 4 zet achter elke kleur met een opacity-modifier (`bg-card/36`) een
 * tweede declaratie in `@supports (color: color-mix(in lab, red, red))`, met
 * dezelfde kleur maar dan in oklab. Die fallback kost ~20% van de CSS.
 *
 * Deze plugin laat de oklab-declaratie staan (moderne browsers renderen exact
 * hetzelfde als voorheen) en verwijdert alleen de duplicate fallback-declaratie
 * plus de @supports-wrapper. Drawback: browsers zonder color-mix-support
 * (Chrome < 111, Safari < 16.2, Firefox < 113) verliezen de benaderde kleur.
 */
export function dropColorMixFallback() {
  return {
    name: 'drop-colormix-fallback',
    enforce: 'post',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const postcss = (await import('postcss')).default;
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue;
        let source = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
        const root = postcss.parse(source);
        let removed = 0;
        root.walkAtRules('supports', (atRule) => {
          if (!/^\(color:\s*color-mix/i.test(atRule.params)) return;
          atRule.walkRules((rule) => {
            const props = new Set();
            rule.walkDecls((decl) => props.add(decl.prop));
            let prev = atRule.prev();
            while (prev && prev.type === 'comment') prev = prev.prev();
            if (prev && prev.type === 'rule' && prev.selector === rule.selector) {
              prev.walkDecls((decl) => { if (props.has(decl.prop)) { decl.remove(); removed++; } });
              if (prev.nodes.length === 0) prev.remove();
            }
          });
          atRule.replaceWith(...atRule.nodes);
        });
        file.source = root.toString();
        if (removed === 0) {
          this.warn(`[drop-colormix-fallback] geen color-mix fallbacks gevonden in ${file.fileName} — output van Tailwind gewijzigd?`);
        }
      }
    },
  };
}
