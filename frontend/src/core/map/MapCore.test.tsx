import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MapCore } from './MapCore';
import { projectionStore } from '../projection/projectionStore';
import { DEFAULT_CENTER } from './basemap';

const loadCbs: Array<() => void> = [];
const fitBounds = vi.fn();
const mapOptions: Array<Record<string, unknown>> = [];

vi.mock('maplibre-gl', () => {
  class MapMock {
    constructor(options: Record<string, unknown>) {
      mapOptions.push(options);
    }
    on = vi.fn((event: string, cb: () => void) => {
      if (event === 'load') loadCbs.push(cb);
    });
    off = vi.fn();
    remove = vi.fn();
    resize = vi.fn();
    getCenter = vi.fn().mockReturnValue({ lng: 4.4, lat: 51.2 });
    getZoom = vi.fn().mockReturnValue(12);
    getCanvas = vi.fn().mockReturnValue({ style: {} });
    getSource = vi.fn().mockReturnValue({ setData: vi.fn() });
    getLayer = vi.fn().mockReturnValue(null);
    setPaintProperty = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    addImage = vi.fn();
    hasImage = vi.fn().mockReturnValue(false);
    fitBounds = fitBounds;
    dragPan = { enable: vi.fn(), disable: vi.fn() };
  }
  class LngLatBoundsMock {
    points: Array<[number, number]> = [];
    extend = vi.fn(function (this: LngLatBoundsMock, point: [number, number]) {
      this.points.push(point);
      return this;
    });
    contains = vi.fn().mockReturnValue(true);
  }
  class PopupMock {
    setLngLat = vi.fn().mockReturnThis();
    setHTML = vi.fn().mockReturnThis();
    addTo = vi.fn().mockReturnThis();
  }
  return { Map: MapMock, LngLatBounds: LngLatBoundsMock, Popup: PopupMock, setWorkerUrl: vi.fn() };
});

/** A snapshot for one board, laid out along a diagonal from the given corner. */
const snapshot = (boardId: string, waypointIds: string[], corner: number) => ({
  game_id: 'game-1',
  board: {
    id: boardId,
    name: boardId,
    waypoints: waypointIds.map((id, index) => ({
      id,
      name: id,
      lat: corner + index * 0.01,
      lon: corner + index * 0.01,
      arrival_radius_m: 25,
      is_start: index === 0,
      is_finish: index === waypointIds.length - 1
    })),
    roads: []
  }
});

/** The corners the last fitBounds call was asked to frame. */
const fittedPoints = () => {
  const lastCall = fitBounds.mock.calls.at(-1) as [{ points: Array<[number, number]> }];
  return lastCall[0].points;
};

/** The corners the map was constructed to open on. */
const openedPoints = () => {
  const opening = mapOptions.at(-1)?.bounds as { points: Array<[number, number]> } | undefined;
  return opening?.points;
};

beforeEach(() => {
  loadCbs.length = 0;
  mapOptions.length = 0;
  fitBounds.mockClear();
  projectionStore.reset();
});

describe('MapCore framing the board', () => {
  it('waits for the board instead of opening on a default city', async () => {
    render(<MapCore interactive />);

    expect(mapOptions).toHaveLength(0);
  });

  it('opens on the board as soon as it arrives', async () => {
    render(<MapCore interactive />);
    await act(async () => {
      projectionStore.applySnapshot(snapshot('board-1', ['a', 'b', 'c'], 52.3) as never);
    });

    expect(mapOptions).toHaveLength(1);
    expect(openedPoints()).toHaveLength(3);
    // The opening camera comes from the constructor, so nothing has to re-frame it.
    expect(fitBounds).not.toHaveBeenCalled();
    expect(loadCbs.length).toBeGreaterThan(0);
  });

  it('opens on the default view when no board turns up', async () => {
    vi.useFakeTimers();
    try {
      render(<MapCore interactive />);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

      expect(mapOptions).toHaveLength(1);
      expect(openedPoints()).toBeUndefined();
      expect(mapOptions[0].center).toEqual(DEFAULT_CENTER);
    } finally {
      vi.useRealTimers();
    }
  });

  it('frames a board that arrives after the map gave up waiting', async () => {
    vi.useFakeTimers();
    try {
      render(<MapCore interactive />);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      await act(async () => {
        projectionStore.applySnapshot(snapshot('board-1', ['a', 'b', 'c'], 52.3) as never);
      });

      expect(fitBounds).toHaveBeenCalledTimes(1);
      expect(fittedPoints()).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-frames when a different board replaces the one on screen', async () => {
    render(<MapCore interactive />);
    await act(async () => {
      projectionStore.applySnapshot(snapshot('board-1', ['a', 'b'], 40.0) as never);
    });
    await act(async () => { loadCbs.forEach((cb) => cb()); });
    await act(async () => {
      projectionStore.applySnapshot(snapshot('board-2', ['x', 'y', 'z'], 52.3) as never);
    });

    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(fittedPoints()).toHaveLength(3);
  });

  it('leaves the camera alone while the same board keeps ticking', async () => {
    render(<MapCore interactive />);
    await act(async () => {
      projectionStore.applySnapshot(snapshot('board-1', ['a', 'b'], 52.3) as never);
    });
    await act(async () => {
      projectionStore.applySnapshot(snapshot('board-1', ['a', 'b'], 52.3) as never);
    });

    expect(mapOptions).toHaveLength(1);
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('frames a single-waypoint board', async () => {
    render(<MapCore interactive />);
    await act(async () => {
      projectionStore.applySnapshot(snapshot('board-1', ['only'], 52.3) as never);
    });

    expect(openedPoints()).toHaveLength(1);
  });

  it('does not chase waypoints as an author places them', async () => {
    const draft = [{ id: 'w1', name: 'One', lat: 52.3, lon: 4.9, arrival_radius_m: 25, isStart: true, isFinish: false }];
    const { rerender } = render(<MapCore interactive editorMode draftWaypoints={draft} />);
    await act(async () => { loadCbs.forEach((cb) => cb()); });

    rerender(
      <MapCore
        interactive
        editorMode
        draftWaypoints={[...draft, { id: 'w2', name: 'Two', lat: 52.4, lon: 5.0, arrival_radius_m: 25, isStart: false, isFinish: true }]}
      />
    );

    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('frames a draft that arrives already drawn', async () => {
    const draft = [
      { id: 'w1', name: 'One', lat: 52.3, lon: 4.9, arrival_radius_m: 25, isStart: true, isFinish: false },
      { id: 'w2', name: 'Two', lat: 52.4, lon: 5.0, arrival_radius_m: 25, isStart: false, isFinish: true }
    ];
    render(<MapCore interactive editorMode draftWaypoints={draft} />);

    expect(fitBounds).toHaveBeenCalledTimes(1);
  });
});
