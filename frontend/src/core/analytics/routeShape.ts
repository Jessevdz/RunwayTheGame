/** Maps a request path onto the closed route vocabulary the server allowlists. */

/** The placeholder the server stores for a path this classifier does not know. */
export const OTHER_ROUTE = 'other';

type Rule = { test: RegExp; shape: string | ((method: string) => string) };

const byMethod =
  (map: Record<string, string>, fallback: string) =>
  (method: string): string =>
    map[method.toUpperCase()] ?? fallback;

// Ordered: the first match wins, so a nested path is listed before the bare
// resource it hangs off.
const RULES: Rule[] = [
  { test: /^\/api\/config\b/, shape: 'config' },
  { test: /^\/api\/roadmap\b/, shape: 'roadmap' },

  { test: /^\/api\/boards\/[^/]+\/leaderboard\b/, shape: 'leaderboard' },
  { test: /^\/api\/boards\/[^/]+\/publish\b/, shape: 'boards.publish' },
  { test: /^\/api\/boards\/[^/]+\/validate\b/, shape: 'boards.validate' },
  { test: /^\/api\/boards\/[^/]+\/visibility\b/, shape: 'boards.visibility' },
  { test: /^\/api\/boards\/[^/]+\/fork\b/, shape: 'boards.fork' },
  { test: /^\/api\/boards\/[^/]+\/decks\b/, shape: 'boards.decks' },
  { test: /^\/api\/boards\/[^/]+\/waypoints\/[^/]+\/challenges\b/, shape: 'boards.challenges' },
  {
    test: /^\/api\/boards\/[^/?]+/,
    shape: byMethod({ PUT: 'boards.update', DELETE: 'boards.delete' }, 'boards.get')
  },
  { test: /^\/api\/boards\/?(\?|$)/, shape: byMethod({ POST: 'boards.create' }, 'boards.list') },

  { test: /^\/api\/games\/solo\b/, shape: 'games.create' },
  { test: /^\/api\/games\/by-code\//, shape: 'games.get' },
  { test: /^\/api\/games\/[^/]+\/leaderboard\b/, shape: 'leaderboard' },
  { test: /^\/api\/games\/[^/]+\/(teams\/[^/]+\/)?join\b/, shape: 'games.join' },
  { test: /^\/api\/games\/[^/]+\/report\b/, shape: 'games.report' },
  { test: /^\/api\/games\/[^/]+\/submission\b/, shape: 'games.submission' },
  { test: /^\/api\/games\/[^/]+\/position\b/, shape: 'games.position' },
  { test: /^\/api\/games\/[^/]+\/(shop\/buy|powerup\/use)\b/, shape: 'games.powerup' },
  { test: /^\/api\/games\/?(\?|$)/, shape: 'games.create' },
  { test: /^\/api\/games\/[^/?]+/, shape: 'games.get' }
];

/** Returns the allowlisted route label for a path, or `other` when unclassified. */
export function routeShape(path: string, method: string = 'GET'): string {
  // A query string carries ids and filters; the shape is decided by the path alone.
  const bare = path.split('?')[0];
  for (const rule of RULES) {
    if (!rule.test.test(bare)) continue;
    return typeof rule.shape === 'function' ? rule.shape(method) : rule.shape;
  }
  return OTHER_ROUTE;
}
