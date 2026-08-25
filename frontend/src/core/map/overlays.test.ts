import { describe, expect, it } from 'vitest';
import { buildRaceOverlays, buildEditorOverlays, buildPlayerOverlays } from './overlays';
import type { GameState, Road, Waypoint } from '../projection/projectionStore';
import { getMapPalette, type MapPalette } from './mapTheme';

const palette = new Proxy({}, { get: (_t, key) => `token:${String(key)}` }) as MapPalette;

const waypoint = (id: string, lat: number, lon: number, extra: Partial<Waypoint> = {}): Waypoint => ({
  id,
  name: id,
  lat,
  lon,
  arrival_radius_m: 25,
  isStart: false,
  isFinish: false,
  ...extra
});

const road = (id: string, waypointA: string, waypointB: string): Road => ({
  id,
  waypointA,
  waypointB,
  challengeId: '',
  lockState: 'open',
  completedBy: null,
  lengthM: 100
});

/** A start with two open waypoints hanging off it, the team standing on the start. */
const board = (): GameState =>
  ({
    gameId: 'game-1',
    waypoints: [
      waypoint('start', 51.0, 4.0, { isStart: true }),
      waypoint('near', 51.001, 4.0),
      waypoint('far', 51.05, 4.0),
      waypoint('finish', 51.06, 4.0, { isFinish: true })
    ],
    roads: [road('r1', 'start', 'near'), road('r2', 'start', 'far'), road('r3', 'far', 'finish')],
    teams: {},
    positions: {},
    effects: {},
    roadblocks: {},
    waypointStates: {},
    progress: { 'team-1': { currentWaypointId: 'start', clearedWaypoints: [], traversedRoads: [] } },
    submissions: {}
  }) as unknown as GameState;

/** The centre of the drawn ring, as [lon, lat] of the circle's first vertex ring. */
const ringCentres = (features: GeoJSON.Feature[]) =>
  features.map((f) => {
    const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
    const lons = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    return [
      (Math.min(...lons) + Math.max(...lons)) / 2,
      (Math.min(...lats) + Math.max(...lats)) / 2
    ];
  });

describe('race arrival-radius rings', () => {
  it('draws no ring before there is a GPS fix', () => {
    const overlays = buildRaceOverlays(board(), 'team-1', palette, null);
    expect(overlays.radii.features).toHaveLength(0);
  });

  it('draws exactly one ring, on the open waypoint the player is nearest', () => {
    const overlays = buildRaceOverlays(board(), 'team-1', palette, { lat: 51.0005, lon: 4.0, accuracy: 10 });

    expect(overlays.radii.features).toHaveLength(1);
    const [[lon, lat]] = ringCentres(overlays.radii.features);
    expect(lon).toBeCloseTo(4.0, 4);
    expect(lat).toBeCloseTo(51.001, 4);
  });

  it('follows the player to the next waypoint as they move', () => {
    const overlays = buildRaceOverlays(board(), 'team-1', palette, { lat: 51.049, lon: 4.0, accuracy: 10 });

    expect(overlays.radii.features).toHaveLength(1);
    const [[, lat]] = ringCentres(overlays.radii.features);
    expect(lat).toBeCloseTo(51.05, 4);
  });

  it('never rings the waypoint the team is standing on', () => {
    const overlays = buildRaceOverlays(board(), 'team-1', palette, { lat: 51.0, lon: 4.0, accuracy: 10 });

    expect(overlays.radii.features).toHaveLength(1);
    const [[, lat]] = ringCentres(overlays.radii.features);
    expect(lat).toBeCloseTo(51.001, 4);
  });

  it('drops the ring on a waypoint once it is cleared', () => {
    const state = board();
    state.progress['team-1'].clearedWaypoints = ['start', 'near'];
    const overlays = buildRaceOverlays(state, 'team-1', palette, { lat: 51.0005, lon: 4.0, accuracy: 10 });

    expect(overlays.radii.features).toHaveLength(1);
    const [[, lat]] = ringCentres(overlays.radii.features);
    expect(lat).toBeCloseTo(51.05, 4);
  });
});

describe('buildEditorOverlays', () => {
  it('builds editor overlays for waypoints and roads', () => {
    const realPalette = getMapPalette();
    const overlays = buildEditorOverlays({
      waypoints: [
        {
          id: 'wp-1',
          name: 'Start',
          lat: 51.2,
          lon: 4.4,
          arrival_radius_m: 25,
          isStart: true,
          isFinish: false,
          coinReward: null
        },
        {
          id: 'wp-2',
          name: 'Waypoint 2',
          lat: 51.3,
          lon: 4.5,
          arrival_radius_m: 25,
          isStart: false,
          isFinish: false,
          coinReward: 20
        },
        {
          id: 'wp-3',
          name: 'Finish',
          lat: 51.4,
          lon: 4.6,
          arrival_radius_m: 25,
          isStart: false,
          isFinish: true,
          coinReward: null
        }
      ],
      roads: [
        { id: 'r-1', waypoint_id_a: 'wp-1', waypoint_id_b: 'wp-2' },
        { id: 'r-2', waypoint_id_a: 'wp-2', waypoint_id_b: 'wp-3' }
      ],
      selectedWaypointId: 'wp-2',
      dragged: null,
      palette: realPalette
    });

    expect(overlays.waypoints.features).toHaveLength(3);

    // Start waypoint properties
    expect(overlays.waypoints.features[0].properties).toMatchObject({
      id: 'wp-1',
      isStart: true,
      symbol: '▶',
      textColor: realPalette.onAccent,
      textHaloColor: realPalette.waypointStart
    });

    // Selected waypoint with coin reward
    expect(overlays.waypoints.features[1].properties).toMatchObject({
      id: 'wp-2',
      isStart: false,
      isSelected: true,
      coinRewardLabel: '+20 COINS',
      textColor: realPalette.onAccent,
      textHaloColor: realPalette.waypoint
    });

    // Finish waypoint properties
    expect(overlays.waypoints.features[2].properties).toMatchObject({
      id: 'wp-3',
      isFinish: true,
      symbol: '🏁',
      textColor: realPalette.onAccent,
      textHaloColor: realPalette.waypointFinish
    });

    // Roads
    expect(overlays.roads.features).toHaveLength(2);
    expect(overlays.roads.features[0].properties).toMatchObject({
      id: 'r-1',
      waypoint_id_a: 'wp-1',
      waypoint_id_b: 'wp-2'
    });

    // Radii features (each waypoint has an arrival radius ring, start/finish and selected have emphasis: 1)
    expect(overlays.radii.features).toHaveLength(3);
    expect(overlays.radii.features[0].properties?.emphasis).toBe(1); // start
    expect(overlays.radii.features[1].properties?.emphasis).toBe(1); // selected
  });
});

describe('race team position markers', () => {
  const withPositions = (): GameState => {
    const state = board();
    state.positions = {
      'team-1': { lat: 51.0, lon: 4.0, accuracy: 10, reportedAt: '2026-01-01T00:00:00Z' },
      'team-2': { lat: 51.02, lon: 4.01, accuracy: 12, reportedAt: '2026-01-01T00:00:00Z' }
    };
    return state;
  };

  const teamIdsOf = (overlays: { teamPositions: GeoJSON.FeatureCollection }) =>
    overlays.teamPositions.features.map((f) => f.properties?.teamId).sort();

  it('leaves your own team out, so your live dot is the only marker on you', () => {
    const overlays = buildRaceOverlays(withPositions(), 'team-1', palette, null);
    expect(teamIdsOf(overlays)).toEqual(['team-2']);
  });

  it('still draws every rival team', () => {
    const overlays = buildRaceOverlays(withPositions(), 'team-3', palette, null);
    expect(teamIdsOf(overlays)).toEqual(['team-1', 'team-2']);
  });

  it('draws every team for a viewer who has no team of their own', () => {
    const overlays = buildRaceOverlays(withPositions(), null, palette, null);
    expect(teamIdsOf(overlays)).toEqual(['team-1', 'team-2']);
  });
});

describe('buildPlayerOverlays', () => {
  it('returns empty collections when playerLocation is null', () => {
    const overlays = buildPlayerOverlays(null);
    expect(overlays.location.features).toHaveLength(0);
    expect(overlays.accuracy.features).toHaveLength(0);
  });

  it('builds point and accuracy circle features when playerLocation is provided', () => {
    const overlays = buildPlayerOverlays({ lat: 51.2, lon: 4.4, accuracy: 15 });
    expect(overlays.location.features).toHaveLength(1);
    expect(overlays.accuracy.features).toHaveLength(1);
    expect(overlays.location.features[0].geometry.type).toBe('Point');
    expect(overlays.accuracy.features[0].geometry.type).toBe('Polygon');
  });
});
