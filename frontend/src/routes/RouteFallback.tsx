import React from 'react';
import { BrandMark, Skeleton } from '@ds';

/** Loading screen shown while a lazy surface downloads. */
export const RouteFallback: React.FC = () => (
  <div className="route-fallback" role="status" aria-label="Loading">
    <BrandMark size="lg" />
    <div className="route-fallback__body">
      <Skeleton variant="block" height="var(--sp-8)" />
      <Skeleton variant="text" lines={3} />
    </div>
  </div>
);
