import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DesignView } from './DesignView';

vi.mock('maplibre-gl', () => {
  class MapMock {
    on = vi.fn((event: string, cb: any) => {
      if (event === 'load') setTimeout(cb, 0);
    });
    off = vi.fn();
    remove = vi.fn();
    resize = vi.fn();
    getCenter = vi.fn().mockReturnValue({ lng: 4.4, lat: 51.2 });
    getZoom = vi.fn().mockReturnValue(12);
    getCanvas = vi.fn().mockReturnValue({ style: {} });
    getSource = vi.fn().mockReturnValue({ setData: vi.fn() });
    getLayer = vi.fn().mockReturnValue(null);
    addSource = vi.fn();
    addLayer = vi.fn();
    addImage = vi.fn();
    hasImage = vi.fn().mockReturnValue(false);
    fitBounds = vi.fn();
    dragPan = { enable: vi.fn(), disable: vi.fn() };
  }
  class LngLatBoundsMock {
    extend = vi.fn();
    contains = vi.fn().mockReturnValue(true);
  }
  class PopupMock {
    setLngLat = vi.fn().mockReturnThis();
    setHTML = vi.fn().mockReturnThis();
    addTo = vi.fn().mockReturnThis();
  }
  return {
    Map: MapMock,
    LngLatBounds: LngLatBoundsMock,
    Popup: PopupMock,
    // MapCore points MapLibre at a bundler-emitted worker before it builds a map.
    setWorkerUrl: vi.fn(),
  };
});

beforeEach(() => localStorage.clear());

describe('DesignView placing waypoints', () => {
  it('updates state and dispatches waypoint addition', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/design']}>
        <DesignView />
      </MemoryRouter>
    );

    // Check if initial "Start placing waypoints" button exists
    const startPlacingBtn = screen.getByRole('button', { name: /start placing waypoints/i });
    expect(startPlacingBtn).toBeInTheDocument();

    await user.click(startPlacingBtn);

    // Waypoint tool is now active.
    // Simulate clicking on the map by dispatching the window event or testing event bridge
    act(() => {
      window.dispatchEvent(
        new CustomEvent('map-add-waypoint', {
          detail: { lat: 51.22, lon: 4.40 }
        })
      );
    });

    // Verify that waypoint 1 was added and inspector is shown
    expect(screen.getByText(/Waypoint 1/i)).toBeInTheDocument();
  });
});

describe('DesignView clearing the map', () => {
  it('empties the draft once the clear is confirmed', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/design']}>
        <DesignView />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /start placing waypoints/i }));
    act(() => {
      window.dispatchEvent(
        new CustomEvent('map-add-waypoint', { detail: { lat: 51.22, lon: 4.4 } })
      );
    });
    expect(screen.getByText(/Waypoint 1/i)).toBeInTheDocument();

    // Clear only offers itself once there is a design to throw away.
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.getByText(/start this design over from scratch/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear map/i }));

    expect(screen.queryByText(/Waypoint 1/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start placing waypoints/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^clear$/i })).not.toBeInTheDocument();
  });

  it('leaves the draft alone when the clear is cancelled', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/design']}>
        <DesignView />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /start placing waypoints/i }));
    act(() => {
      window.dispatchEvent(
        new CustomEvent('map-add-waypoint', { detail: { lat: 51.22, lon: 4.4 } })
      );
    });

    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getByText(/Waypoint 1/i)).toBeInTheDocument();
  });
});
