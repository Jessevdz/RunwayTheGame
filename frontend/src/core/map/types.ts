import type { WaypointDraft, RoadDraft } from '../editor/geometryUtils';

/** The shapes the map canvas is handed by the editor, shared by the modules
 *  that build overlays, wire interactions, and draw controls. */

/** A waypoint as the designer's map draws it: aliases WaypointDraft. */
export type DraftMapWaypoint = WaypointDraft;

/** A road as the designer's map draws it: aliases RoadDraft. */
export type DraftMapRoad = RoadDraft;

/** What the next click on the map does. The caller owns the vocabulary; the
 *  map only acts on what it is handed. */
export type EditorTool = 'waypoint' | 'road' | 'start' | 'finish' | 'select' | 'delete';

/** Where a waypoint is being dragged to right now, ahead of the move landing in
 *  the caller's model. Null while nothing is in hand. */
export type DraggedWaypointPos = { id: string; lat: number; lon: number } | null;

export interface PlayerLocation {
  lat: number;
  lon: number;
  accuracy: number;
}
