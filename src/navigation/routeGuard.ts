export type RouteTarget = 'loading' | 'auth' | 'setup' | 'main';
export function routeTarget(opts: { loading: boolean; user: any; venueId: string | null }): RouteTarget {
  if (opts.loading) return 'loading';
  if (!opts.user) return 'auth';
  if (!opts.venueId) return 'setup';
  return 'main';
}
