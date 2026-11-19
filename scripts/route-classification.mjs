const normalizeRoutePath = (path) => {
  const trimmed = String(path || '/').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '/';
};

const alwaysPrivateSeoRoutes = [
  '/auth',
  '/profile',
  '/admin',
  '/admin/track-intelligence',
  '/admin/track-intelligence-test',
  '/news-editor',
  '/stewards',
  '/koppel',
  '/simhub-koppelen',
  // Persoonlijke Pitwall en de opt-in deelview zijn account-/bearer-only.
  '/pitwall',
  '/pitwall/shared',
];

const privateRoutePrefixes = ['/admin', '/pitwall'];

export const createPrivateSeoRoutes = (communitySupportPublic = false) => [
  ...alwaysPrivateSeoRoutes,
  ...(!communitySupportPublic ? ['/support'] : []),
];

// Default reflects the current gated release state and keeps existing consumers backwards compatible.
export const privateSeoRoutes = createPrivateSeoRoutes(false);

export const isPrivateRoute = (path, { communitySupportPublic = false } = {}) => {
  const normalized = normalizeRoutePath(path);
  const routes = createPrivateSeoRoutes(communitySupportPublic);

  return routes.includes(normalized) || privateRoutePrefixes.some((prefix) => (
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  ));
};
