import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useSurfaceAnalytics } from '../core/analytics/useSurfaceAnalytics';
import { BugReporter } from '../surfaces/shared/BugReporter';

const LandingPage = React.lazy(() =>
  import('../surfaces/landing/LandingPage').then((m) => ({ default: m.LandingPage }))
);
const GalleryPage = React.lazy(() =>
  import('../surfaces/gallery/GalleryPage').then((m) => ({ default: m.GalleryPage }))
);
const RoadmapPage = React.lazy(() =>
  import('../surfaces/roadmap/RoadmapPage').then((m) => ({ default: m.RoadmapPage }))
);
const DesignView = React.lazy(() =>
  import('../surfaces/editor/DesignView').then((m) => ({ default: m.DesignView }))
);
const PlayLauncher = React.lazy(() =>
  import('../surfaces/host/PlayLauncher').then((m) => ({ default: m.PlayLauncher }))
);
const SoloLauncher = React.lazy(() =>
  import('../surfaces/solo/SoloLauncher').then((m) => ({ default: m.SoloLauncher }))
);
const GameLobby = React.lazy(() =>
  import('../surfaces/host/GameLobby').then((m) => ({ default: m.GameLobby }))
);
const MyRacesPage = React.lazy(() =>
  import('../surfaces/races/MyRacesPage').then((m) => ({ default: m.MyRacesPage }))
);
const RaceShell = React.lazy(() =>
  import('../surfaces/race/RaceShell').then((m) => ({ default: m.RaceShell }))
);
const RaceReportPage = React.lazy(() =>
  import('../surfaces/report/RaceReportPage').then((m) => ({ default: m.RaceReportPage }))
);
const LegacyPlayRedirect = React.lazy(() =>
  import('../surfaces/race/LegacyPlayRedirect').then((m) => ({ default: m.LegacyPlayRedirect }))
);
const LegacyHostConsoleRedirect = React.lazy(() =>
  import('../surfaces/race/LegacyHostConsoleRedirect').then((m) => ({
    default: m.LegacyHostConsoleRedirect
  }))
);
const AdminPage = React.lazy(() =>
  import('../surfaces/admin/AdminPage').then((m) => ({ default: m.AdminPage }))
);
const Gallery = React.lazy(() =>
  import('../design-system/__gallery__/Gallery').then((m) => ({ default: m.Gallery }))
);
const NotFoundPage = React.lazy(() =>
  import('../surfaces/shared/NotFoundPage').then((m) => ({ default: m.NotFoundPage }))
);

export const AppRoutes: React.FC = () => {
  useSurfaceAnalytics();

  return (
    <>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/roadmap" element={<RoadmapPage />} />
          <Route path="/roadmap/admin/:adminKey" element={<AdminPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/:adminKey" element={<AdminPage />} />
          <Route path="/design" element={<DesignView />} />
          <Route path="/design/:mapId" element={<DesignView />} />
          <Route path="/races" element={<MyRacesPage />} />
          <Route path="/host" element={<PlayLauncher />} />
          <Route path="/host/:gameId" element={<GameLobby />} />
          <Route path="/join/:gameId" element={<GameLobby />} />
          <Route path="/solo" element={<SoloLauncher />} />
          <Route path="/race/:gameId" element={<RaceShell />} />
          <Route path="/race/:gameId/report" element={<RaceReportPage />} />
          <Route path="/host/:gameId/live" element={<LegacyHostConsoleRedirect />} />
          <Route path="/play" element={<LegacyPlayRedirect />} />
          {import.meta.env.DEV && (
            <Route
              path="/design-system"
              element={
                <div className="app-shell">
                  <div className="page-shell page-shell--doc">
                    <Gallery />
                  </div>
                </div>
              }
            />
          )}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      {/* Outside <Suspense> so a lazy surface still loading has a way to report. */}
      <BugReporter />
    </>
  );
};
