import React from 'react';
import type { BasemapStyle } from './basemap';
import {
  IconAuto,
  IconBasemap,
  IconFitBounds,
  IconLegend,
  IconLock,
  IconMoon,
  IconPalette,
  IconPin,
  IconRoadblockSign,
  IconSatellite,
  IconTarget,
  IconTick
} from './MapIcons';

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
}

const BASEMAP_CHOICES: ReadonlyArray<{
  style: BasemapStyle;
  label: string;
  title: string;
  Icon: React.FC;
}> = [
  { style: 'auto', label: 'Auto', title: 'Auto (Follows Theme)', Icon: IconAuto },
  { style: 'default', label: 'Light', title: 'Light Basemap', Icon: IconBasemap },
  { style: 'satellite', label: 'Satellite', title: 'Satellite Imagery', Icon: IconSatellite },
  { style: 'dark', label: 'Dark', title: 'Dark Night Mode', Icon: IconMoon }
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
  onFitToBoard
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
          <IconRoadblockSign />
          <span className="map-legend__rule map-legend__rule--roadblock" />
          <span>Roadblock</span>
        </span>
        <span className="map-legend__item">
          <span className="map-legend__rule map-legend__rule--cleared" />
          <span>Cleared Path</span>
        </span>
        <span className="map-legend__sep" />
        <span className="map-legend__item">
          <IconTarget />
          <span>Target</span>
        </span>
        <span className="map-legend__item">
          <IconPin />
          <span>Current</span>
        </span>
        <span className="map-legend__item map-legend__item--cleared">
          <IconTick />
          <span>Cleared</span>
        </span>
        <span className="map-legend__item map-legend__muted">
          <IconLock />
          <span>Locked</span>
        </span>
      </div>
    )}

    {showMapTheme && (
      <div className="map-basemaps" role="group" aria-label="Basemap style">
        {BASEMAP_CHOICES.map(({ style, label, title, Icon }) => (
          <button
            key={style}
            onClick={() => onBasemapStyleChange(style)}
            className={`btn btn--sm map-basemaps__btn ${basemapStyle === style ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={basemapStyle === style}
            title={title}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>
    )}

    <div className="map-floating-controls__row">
      {!editorMode && (
        <button
          onClick={onToggleLegend}
          className={`btn btn--sm map-chip ${showLegend ? 'map-chip--on' : ''}`.trim()}
          title={showLegend ? 'Hide Map Legend' : 'Show Map Legend'}
          aria-label={showLegend ? 'Hide map legend' : 'Show map legend'}
          aria-expanded={showLegend}
        >
          <IconLegend />
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
        <IconPalette />
        <span className="map-chip__label">{showMapTheme ? 'Hide Theme' : 'Map Theme'}</span>
      </button>

      {canFitBoard && (
        <button
          onClick={onFitToBoard}
          className={`btn btn--sm map-chip ${isOffscreenOrZoomedOut ? 'btn--primary map-chip--highlight' : 'btn--secondary'}`.trim()}
          title="Fit map to board boundaries"
          aria-label="Fit map to board boundaries"
        >
          <IconFitBounds />
          <span className="map-chip__label">Fit Board</span>
          {isOffscreenOrZoomedOut && <span className="map-chip__badge">Off-view</span>}
        </button>
      )}
    </div>
  </div>
);
