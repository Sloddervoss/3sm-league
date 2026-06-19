const normalizeRoutePath = (path) => {
  const trimmed = String(path || '/').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '/';
};

export const privateSeoRoutes = [
  '/auth',
  '/profile',
  '/admin',
  '/admin/track-intelligence',
  '/admin/track-intelligence-test',
  '/news-editor',
  '/stewards',
  '/koppel',
];

const privateRoutePrefixes = ['/admin'];

export const isPrivateRoute = (path) => {
  const normalized = normalizeRoutePath(path);

  return privateSeoRoutes.includes(normalized) || privateRoutePrefixes.some((prefix) => (
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  ));
};
