/** A road out as the destination picker sees it: which waypoint it leads to and how far off that is. */
export interface RouteChoice {
  waypointId: string;
  /** Metres to that waypoint, or null while there is no GPS fix. */
  distance: number | null;
}

/** A rival route must be this fraction of the current distance, or less, before the pick switches to it. */
export const SWITCH_RATIO = 0.6;

/** A rival route must also be at least this many metres closer, so short hops never flip the pick. */
export const SWITCH_MIN_GAIN_M = 30;

/**
 * Picks the waypoint the player is heading for. An explicit choice always wins;
 * otherwise the previous pick is kept until another route is clearly nearer,
 * so GPS drift near a fork cannot flip the target back and forth.
 */
export function resolveDestinationId(
  routes: RouteChoice[],
  explicitId: string | null,
  previousId: string | null
): string | null {
  if (routes.length === 0) return null;

  const has = (id: string | null): id is string => !!id && routes.some((r) => r.waypointId === id);
  if (has(explicitId)) return explicitId;

  const measured = routes.filter((r): r is RouteChoice & { distance: number } => r.distance !== null);
  const nearest = measured.reduce<(RouteChoice & { distance: number }) | null>(
    (best, r) => (best === null || r.distance < best.distance ? r : best),
    null
  );

  if (has(previousId)) {
    const current = routes.find((r) => r.waypointId === previousId)!;
    if (!nearest || current.distance === null || nearest.waypointId === previousId) return previousId;
    const clearlyCloser =
      nearest.distance < current.distance * SWITCH_RATIO && current.distance - nearest.distance >= SWITCH_MIN_GAIN_M;
    return clearlyCloser ? nearest.waypointId : previousId;
  }

  return (nearest ?? routes[0]).waypointId;
}
