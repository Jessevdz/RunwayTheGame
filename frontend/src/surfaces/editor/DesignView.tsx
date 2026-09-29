import React, { useState, useCallback, useEffect } from 'react';
import { analytics } from '../../core/analytics/analyticsClient';
import { currentViewport } from '../../core/analytics/events';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, PageHeader, Icon } from '@ds';
import { MapCore } from '../../core/map/MapCore';
import { EditorSurface } from './EditorSurface';
import { EDITOR_TOOLS } from './components/toolDefs';
import { useIsDesktop } from '../../core/ui/useIsDesktop';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';

// Mobile fallback notice rendered when map designer is opened on small viewports.
const DesignUnavailable: React.FC = () => {
  const navigate = useNavigate();

  // The editor is desktop-only, so this is the count of people who wanted it
  // and could not have it.
  useEffect(() => {
    analytics.track('app.design_unavailable', { viewport: currentViewport() });
  }, []);

  return (
    <PageShell
      navPlacement="topbar"
      topBarProps={{}}
    >
      <section style={{ maxWidth: '62.5rem', margin: '0 auto var(--sp-7)' }}>
        <PageHeader title="DESKTOP REQUIRED" />

        <Empty
          icon={<Icon name="monitor" />}
          title="Please use a desktop or laptop"
          description="Open Runway on a desktop or laptop to design maps."
          action={
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => navigate('/')}>
                Back to Home
              </Button>
              <Button variant="secondary" icon={<Icon name="target" />} onClick={() => navigate('/gallery')}>
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
            icon={<Icon name="arrow-left" />}
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
