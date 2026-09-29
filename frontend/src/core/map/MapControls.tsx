import React from 'react';
import type { BasemapStyle } from './basemap';
import { Icon, type IconName } from '@ds';

interface MapControlsProps {
  editorMode: boolean;
  basemapStyle: BasemapStyle;
  onBasemapStyleChange: (style: BasemapStyle) => void;
  showLegend: boolean;
  onToggleLegend: () => void;
  showMapTheme: boolean;
  onToggleMapTheme: () => void;
  /** False while the board has no waypoints — there is nothing to fit to. */
  canFitBoard: boolean;
  isOffscreenOrZoomedOut: boolean;
  onFitToBoard: () => void;
  /** Present only while the player has a position to centre on. */
  onToggleFollow?: () => void;
  /** True while the camera is tracking the player. */
  following?: boolean;
}

const BASEMAP_CHOICES: ReadonlyArray<{
  style: BasemapStyle;
  label: string;
  title: string;
  icon: IconName;
}> = [
  { style: 'auto', label: 'Auto', title: 'Auto (Follows Theme)', icon: 'powerup' },
  { style: 'default', label: 'Light', title: 'Light Basemap', icon: 'basemap' },
  { style: 'satellite', label: 'Satellite', title: 'Satellite Imagery', icon: 'satellite' },
  { style: 'dark', label: 'Dark', title: 'Dark Night Mode', icon: 'moon' }
];

/** Floating map controls bar providing legend, theme picker, and fit-to-board toggles. */
export const MapControls: React.FC<MapControlsProps> = ({
  editorMode,
  basemapStyle,
  onBasemapStyleChange,
  showLegend,
  onToggleLegend,
  showMapTheme,
  onToggleMapTheme,
  canFitBoard,
  isOffscreenOrZoomedOut,
  onFitToBoard,
  onToggleFollow,
  following = false
}) => (
  <div className="map-floating-controls">
    {!editorMode && showLegend && (
      <div className="map-legend">
        <span className="map-legend__item">
          <span className="map-legend__rule map-legend__rule--open" />
          <span>Open Path</span>
        </span>
        <span className="map-legend__item">
          <span className="map-legend__rule map-legend__rule--closed" />
          <span className="map-legend__muted">Closed Path</span>
        </span>
        <span className="map-legend__item">
          <Icon name="barrier" />
          <span className="map-legend__rule map-legend__rule--roadblock" />
          <span>Roadblock</span>
        </span>
        <span className="map-legend__item">
          <span className="map-legend__rule map-legend__rule--cleared" />
          <span>Cleared Path</span>
        </span>
        <span className="map-legend__sep" />
        <span className="map-legend__item">
          <Icon name="target" />
          <span>Target</span>
        </span>
        <span className="map-legend__item">
          <Icon name="pin" />
          <span>Current</span>
        </span>
        <span className="map-legend__item map-legend__item--cleared">
          <Icon name="check" />
          <span>Cleared</span>
        </span>
        <span className="map-legend__item map-legend__muted">
          <Icon name="lock" />
          <span>Locked</span>
        </span>
      </div>
    )}

    {showMapTheme && (
      <div className="map-basemaps" role="group" aria-label="Basemap style">
        {BASEMAP_CHOICES.map(({ style, label, title, icon }) => (
          <button
            key={style}
            onClick={() => onBasemapStyleChange(style)}
            className={`btn btn--sm map-basemaps__btn ${basemapStyle === style ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={basemapStyle === style}
            title={title}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    )}

    <div className="map-floating-controls__row">
      {!editorMode && onToggleFollow && (
        <button
          onClick={onToggleFollow}
          className={`btn btn--sm map-chip ${following ? 'map-chip--on' : ''}`.trim()}
          title={following ? 'Stop following your position' : 'Centre the map on you and follow'}
          aria-label={following ? 'Stop following your position' : 'Centre the map on you and follow'}
          aria-pressed={following}
        >
          <Icon name="locate" />
          <span className="map-chip__label">{following ? 'Following' : 'Centre on me'}</span>
        </button>
      )}

      {!editorMode && (
        <button
          onClick={onToggleLegend}
          className={`btn btn--sm map-chip ${showLegend ? 'map-chip--on' : ''}`.trim()}
          title={showLegend ? 'Hide Map Legend' : 'Show Map Legend'}
          aria-label={showLegend ? 'Hide map legend' : 'Show map legend'}
          aria-expanded={showLegend}
        >
          <Icon name="legend" />
          <span className="map-chip__label">{showLegend ? 'Hide Legend' : 'Legend'}</span>
        </button>
      )}

      <button
        onClick={onToggleMapTheme}
        className={`btn btn--sm map-chip ${showMapTheme ? 'map-chip--on' : ''}`.trim()}
        title={showMapTheme ? 'Hide Map Theme' : 'Show Map Theme'}
        aria-label={showMapTheme ? 'Hide map theme options' : 'Show map theme options'}
        aria-expanded={showMapTheme}
      >
        <Icon name="palette" />
        <span className="map-chip__label">{showMapTheme ? 'Hide Theme' : 'Map Theme'}</span>
      </button>

      {canFitBoard && (
        <button
          onClick={onFitToBoard}
          className={`btn btn--sm map-chip ${isOffscreenOrZoomedOut ? 'btn--primary map-chip--highlight' : 'btn--secondary'}`.trim()}
          title="Fit map to board boundaries"
          aria-label="Fit map to board boundaries"
        >
          <Icon name="fit-bounds" />
          <span className="map-chip__label">Fit Board</span>
          {isOffscreenOrZoomedOut && <span className="map-chip__badge">Off-view</span>}
        </button>
      )}
    </div>
  </div>
);
