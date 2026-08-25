import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
// Configure MapLibre web worker URL before map initialization.
import './mapWorker';
import { projectionStore, type GameState } from '../projection/projectionStore';
import { useMapPalette } from './mapTheme';
import { useTheme } from '@ds';
import {
  applyBasemapVisibility,
  createBasemapStyleSpec,
  resolveBasemap,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  type BasemapStyle
} from './basemap';
import { registerMapIcons } from './iconRegistry';
import { setupMapLayers } from './layers';
import { buildEditorOverlays, buildPlayerOverlays, buildRaceOverlays, resolveActiveTeamId } from './overlays';
import { useWaypointDrag } from './useWaypointDrag';
import { useMapInteractions } from './useMapInteractions';
import { MapControls } from './MapControls';
import type { DraftMapWaypoint, DraftMapRoad, EditorTool, PlayerLocation } from './types';

export type { DraftMapWaypoint, DraftMapRoad } from './types';

/** Threshold zoom level below which the board is considered zoomed out. */
const OVERVIEW_ZOOM = 13.5;

/** Camera framing used whenever the whole board has to fit on screen. */
const BOARD_FIT = { padding: 60, maxZoom: 14 };

/** How long a race map waits for its board before opening on the default view. */
const BOARD_WAIT_MS = 2000;

/** Bounds around every waypoint, or null when there is no board to frame. */
const boundsAround = (waypoints: Array<{ lat: number; lon: number }>): maplibregl.LngLatBounds | null => {
  if (waypoints.length === 0) return null;
  const bounds = new maplibregl.LngLatBounds();
  waypoints.forEach((w) => bounds.extend([w.lon, w.lat]));
  return bounds;
};

interface MapCoreProps {
  interactive?: boolean;
  editorMode?: boolean;
  editorTool?: EditorTool | null;
  /** What the next click on the map will do, shown over the canvas. */
  editorHint?: string | null;
  draftWaypoints?: DraftMapWaypoint[];
  draftRoads?: DraftMapRoad[];
  selectedWaypointId?: string | null;
  activeTeamId?: string | null;
  onAddWaypoint?: (lat: number, lon: number) => void;
  onMoveWaypoint?: (waypointId: string, lat: number, lon: number) => void;
  onAddRoad?: (waypointIdA: string, waypointIdB: string) => void;
  onSetStart?: (waypointId: string) => void;
  onSetFinish?: (waypointId: string) => void;
  onSelectWaypoint?: (waypointId: string | null) => void;
  onDeleteWaypoint?: (waypointId: string) => void;
  onDeleteRoad?: (roadId: string) => void;
  focusWaypointIds?: string[] | null;
  playerLocation?: PlayerLocation | null;
  onMapClick?: (lat: number, lon: number) => void;
}

/** Renders the main MapLibre map canvas for editor authoring and live race visualization. */
export const MapCore: React.FC<MapCoreProps> = ({
  interactive = true,
  editorMode = false,
  editorTool = null,
  editorHint = null,
  draftWaypoints = [],
  draftRoads = [],
  selectedWaypointId = null,
  activeTeamId,
  onAddWaypoint,
  onMoveWaypoint,
  onAddRoad,
  onSetStart,
  onSetFinish,
  onSelectWaypoint,
  onDeleteWaypoint,
  onDeleteRoad,
  focusWaypointIds = null,
  playerLocation = null,
  onMapClick
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [basemapStyle, setBasemapStyle] = useState<BasemapStyle>('auto');
  const [showMapTheme, setShowMapTheme] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(false);
  const { theme } = useTheme();
  const mapPalette = useMapPalette();
  const effectiveBasemap = resolveBasemap(basemapStyle, theme);

  const [gameState, setGameState] = useState<GameState>(projectionStore.getState());
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isOffscreenOrZoomedOut, setIsOffscreenOrZoomedOut] = useState(false);

  /** Active waypoints for editor or live race mode. */
  const activeWaypoints = editorMode ? draftWaypoints : gameState.waypoints;

  // Subscribe to live game projection updates in non-editor mode.
  useEffect(() => {
    if (editorMode) return;
    return projectionStore.subscribe(setGameState);
  }, [editorMode]);

  // Keep active waypoints accessible in map event callbacks without stale closures.
  const activeWaypointsRef = useRef(activeWaypoints);
  activeWaypointsRef.current = activeWaypoints;

  const setupLayersRef = useRef<(map: maplibregl.Map) => void>(() => { });
  setupLayersRef.current = (map) => setupMapLayers(map, mapPalette, { editorMode });

  // Latch auto-framing once per board ID in race mode or draft session in editor mode.
  const boardKey = editorMode ? 'draft' : gameState.boardId || activeWaypoints.map((w) => w.id).sort().join(',');
  const fittedBoardKeyRef = useRef<string>('');

  const hasBoard = activeWaypoints.length > 0;

  // The projection blinks empty while a feed reconnects, so the camera opens on the last board seen.
  const lastBoardRef = useRef(activeWaypoints);
  const lastBoardKeyRef = useRef(boardKey);
  if (hasBoard) {
    lastBoardRef.current = activeWaypoints;
    lastBoardKeyRef.current = boardKey;
  }
  // A race map opens once its board arrives and stays open, so a reconnect that empties the projection cannot tear it down.
  const [canOpenMap, setCanOpenMap] = useState(editorMode);

  useEffect(() => {
    if (canOpenMap) return;
    if (editorMode || hasBoard) {
      setCanOpenMap(true);
      return;
    }
    const timer = setTimeout(() => setCanOpenMap(true), BOARD_WAIT_MS);
    return () => clearTimeout(timer);
  }, [editorMode, hasBoard, canOpenMap]);

  // Initialize MapLibre instance and event listeners.
  useEffect(() => {
    if (!canOpenMap) return;
    if (!mapContainerRef.current) return;

    // Opening on the board keeps the first painted frame from being a default city elsewhere.
    const opening = editorMode ? null : boundsAround(lastBoardRef.current);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: createBasemapStyleSpec(),
      ...(opening
        ? { bounds: opening, fitBoundsOptions: BOARD_FIT }
        : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }),
      interactive: interactive,
      dragRotate: false,
      pitchWithRotate: false
    });

    // A fresh instance starts unframed, whatever the previous one was showing.
    fittedBoardKeyRef.current = opening ? lastBoardKeyRef.current : '';

    mapRef.current = map;

    const checkViewportBounds = () => {
      const bounds = boundsAround(activeWaypointsRef.current);
      if (!bounds) {
        setIsOffscreenOrZoomedOut(false);
        return;
      }

      const center = map.getCenter();
      const isPannedAway = center ? !bounds.contains(center) : false;

      setIsOffscreenOrZoomedOut(map.getZoom() < OVERVIEW_ZOOM || isPannedAway);
    };

    map.on('load', () => {
      map.resize();
      setupLayersRef.current(map);
      setMapLoaded(true);
      checkViewportBounds();
    });

    map.on('move', checkViewportBounds);
    map.on('zoom', checkViewportBounds);

    const handleResize = () => {
      map.resize();
    };
    window.addEventListener('resize', handleResize);

    // Resize map when container dimensions change.
    const observer = new ResizeObserver(handleResize);
    observer.observe(mapContainerRef.current);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [interactive, editorMode, canOpenMap]);

  // Auto-frame camera bounds once per board or draft session.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (activeWaypoints.length === 0) {
      fittedBoardKeyRef.current = '';
      return;
    }

    if (fittedBoardKeyRef.current === boardKey) return;
    fittedBoardKeyRef.current = boardKey;

    // Avoid auto-framing on the first placed waypoint in editor mode.
    if (editorMode && activeWaypoints.length < 2) return;

    const bounds = boundsAround(activeWaypoints);
    if (!bounds) return;
    // Fit camera immediately without waiting for style load event.
    map.fitBounds(bounds, { ...BOARD_FIT, duration: 0 });
  }, [activeWaypoints, editorMode, boardKey]);

  // Update basemap layer visibility and label contrast.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    applyBasemapVisibility(map, effectiveBasemap);

    // Use a wider halo on the light basemap for label contrast.
    const haloWidth = effectiveBasemap === 'default' ? 2.5 : 1.5;

    if (map.getLayer('waypoints-labels-layer')) {
      map.setPaintProperty('waypoints-labels-layer', 'text-color', mapPalette.labelInk);
      map.setPaintProperty('waypoints-labels-layer', 'text-halo-color', mapPalette.labelHalo);
      map.setPaintProperty('waypoints-labels-layer', 'text-halo-width', haloWidth);
    }

    if (map.getLayer('waypoints-reward-layer')) {
      map.setPaintProperty('waypoints-reward-layer', 'text-color', mapPalette.coinReward);
      map.setPaintProperty('waypoints-reward-layer', 'text-halo-color', mapPalette.labelHalo);
      map.setPaintProperty('waypoints-reward-layer', 'text-halo-width', haloWidth);
    }

    registerMapIcons(map, mapPalette);
  }, [effectiveBasemap, mapLoaded, mapPalette]);

  // Fit map bounds to focused waypoint IDs.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !focusWaypointIds || focusWaypointIds.length === 0) return;

    const bounds = boundsAround(activeWaypoints.filter((w) => focusWaypointIds.includes(w.id)));
    if (!bounds) return;

    map.fitBounds(bounds, {
      padding: 100,
      maxZoom: 15,
      duration: 1000
    });
  }, [focusWaypointIds, mapLoaded, activeWaypoints]);

  const { draggedWaypointPos, justDraggedRef } = useWaypointDrag({
    mapRef,
    mapLoaded,
    editorMode,
    editorTool,
    onMoveWaypoint,
    onSelectWaypoint
  });

  const { cancelActiveMapAction } = useMapInteractions({
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
  });

  // Sync map GeoJSON dataset overlays.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const overlays = editorMode
      ? buildEditorOverlays({
        waypoints: draftWaypoints,
        roads: draftRoads,
        selectedWaypointId,
        dragged: draggedWaypointPos,
        palette: mapPalette
      })
      : buildRaceOverlays(gameState, resolveActiveTeamId(gameState, activeTeamId), mapPalette);

    (map.getSource('waypoints') as maplibregl.GeoJSONSource)?.setData(overlays.waypoints);
    (map.getSource('roads') as maplibregl.GeoJSONSource)?.setData(overlays.roads);
    (map.getSource('radii') as maplibregl.GeoJSONSource)?.setData(overlays.radii);
    (map.getSource('team-positions') as maplibregl.GeoJSONSource)?.setData(overlays.teamPositions);
    (map.getSource('road-midpoints') as maplibregl.GeoJSONSource)?.setData(overlays.roadMidpoints);
  }, [gameState, draftWaypoints, draftRoads, selectedWaypointId, activeTeamId, editorMode, mapLoaded, draggedWaypointPos, mapPalette]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const { location, accuracy } = buildPlayerOverlays(playerLocation);
    (map.getSource('player-location') as maplibregl.GeoJSONSource)?.setData(location);
    (map.getSource('player-accuracy') as maplibregl.GeoJSONSource)?.setData(accuracy);
  }, [playerLocation, mapLoaded]);

  const fitToBoard = () => {
    const map = mapRef.current;
    const bounds = boundsAround(activeWaypoints);
    if (!map || !bounds) return;

    map.fitBounds(bounds, { ...BOARD_FIT, duration: 800 });
  };

  return (
    <div
      className="map-container"
      // Apply active tool attribute for cursor styling.
      data-tool={editorMode && editorTool ? editorTool : undefined}
      onContextMenu={(e) => {
        if (editorMode) {
          e.preventDefault();
          cancelActiveMapAction();
          window.dispatchEvent(new CustomEvent('map-cancel-action'));
        }
      }}
    >
      <div ref={mapContainerRef} className="map-container__canvas" />

      {/* Active tool hint overlay for non-select editor tools. */}
      {editorMode && editorHint && editorTool && editorTool !== 'select' && (
        <p className="map-mode" role="status">
          {editorHint}
        </p>
      )}

      <MapControls
        editorMode={editorMode}
        basemapStyle={basemapStyle}
        onBasemapStyleChange={setBasemapStyle}
        showLegend={showLegend}
        onToggleLegend={() => setShowLegend((prev) => !prev)}
        showMapTheme={showMapTheme}
        onToggleMapTheme={() => setShowMapTheme((prev) => !prev)}
        canFitBoard={activeWaypoints.length > 0}
        isOffscreenOrZoomedOut={isOffscreenOrZoomedOut}
        onFitToBoard={fitToBoard}
      />
    </div>
  );
};

export default MapCore;
