import React from 'react';
import { type RaceRoute } from '../useRaceRoute';

interface RouteStripProps {
  routes: RaceRoute[];
  selectedWaypointId: string | undefined;
  onChoose: (waypointId: string) => void;
}

/** Route selection strip displaying available paths from current location. */
export const RouteStrip: React.FC<RouteStripProps> = ({ routes, selectedWaypointId, onChoose }) => (
  <div className="routes">
    <span className="routes__label">Routes out ({routes.length})</span>
    <div className="routes__strip" role="group" aria-label="Choose where to head next">
      {routes.map((route) => {
        const wp = route.waypoint;
        const state = route.blocked ? 'blocked' : route.inRange ? 'ready' : 'far';
        return (
          <button
            key={route.road.id}
            type="button"
            className={`route-chip route-chip--${state}`}
            aria-pressed={selectedWaypointId === wp.id}
            onClick={() => onChoose(wp.id)}
          >
            <span className="route-chip__name">{wp.name}</span>
            {/* In range is the state that unlocks the button above, so
                it says so. It used to differ from "far" only by the
                colour of the dot, which is no signal at all outdoors. */}
            <span className="route-chip__meta">
              <span className="route-chip__dot" aria-hidden="true" />
              {route.blocked
                ? 'Roadblock'
                : route.distance === null
                  ? 'No GPS'
                  : route.inRange
                    ? 'In range'
                    : route.distance < 1000
                      ? `${Math.round(route.distance)} m`
                      : `${(route.distance / 1000).toFixed(1)} km`}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);
