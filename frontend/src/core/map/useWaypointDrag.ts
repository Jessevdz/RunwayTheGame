import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { WAYPOINT_HIT_LAYERS } from './layers';
import type { DraggedWaypointPos, EditorTool } from './types';

export interface WaypointDragOptions {
  mapRef: RefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  editorMode: boolean;
  editorTool: EditorTool | null;
  onMoveWaypoint?: (waypointId: string, lat: number, lon: number) => void;
  onSelectWaypoint?: (waypointId: string | null) => void;
}

export interface WaypointDragState {
  /** Active position of waypoint being dragged. */
  draggedWaypointPos: DraggedWaypointPos;
  /** Ref set to true when a drag interaction completes to swallow click events. */
  justDraggedRef: RefObject<boolean>;
}

/** Custom hook managing waypoint drag-and-drop interactions in editor mode. */
export function useWaypointDrag({
  mapRef,
  mapLoaded,
  editorMode,
  editorTool,
  onMoveWaypoint,
  onSelectWaypoint
}: WaypointDragOptions): WaypointDragState {
  const isDraggingRef = useRef(false);
  const dragTargetIdRef = useRef<string | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasMovedRef = useRef(false);
  const justDraggedRef = useRef(false);
  const [draggedWaypointPos, setDraggedWaypointPos] = useState<DraggedWaypointPos>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !editorMode) return;

    const handleMouseDown = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      justDraggedRef.current = false;
      const features = map.queryRenderedFeatures(e.point, { layers: WAYPOINT_HIT_LAYERS });
      if (features.length > 0) {
        const wpId = features[0].properties?.id;
        if (wpId) {
          isDraggingRef.current = true;
          dragTargetIdRef.current = wpId;
          dragStartPointRef.current = { x: e.point.x, y: e.point.y };
          hasMovedRef.current = false;
          map.dragPan.disable();
          map.getCanvas().style.cursor = 'grabbing';
        }
      }
    };

    const handleMouseMoveDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!isDraggingRef.current || !dragTargetIdRef.current || !dragStartPointRef.current) return;

      const dx = e.point.x - dragStartPointRef.current.x;
      const dy = e.point.y - dragStartPointRef.current.y;
      if (Math.hypot(dx, dy) > 4) {
        hasMovedRef.current = true;
      }

      if (hasMovedRef.current) {
        const { lng, lat } = e.lngLat;
        setDraggedWaypointPos({ id: dragTargetIdRef.current, lat, lon: lng });
      }
    };

    const handleMouseUp = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!isDraggingRef.current) return;

      const wpId = dragTargetIdRef.current;
      const wasDragged = hasMovedRef.current;

      isDraggingRef.current = false;
      dragTargetIdRef.current = null;
      dragStartPointRef.current = null;

      map.dragPan.enable();
      map.getCanvas().style.cursor = '';

      setDraggedWaypointPos(null);

      if (wasDragged && wpId && e.lngLat) {
        justDraggedRef.current = true;
        const finalLat = e.lngLat.lat;
        const finalLon = e.lngLat.lng;

        onMoveWaypoint?.(wpId, finalLat, finalLon);
        window.dispatchEvent(
          new CustomEvent('map-move-waypoint', {
            detail: { waypointId: wpId, lat: finalLat, lon: finalLon }
          })
        );
        onSelectWaypoint?.(wpId);
        window.dispatchEvent(
          new CustomEvent('map-select-waypoint', {
            detail: { waypointId: wpId }
          })
        );
      }
    };

    // Sets map cursor style based on active tool when hovering over a waypoint.
    const handleMouseEnter = () => {
      if (isDraggingRef.current) return;
      map.getCanvas().style.cursor =
        editorTool === 'select' ? 'grab' : editorTool === 'waypoint' ? '' : 'pointer';
    };

    const handleMouseLeave = () => {
      if (!isDraggingRef.current) {
        map.getCanvas().style.cursor = '';
      }
    };

    const handleRoadMouseEnter = () => {
      if (!isDraggingRef.current && (editorTool === 'delete' || editorTool === 'select')) {
        map.getCanvas().style.cursor = 'pointer';
      }
    };

    const handleRoadMouseLeave = () => {
      if (!isDraggingRef.current) {
        map.getCanvas().style.cursor = '';
      }
    };

    map.on('mousedown', handleMouseDown);
    map.on('touchstart', handleMouseDown);
    map.on('mousemove', handleMouseMoveDrag);
    map.on('touchmove', handleMouseMoveDrag);
    map.on('mouseup', handleMouseUp);
    map.on('touchend', handleMouseUp);
    WAYPOINT_HIT_LAYERS.forEach((layer) => {
      map.on('mouseenter', layer, handleMouseEnter);
      map.on('mouseleave', layer, handleMouseLeave);
    });
    map.on('mouseenter', 'roads-hitbox-layer', handleRoadMouseEnter);
    map.on('mouseleave', 'roads-hitbox-layer', handleRoadMouseLeave);

    return () => {
      map.off('mousedown', handleMouseDown);
      map.off('touchstart', handleMouseDown);
      map.off('mousemove', handleMouseMoveDrag);
      map.off('touchmove', handleMouseMoveDrag);
      map.off('mouseup', handleMouseUp);
      map.off('touchend', handleMouseUp);
      WAYPOINT_HIT_LAYERS.forEach((layer) => {
        map.off('mouseenter', layer, handleMouseEnter);
        map.off('mouseleave', layer, handleMouseLeave);
      });
      map.off('mouseenter', 'roads-hitbox-layer', handleRoadMouseEnter);
      map.off('mouseleave', 'roads-hitbox-layer', handleRoadMouseLeave);
    };
  }, [mapRef, mapLoaded, editorMode, editorTool, onMoveWaypoint, onSelectWaypoint]);

  return { draggedWaypointPos, justDraggedRef };
}
