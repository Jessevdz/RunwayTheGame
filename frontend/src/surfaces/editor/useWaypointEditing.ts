import { useCallback, useState } from 'react';
import { generateUUID } from '../../core/util/uuid';
import type { RoadDraft, WaypointDraft } from '../../core/editor/geometryUtils';
import { DEFAULT_ARRIVAL_RADIUS_M } from './boardDraft';
import type { PendingDeleteTarget } from './components/DeleteConfirmModal';
import type { PendingFinishRole } from './components/FinishRoleConfirmModal';
import type { BoardDraftApi } from './useBoardDraft';

export interface ConnectedRoad {
  roadId: string;
  targetName: string;
}

export interface WaypointEditing {
  selectedWaypointId: string | null;
  selectedWaypoint: WaypointDraft | null;
  /** Roads leaving the selected waypoint, named by where they lead. */
  connectedRoads: ConnectedRoad[];
  /** Waypoints the map should fly to, cleared again once the map has read them. */
  focusWaypointIds: string[] | null;
  focusWaypoints: (waypointIds: string[]) => void;
  selectWaypoint: (waypointId: string | null) => void;
  addWaypoint: (lat: number, lon: number) => void;
  addRoad: (waypointIdA: string, waypointIdB: string) => void;
  moveWaypoint: (waypointId: string, lat: number, lon: number) => void;
  setStart: (waypointId: string) => void;
  updateField: (field: keyof WaypointDraft, value: string | number | boolean) => void;
  requestDeleteWaypoint: (waypointId: string) => void;
  requestDeleteRoad: (roadId: string) => void;
  deleteSelectedWaypoint: () => void;
  requestSetFinish: (waypointId: string) => void;
  pendingDelete: PendingDeleteTarget | null;
  confirmDelete: () => void;
  cancelDelete: () => void;
  pendingFinishRole: PendingFinishRole | null;
  confirmFinishRole: () => void;
  cancelFinishRole: () => void;
}

/** Duration in milliseconds to hold waypoint focus animation. */
const FOCUS_HOLD_MS = 100;

/** Hook managing waypoint and road editing operations and confirmation states. */
export function useWaypointEditing(board: BoardDraftApi, isEditable: boolean): WaypointEditing {
  const { draft, setWaypoints, setRoads, setChallenges } = board;
  const { waypoints, roads, challenges } = draft;

  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [focusWaypointIds, setFocusWaypointIds] = useState<string[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteTarget | null>(null);
  // Set only when handing the finish role to a waypoint that already carries a
  // challenge; the finish has none, so the move discards it and is worth asking about.
  const [pendingFinishRole, setPendingFinishRole] = useState<PendingFinishRole | null>(null);

  const selectedWaypoint = waypoints.find((w) => w.id === selectedWaypointId) || null;

  const connectedRoads: ConnectedRoad[] = selectedWaypoint
    ? roads
        .filter((s) => s.waypoint_id_a === selectedWaypoint.id || s.waypoint_id_b === selectedWaypoint.id)
        .map((s) => {
          const otherWpId =
            s.waypoint_id_a === selectedWaypoint.id ? s.waypoint_id_b : s.waypoint_id_a;
          const otherWp = waypoints.find((w) => w.id === otherWpId);
          return { roadId: s.id, targetName: otherWp ? otherWp.name : 'Unknown waypoint' };
        })
    : [];

  const focusWaypoints = useCallback((waypointIds: string[]) => {
    setFocusWaypointIds(waypointIds);
    setTimeout(() => setFocusWaypointIds(null), FOCUS_HOLD_MS);
  }, []);

  const addWaypoint = useCallback(
    (lat: number, lon: number) => {
      if (!isEditable) return;
      const id = generateUUID();
      setWaypoints((prev) => [
        ...prev,
        {
          id,
          name: `Waypoint ${prev.length + 1}`,
          lat,
          lon,
          arrival_radius_m: DEFAULT_ARRIVAL_RADIUS_M,
          isStart: prev.length === 0,
          isFinish: false
        }
      ]);
      setSelectedWaypointId(id);
    },
    [isEditable, setWaypoints]
  );

  const addRoad = useCallback(
    (waypointIdA: string, waypointIdB: string) => {
      if (!isEditable) return;
      setRoads((prev) => {
        const exists = prev.some(
          (s) =>
            (s.waypoint_id_a === waypointIdA && s.waypoint_id_b === waypointIdB) ||
            (s.waypoint_id_a === waypointIdB && s.waypoint_id_b === waypointIdA)
        );
        if (exists) return prev;
        const road: RoadDraft = {
          id: generateUUID(),
          waypoint_id_a: waypointIdA,
          waypoint_id_b: waypointIdB
        };
        return [...prev, road];
      });
    },
    [isEditable, setRoads]
  );

  const moveWaypoint = useCallback(
    (waypointId: string, lat: number, lon: number) => {
      if (!isEditable) return;
      setWaypoints((prev) => prev.map((w) => (w.id === waypointId ? { ...w, lat, lon } : w)));
    },
    [isEditable, setWaypoints]
  );

  // Start and finish are exclusive roles: claiming one for a waypoint drops the
  // other, so no waypoint can ever be both ends of the route.
  const setStart = useCallback(
    (waypointId: string) => {
      if (!isEditable) return;
      setWaypoints((prev) =>
        prev.map((w) => ({
          ...w,
          isStart: w.id === waypointId,
          isFinish: w.id === waypointId ? false : w.isFinish
        }))
      );
    },
    [isEditable, setWaypoints]
  );

  /** Assign finish role to waypoint, removing any assigned challenge. */
  const applySetFinish = useCallback(
    (waypointId: string) => {
      setWaypoints((prev) =>
        prev.map((w) => ({
          ...w,
          isFinish: w.id === waypointId,
          isStart: w.id === waypointId ? false : w.isStart
        }))
      );
      setChallenges((prev) => {
        if (!prev[waypointId]) return prev;
        const next = { ...prev };
        delete next[waypointId];
        return next;
      });
    },
    [setWaypoints, setChallenges]
  );

  const requestSetFinish = useCallback(
    (waypointId: string) => {
      if (!isEditable) return;
      const existing = challenges[waypointId];
      const hasChallenge =
        !!existing &&
        (existing.prompt.trim() !== '' ||
          existing.rubric.must_show.length > 0 ||
          existing.rubric.fails_if.length > 0 ||
          existing.rubric.acceptable_ambiguity.trim() !== '');
      if (!hasChallenge) {
        applySetFinish(waypointId);
        return;
      }
      const wp = waypoints.find((w) => w.id === waypointId);
      setPendingFinishRole({
        waypointId,
        name: wp?.name || 'Untitled waypoint',
        prompt: existing.prompt
      });
    },
    [isEditable, challenges, waypoints, applySetFinish]
  );

  const updateField = useCallback(
    (field: keyof WaypointDraft, value: string | number | boolean) => {
      if (!selectedWaypointId || !isEditable) return;
      // Claiming the finish goes through the same door as the map's finish tool:
      // the role costs the waypoint its challenge, and that is worth confirming.
      if (field === 'isFinish' && value === true) {
        requestSetFinish(selectedWaypointId);
        return;
      }
      setWaypoints((prev) =>
        prev.map((w) => {
          if (w.id !== selectedWaypointId) {
            // Only one waypoint may hold each role.
            if (field === 'isStart' && value === true) return { ...w, isStart: false };
            if (field === 'isFinish' && value === true) return { ...w, isFinish: false };
            return w;
          }
          // The two roles are mutually exclusive on a single waypoint — a
          // circular route uses a separate finish placed next to the start.
          if (field === 'isStart' && value === true) return { ...w, isStart: true, isFinish: false };
          if (field === 'isFinish' && value === true) return { ...w, isFinish: true, isStart: false };
          return { ...w, [field]: value };
        })
      );
    },
    [selectedWaypointId, isEditable, requestSetFinish, setWaypoints]
  );

  const requestDeleteWaypoint = useCallback(
    (waypointId: string) => {
      if (!isEditable) return;
      const wp = waypoints.find((w) => w.id === waypointId);
      if (!wp) return;
      setPendingDelete({
        type: 'waypoint',
        id: waypointId,
        name: wp.name || 'Untitled waypoint',
        connectedRoadCount: roads.filter(
          (s) => s.waypoint_id_a === waypointId || s.waypoint_id_b === waypointId
        ).length
      });
    },
    [isEditable, waypoints, roads]
  );

  const requestDeleteRoad = useCallback(
    (roadId: string) => {
      if (!isEditable) return;
      const road = roads.find((s) => s.id === roadId);
      if (!road) return;
      const wpA = waypoints.find((w) => w.id === road.waypoint_id_a);
      const wpB = waypoints.find((w) => w.id === road.waypoint_id_b);
      setPendingDelete({
        type: 'road',
        id: roadId,
        waypointAName: wpA ? wpA.name : 'Waypoint',
        waypointBName: wpB ? wpB.name : 'Waypoint'
      });
    },
    [isEditable, waypoints, roads]
  );

  const deleteSelectedWaypoint = useCallback(() => {
    if (!selectedWaypointId) return;
    requestDeleteWaypoint(selectedWaypointId);
  }, [selectedWaypointId, requestDeleteWaypoint]);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    if (pendingDelete.type === 'waypoint') {
      const waypointId = pendingDelete.id;
      setWaypoints((prev) => prev.filter((w) => w.id !== waypointId));
      setRoads((prev) =>
        prev.filter((s) => s.waypoint_id_a !== waypointId && s.waypoint_id_b !== waypointId)
      );
      setSelectedWaypointId((current) => (current === waypointId ? null : current));
    } else if (pendingDelete.type === 'road') {
      const roadId = pendingDelete.id;
      setRoads((prev) => prev.filter((s) => s.id !== roadId));
    }
    setPendingDelete(null);
  }, [pendingDelete, setWaypoints, setRoads]);

  const confirmFinishRole = useCallback(() => {
    if (!pendingFinishRole) return;
    applySetFinish(pendingFinishRole.waypointId);
    setPendingFinishRole(null);
  }, [pendingFinishRole, applySetFinish]);

  const cancelDelete = useCallback(() => setPendingDelete(null), []);
  const cancelFinishRole = useCallback(() => setPendingFinishRole(null), []);

  return {
    selectedWaypointId,
    selectedWaypoint,
    connectedRoads,
    focusWaypointIds,
    focusWaypoints,
    selectWaypoint: setSelectedWaypointId,
    addWaypoint,
    addRoad,
    moveWaypoint,
    setStart,
    updateField,
    requestDeleteWaypoint,
    requestDeleteRoad,
    deleteSelectedWaypoint,
    requestSetFinish,
    pendingDelete,
    confirmDelete,
    cancelDelete,
    pendingFinishRole,
    confirmFinishRole,
    cancelFinishRole
  };
}
