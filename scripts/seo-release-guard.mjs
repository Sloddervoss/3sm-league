/** SEO refresh may change content, never switch the deployed application build. */
export function assertSameSiteBuild(builtHtml, liveHtml) {
  const entry = html => html.match(/<script\b[^>]*\bsrc=["']([^"']*\/assets\/index-[^"']+\.js)["']/)?.[1];
  const built = entry(builtHtml), live = entry(liveHtml);
  if (!built || !live || built !== live) throw new Error('SEO refresh geweigerd: deze checkout hoort niet bij de live sitebuild. Gebruik de actieve release.');
}
