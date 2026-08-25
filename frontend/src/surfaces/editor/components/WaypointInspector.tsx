import React from 'react';
import { Badge, IconButton } from '@ds';
import type { WaypointDraft } from '../../../core/editor/geometryUtils';
import { IconFinish, IconLocate, IconRoad, IconStart, IconTrash } from './EditorIcons';

export interface ConnectedRoadRef {
  roadId: string;
  targetName: string;
}

interface WaypointInspectorProps {
  waypoint: WaypointDraft;
  editable: boolean;
  connectedRoads?: ConnectedRoadRef[];
  onChange: (field: keyof WaypointDraft, value: string | number | boolean) => void;
  onLocate: () => void;
  onDelete: () => void;
  onDeleteRoad?: (roadId: string) => void;
}

/** Inspector panel displaying properties and controls for the selected waypoint. */
export const WaypointInspector: React.FC<WaypointInspectorProps> = ({
  waypoint,
  editable,
  connectedRoads = [],
  onChange,
  onLocate,
  onDelete,
  onDeleteRoad
}) => (
  <section className="inspector" aria-label="Waypoint properties">
    <header className="inspector__head">
      <h3 className="inspector__title">{waypoint.name || 'Untitled waypoint'}</h3>
      {waypoint.isStart && <Badge tone="moss">Start</Badge>}
      {waypoint.isFinish && <Badge tone="gold">Finish</Badge>}
      <IconButton icon={<IconLocate />} label="Centre map on this waypoint" variant="ghost" size="sm" onClick={onLocate} />
      {editable && (
        <IconButton icon={<IconTrash />} label="Delete waypoint" variant="ghost" size="sm" onClick={onDelete} />
      )}
    </header>

    <div className="inspector__body">
      <div className="inspector__coords">
        <span><b>Lat</b>{waypoint.lat.toFixed(5)}</span>
        <span><b>Lon</b>{waypoint.lon.toFixed(5)}</span>
      </div>

      {/* Hand-rolled rather than <Input>: the frozen Input contract has no
          `disabled`, and a read-only map must not offer an editable field. */}
      <div className="field">
        <label htmlFor="wp-name">Name</label>
        <input
          id="wp-name"
          type="text"
          disabled={!editable}
          value={waypoint.name}
          placeholder="Waypoint name"
          onChange={(e) => onChange('name', e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="wp-radius">Arrival radius</label>
        <div className="unit-input">
          <input
            id="wp-radius"
            className="unit-input__field"
            type="number"
            min={5}
            step={5}
            disabled={!editable}
            value={waypoint.arrival_radius_m}
            onChange={(e) => onChange('arrival_radius_m', parseInt(e.target.value, 10) || 0)}
          />
          <span className="unit-input__unit">m</span>
        </div>
        <span className="hint">How close a player must get before the waypoint counts as reached.</span>
      </div>

      {connectedRoads.length > 0 && (
        <div className="field">
          <label>Connected road sections ({connectedRoads.length})</label>
          <div className="connected-roads" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-h)', marginTop: 'var(--sp-1)' }}>
            {connectedRoads.map((item) => (
              <div
                key={item.roadId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'var(--sp-h) var(--sp-2)',
                  background: 'var(--surface-2)',
                  border: '0.0625rem solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                  fontSize: '0.85rem'
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-h)' }}>
                  <IconRoad />
                  <span>Road to <strong>{item.targetName}</strong></span>
                </span>
                {editable && onDeleteRoad && (
                  <IconButton
                    icon={<IconTrash />}
                    label={`Remove road to ${item.targetName}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteRoad(item.roadId)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {editable && (
        <>
          {/* Start and Finish are mutually exclusive — claiming one releases the
              other, so a single waypoint can never be both ends of the route. */}
          <div className="role-toggles">
            <button
              type="button"
              aria-pressed={waypoint.isStart}
              className="role-toggle role-toggle--start"
              onClick={() => onChange('isStart', !waypoint.isStart)}
            >
              <IconStart />
              Start
            </button>
            <button
              type="button"
              aria-pressed={waypoint.isFinish}
              className="role-toggle role-toggle--finish"
              onClick={() => onChange('isFinish', !waypoint.isFinish)}
            >
              <IconFinish />
              Finish
            </button>
          </div>
          <p className="role-toggles__hint">
            Start and finish must be different waypoints. For a circular route, place a separate
            finish waypoint next to the start.
          </p>
        </>
      )}
    </div>
  </section>
);
