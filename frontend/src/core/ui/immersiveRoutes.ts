/** Lobby and race routes, where app navigation and site chrome would only be ways out of the game. */
const IMMERSIVE_ROUTE = /^\/(?:(?:host|join)\/[^/]+|race\/[^/]+)\/?$/;

/** Returns true when the path is a lobby or live race screen that should hide app navigation. */
export function isImmersiveRoute(pathname: string): boolean {
  return IMMERSIVE_ROUTE.test(pathname);
}
