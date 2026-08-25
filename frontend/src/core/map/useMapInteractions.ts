import { useCallback, useEffect, useState, type RefObject } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { ROAD_HIT_LAYERS } from './layers';
import type { DraftMapWaypoint, DraggedWaypointPos, EditorTool } from './types';

// Dispatches custom window event with detail payload.
function announce(name: string, detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function clearRoadPreview(map: maplibregl.Map): void {
  (map.getSource('road-preview') as maplibregl.GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: []
  });
}

export interface MapInteractionOptions {
  mapRef: RefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  editorMode: boolean;
  editorTool: EditorTool | null;
  draftWaypoints: DraftMapWaypoint[];
  draggedWaypointPos: DraggedWaypointPos;
  justDraggedRef: RefObject<boolean>;
  onAddWaypoint?: (lat: number, lon: number) => void;
  onAddRoad?: (waypointIdA: string, waypointIdB: string) => void;
  onSetStart?: (waypointId: string) => void;
  onSetFinish?: (waypointId: string) => void;
  onSelectWaypoint?: (waypointId: string | null) => void;
  onDeleteWaypoint?: (waypointId: string) => void;
  onDeleteRoad?: (roadId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
}

export interface MapInteractions {
  /** Cancels current map interaction action and clears road preview overlay. */
  cancelActiveMapAction: () => void;
}

/** Custom hook managing canvas click, hover, context menu events, and road drawing gestures. */
export function useMapInteractions(options: MapInteractionOptions): MapInteractions {
  const {
    mapRef,
    mapLoaded,
    editorMode,
    editorTool,
    draftWaypoints,
    draggedWaypointPos,
    justDraggedRef,
    onAddWaypoint,
    onAddRoad,
    onSetStart,
    onSetFinish,
    onSelectWaypoint,
    onDeleteWaypoint,
    onDeleteRoad,
    onMapClick
  } = options;

  const [roadStartWaypointId, setRoadStartWaypointId] = useState<string | null>(null);

  const cancelActiveMapAction = useCallback(() => {
    setRoadStartWaypointId(null);
    const map = mapRef.current;
    if (map && mapLoaded) {
      clearRoadPreview(map);
    }
  }, [mapRef, mapLoaded]);

  const handleDeleteClick = useCallback((map: maplibregl.Map, e: maplibregl.MapMouseEvent): void => {
    const wpFeatures = map.queryRenderedFeatures(e.point, { layers: ['waypoints-layer-outer'] });
    if (wpFeatures.length > 0) {
      const clickedWpId = wpFeatures[0].properties.id;
      onDeleteWaypoint?.(clickedWpId);
      announce('map-delete-waypoint', { waypointId: clickedWpId });
      return;
    }

    const roadFeatures = map.queryRenderedFeatures(e.point, { layers: ROAD_HIT_LAYERS });
    if (roadFeatures.length > 0) {
      const clickedRoadId = roadFeatures[0].properties.id;
      if (clickedRoadId) {
        onDeleteRoad?.(clickedRoadId);
        announce('map-delete-road', { roadId: clickedRoadId });
      }
    }
  }, [onDeleteWaypoint, onDeleteRoad]);

  /** Second click of a road draw closes it; the first only marks the end it
   *  started from. A road to itself is not a road, so it is dropped. */
  const handleRoadClick = useCallback((map: maplibregl.Map, clickedId: string): void => {
    if (!roadStartWaypointId) {
      setRoadStartWaypointId(clickedId);
      return;
    }

    if (roadStartWaypointId !== clickedId) {
      onAddRoad?.(roadStartWaypointId, clickedId);
      announce('map-add-road', { waypointIdA: roadStartWaypointId, waypointIdB: clickedId });
    }
    setRoadStartWaypointId(null);
    clearRoadPreview(map);
  }, [roadStartWaypointId, onAddRoad]);

  const handleWaypointHitClick = useCallback((map: maplibregl.Map, clickedId: string): void => {
    switch (editorTool) {
      case 'select':
        onSelectWaypoint?.(clickedId);
        announce('map-select-waypoint', { waypointId: clickedId });
        return;
      case 'start':
        onSetStart?.(clickedId);
        announce('map-set-start', { waypointId: clickedId });
        return;
      case 'finish':
        onSetFinish?.(clickedId);
        announce('map-set-finish', { waypointId: clickedId });
        return;
      case 'road':
        handleRoadClick(map, clickedId);
        return;
      default:
    }
  }, [editorTool, onSelectWaypoint, onSetStart, onSetFinish, handleRoadClick]);

  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }

    const map = mapRef.current;
    if (!map) return;

    if (!editorMode) {
      const { lat, lng } = e.lngLat;
      onMapClick?.(lat, lng);
      return;
    }

    if (editorTool === 'delete') {
      handleDeleteClick(map, e);
      return;
    }

    if (editorTool === 'waypoint') {
      const { lat, lng } = e.lngLat;
      onAddWaypoint?.(lat, lng);
      announce('map-add-waypoint', { lat, lon: lng });
      return;
    }

    const features = map.queryRenderedFeatures(e.point, { layers: ['waypoints-layer-outer'] });
    if (features.length > 0) {
      handleWaypointHitClick(map, features[0].properties.id);
      return;
    }

    // Bare map: Select clears the selection, and any half-drawn road is dropped.
    if (editorTool === 'select') {
      onSelectWaypoint?.(null);
      announce('map-select-waypoint', { waypointId: null });
    }
    setRoadStartWaypointId(null);
    clearRoadPreview(map);
  }, [
    mapRef,
    justDraggedRef,
    editorMode,
    editorTool,
    onAddWaypoint,
    onSelectWaypoint,
    onMapClick,
    handleDeleteClick,
    handleWaypointHitClick
  ]);

  /** The rubber-band line from the road's first end to the pointer. */
  const handleMouseMove = useCallback((e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !editorMode || editorTool !== 'road' || !roadStartWaypointId) return;

    const startWaypoint = draftWaypoints.find((w) => w.id === roadStartWaypointId);
    if (!startWaypoint) return;

    const startLat = draggedWaypointPos?.id === startWaypoint.id ? draggedWaypointPos.lat : startWaypoint.lat;
    const startLon = draggedWaypointPos?.id === startWaypoint.id ? draggedWaypointPos.lon : startWaypoint.lon;

    (map.getSource('road-preview') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [startLon, startLat],
              [e.lngLat.lng, e.lngLat.lat]
            ]
          },
          properties: {}
        }
      ]
    });
  }, [mapRef, mapLoaded, editorMode, editorTool, roadStartWaypointId, draftWaypoints, draggedWaypointPos]);

  const handleContextMenu = useCallback((e: maplibregl.MapMouseEvent) => {
    e.preventDefault();
    e.originalEvent?.preventDefault();

    if (editorMode) {
      cancelActiveMapAction();
      window.dispatchEvent(new CustomEvent('map-cancel-action'));
    }
  }, [editorMode, cancelActiveMapAction]);

  // Leaving the road tool drops whatever it had half-drawn.
  useEffect(() => {
    if (editorTool !== 'road') {
      cancelActiveMapAction();
    }
  }, [editorTool, cancelActiveMapAction]);

  // Escape and other surfaces cancel through the same window event.
  useEffect(() => {
    const handleCancelEvent = () => {
      cancelActiveMapAction();
    };
    window.addEventListener('map-cancel-action', handleCancelEvent);
    return () => {
      window.removeEventListener('map-cancel-action', handleCancelEvent);
    };
  }, [cancelActiveMapAction]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    map.off('click', handleMapClick);
    map.off('mousemove', handleMouseMove);
    map.off('contextmenu', handleContextMenu);

    map.on('click', handleMapClick);
    map.on('mousemove', handleMouseMove);
    map.on('contextmenu', handleContextMenu);

    return () => {
      map.off('click', handleMapClick);
      map.off('mousemove', handleMouseMove);
      map.off('contextmenu', handleContextMenu);
    };
  }, [mapRef, mapLoaded, handleMapClick, handleMouseMove, handleContextMenu]);

  return { cancelActiveMapAction };
}
