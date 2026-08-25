import type * as maplibregl from 'maplibre-gl';
import type { MapPalette } from './mapTheme';

/** Registers SVG map icons dynamically tuned to the active map palette. */
export function registerMapIcons(map: maplibregl.Map, mapPalette: MapPalette): void {
  const halo = mapPalette.labelHalo;
  const ink = mapPalette.labelInk;
  const accessible = mapPalette.waypointAccessible;
  const locked = mapPalette.waypointInaccessible;
  const finish = mapPalette.waypointFinish;
  const roadblock = mapPalette.roadRoadblock;
  const onAccent = mapPalette.onAccent;

  const icons: [string, number, string][] = [
    ['icon-lock', 24, `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="10" width="14" height="11" rx="2" fill="${finish}" stroke="${ink}" stroke-width="1.5"/><path d="M8 10V7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7V10" stroke="${locked}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="15.5" r="1.5" fill="${ink}"/></svg>`],
    ['icon-roadblock', 28, `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="24" height="16" rx="3" fill="${roadblock}" stroke="${onAccent}" stroke-width="2"/><path d="M5 19L11 9H14L8 19H5Z" fill="${onAccent}"/><path d="M14 19L20 9H23L17 19H14Z" fill="${onAccent}"/></svg>`],
    ['icon-target', 20, `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" fill="${halo}" stroke="${accessible}" stroke-width="1.5"/><circle cx="10" cy="10" r="5.5" fill="none" stroke="${accessible}" stroke-width="2"/><circle cx="10" cy="10" r="2" fill="${accessible}"/></svg>`]
  ];

  icons.forEach(([id, size, svg]) => {
    const img = new Image(size, size);
    img.onload = () => {
      if (map.hasImage(id)) {
        map.updateImage(id, img);
      } else {
        map.addImage(id, img, { sdf: false });
      }
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
