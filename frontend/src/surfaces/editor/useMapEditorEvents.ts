import { useEffect, useRef } from 'react';

/** Window event payload definitions for map canvas events. */
interface MapEventDetail {
  'map-add-waypoint': { lat: number; lon: number };
  'map-move-waypoint': { waypointId: string; lat: number; lon: number };
  'map-add-road': { waypointIdA: string; waypointIdB: string };
  'map-set-start': { waypointId: string };
  'map-set-finish': { waypointId: string };
  'map-select-waypoint': { waypointId: string | null };
  'map-delete-road': { roadId: string };
  'map-delete-waypoint': { waypointId: string };
  'map-cancel-action': undefined;
}

export interface MapEditorHandlers {
  addWaypoint: (lat: number, lon: number) => void;
  moveWaypoint: (waypointId: string, lat: number, lon: number) => void;
  addRoad: (waypointIdA: string, waypointIdB: string) => void;
  setStart: (waypointId: string) => void;
  requestSetFinish: (waypointId: string) => void;
  selectWaypoint: (waypointId: string | null) => void;
  requestDeleteRoad: (roadId: string) => void;
  requestDeleteWaypoint: (waypointId: string) => void;
  cancelAction: () => void;
}

type Binding = {
  name: keyof MapEventDetail;
  run: (handlers: MapEditorHandlers, detail: unknown) => void;
};

const bind = <K extends keyof MapEventDetail>(
  name: K,
  run: (handlers: MapEditorHandlers, detail: MapEventDetail[K]) => void
): Binding => ({
  name,
  run: (handlers, detail) => run(handlers, detail as MapEventDetail[K])
});

const BINDINGS: Binding[] = [
  bind('map-add-waypoint', (h, d) => h.addWaypoint(d.lat, d.lon)),
  bind('map-move-waypoint', (h, d) => h.moveWaypoint(d.waypointId, d.lat, d.lon)),
  bind('map-add-road', (h, d) => h.addRoad(d.waypointIdA, d.waypointIdB)),
  bind('map-set-start', (h, d) => h.setStart(d.waypointId)),
  bind('map-set-finish', (h, d) => h.requestSetFinish(d.waypointId)),
  bind('map-select-waypoint', (h, d) => h.selectWaypoint(d.waypointId)),
  bind('map-delete-road', (h, d) => h.requestDeleteRoad(d.roadId)),
  bind('map-delete-waypoint', (h, d) => h.requestDeleteWaypoint(d.waypointId)),
  bind('map-cancel-action', (h) => h.cancelAction())
];

/** Hook routing map canvas events to editor handler callbacks. */
export function useMapEditorEvents(handlers: MapEditorHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const bound = BINDINGS.map(({ name, run }) => {
      const listener = (e: Event) => run(handlersRef.current, (e as CustomEvent).detail);
      window.addEventListener(name, listener);
      return { name, listener };
    });

    return () => {
      bound.forEach(({ name, listener }) => window.removeEventListener(name, listener));
    };
  }, []);
}
