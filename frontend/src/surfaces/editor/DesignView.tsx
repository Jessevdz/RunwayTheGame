import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, BrandLines } from '@ds';
import { IconBack } from './components/EditorIcons';
import { MapCore } from '../../core/map/MapCore';
import { EditorSurface } from './EditorSurface';
import { EDITOR_TOOLS } from './components/toolDefs';
import { useIsDesktop } from '../../core/ui/useIsDesktop';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';

// Mobile fallback notice rendered when map designer is opened on small viewports.
const DesignUnavailable: React.FC = () => {
  const navigate = useNavigate();

  return (
    <PageShell
      navPlacement="topbar"
      topBarProps={{
        title: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <BrandLines size={24} />
            <span className="t-announce fs-7" style={{ letterSpacing: '0.04em', color: 'var(--ink-strong)' }}>
              RUNWAY
            </span>
          </div>
        ),
      }}
    >
      <section style={{ maxWidth: '62.5rem', margin: '0 auto var(--sp-7)' }}>
        <h1 className="t-announce fs-d-md" style={{ color: 'var(--ink-strong)', marginBottom: 'var(--sp-5)' }}>
          DESKTOP REQUIRED
        </h1>

        <Empty
          icon="🖥️"
          title="Please use a desktop or laptop"
          description="Map design is not optimized for mobile. Open Runway on a desktop or laptop device to draw waypoints, connect roads, and publish a route."
          action={
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => navigate('/')}>
                Back to Home
              </Button>
              <Button variant="secondary" icon="🎯" onClick={() => navigate('/gallery')}>
                Browse the Gallery
              </Button>
            </div>
          }
        />
      </section>

      <PageFooter />
    </PageShell>
  );
};

export const DesignView: React.FC = () => {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [editorState, setEditorState] = useState<{
    draftWaypoints: any[];
    draftRoads: any[];
    selectedWaypointId: string | null;
    editorTool: any;
    focusWaypointIds: string[] | null;
  }>({
    draftWaypoints: [],
    draftRoads: [],
    selectedWaypointId: null,
    editorTool: null,
    focusWaypointIds: null
  });

  const handleStateUpdate = useCallback((data: {
    draftWaypoints: any[];
    draftRoads: any[];
    selectedWaypointId: string | null;
    editorTool: any;
    focusWaypointIds: string[] | null;
  }) => {
    setEditorState(data);
  }, []);

  // After the hooks, so the surface can swap either way on a rotate.
  if (!isDesktop) return <DesignUnavailable />;

  return (
    <div className="app-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <main className="app-main" style={{ flex: 1, position: 'relative', display: 'flex' }}>
        <MapCore
          interactive={true}
          editorMode={true}
          editorTool={editorState.editorTool}
          editorHint={
            EDITOR_TOOLS.find((t) => t.id === editorState.editorTool)?.hint ?? null
          }
          draftWaypoints={editorState.draftWaypoints}
          draftRoads={editorState.draftRoads}
          selectedWaypointId={editorState.selectedWaypointId}
          focusWaypointIds={editorState.focusWaypointIds}
        />
        <div className="map-top-left-controls">
          <Button
            variant="secondary"
            size="sm"
            icon={<IconBack />}
            onClick={() => navigate('/')}
            className="map-back-btn"
          >
            <span>Back to Home</span>
          </Button>
        </div>
        <EditorSurface onStateUpdate={handleStateUpdate} />
      </main>
    </div>
  );
};
