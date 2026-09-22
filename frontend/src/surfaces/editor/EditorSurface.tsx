import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { analytics } from '../../core/analytics/analyticsClient';
import { firstTime } from '../../core/analytics/coalesce';
import { validateBoard } from '../../core/editor/geometryUtils';
import type { RoadDraft } from '../../core/editor/geometryUtils';
import type { DraftMapWaypoint } from '../../core/map/MapCore';
import { ChallengePoolEditor } from './ChallengePoolEditor';
import { PowerupEditor } from './PowerupEditor';
import { ValidationPanel } from './ValidationPanel';
import { derivePowerupCosts } from './boardDraft';
import { ReadOnlyBanner } from './components/ReadOnlyBanner';
import { ShareModal } from './components/ShareModal';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { ClearMapConfirmModal } from './components/ClearMapConfirmModal';
import { FinishRoleConfirmModal } from './components/FinishRoleConfirmModal';
import { ElementsTab } from './components/ElementsTab';
import { PaneHeader } from './components/PaneHeader';
import { PaneFooter } from './components/PaneFooter';
import { PaneRail } from './components/PaneRail';
import { TabStrip } from './components/TabStrip';
import type { EditorTabId } from './components/tabDefs';
import type { EditorTool } from './components/toolDefs';
import { usePaneChrome } from './usePaneChrome';
import { useBoardDraft } from './useBoardDraft';
import { useBoardFileIO } from './useBoardFileIO';
import { useBoardPersistence } from './useBoardPersistence';
import { useEditorSession } from './useEditorSession';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useMapEditorEvents } from './useMapEditorEvents';
import { useWaypointEditing } from './useWaypointEditing';
import { validationIssueCode } from './validationCodes';

interface EditorSurfaceProps {
  onStateUpdate: (data: {
    draftWaypoints: DraftMapWaypoint[];
    draftRoads: RoadDraft[];
    selectedWaypointId: string | null;
    editorTool: EditorTool | null;
    focusWaypointIds: string[] | null;
  }) => void;
}

/** Map editor side pane container component. */
export const EditorSurface: React.FC<EditorSurfaceProps> = ({ onStateUpdate }) => {
  const { mapId } = useParams<{ mapId?: string }>();
  const navigate = useNavigate();

  const board = useBoardDraft();
  const { draft } = board;
  const persistence = useBoardPersistence(mapId, board);
  const editing = useWaypointEditing(board, persistence.isEditable);
  const files = useBoardFileIO(board, persistence.reportError);

  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [activeTab, setActiveTab] = useState<EditorTabId>('elements');
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [showClearModal, setShowClearModal] = useState<boolean>(false);

  const pane = usePaneChrome();
  const { setCollapsed: setPaneCollapsed } = pane;

  const validationIssues = validateBoard({
    name: draft.boardName,
    waypoints: draft.waypoints,
    roads: draft.roads,
    challenges: draft.challenges,
    roadblockCards: draft.roadblockCards,
    curseCards: draft.curseCards,
    powerupCosts: derivePowerupCosts(draft.powerups)
  });
  const errorCount = validationIssues.filter((i) => i.type === 'error').length;
  const warningCount = validationIssues.length - errorCount;

  useEditorSession({
    mapId,
    isEditable: persistence.isEditable,
    saveStatus: persistence.saveStatus,
    waypointCount: draft.waypoints.length,
    hasSaved: persistence.hasSaved
  });

  const pickTool = useCallback((tool: EditorTool, via: string) => {
    setActiveTool(tool);
    analytics.track('editor.tool_selected', { tool, via });
  }, []);

  const openTab = useCallback((tab: EditorTabId) => {
    setActiveTab(tab);
    analytics.track('editor.tab_opened', { tab });
  }, []);

  // Validation runs on every render; the question worth recording is which
  // problems a board still had at the moment its designer tried to save it.
  const save = useCallback(() => {
    for (const issue of validationIssues) {
      const code = validationIssueCode(issue);
      if (!code) continue;
      if (!firstTime(`validation:${code}`)) continue;
      analytics.track('board.validation_issue', {
        code,
        severity: issue.type === 'error' ? 'error' : 'warning',
        source: 'client'
      });
    }
    void persistence.save();
  }, [validationIssues, persistence]);

  useMapEditorEvents({
    addWaypoint: editing.addWaypoint,
    moveWaypoint: editing.moveWaypoint,
    addRoad: editing.addRoad,
    setStart: editing.setStart,
    requestSetFinish: editing.requestSetFinish,
    requestDeleteRoad: editing.requestDeleteRoad,
    requestDeleteWaypoint: editing.requestDeleteWaypoint,
    selectWaypoint: (waypointId) => {
      editing.selectWaypoint(waypointId);
      if (waypointId) {
        analytics.track('editor.waypoint_selected');
        setActiveTab((tab) => (tab === 'challenges' ? tab : 'elements'));
        setPaneCollapsed(false);
      }
    },
    cancelAction: () => {
      setActiveTool('select');
      editing.selectWaypoint(null);
      analytics.track('editor.action_cancelled');
    }
  });

  useEditorShortcuts({
    isEditable: persistence.isEditable,
    hasSelection: !!editing.selectedWaypointId,
    save,
    deleteSelection: editing.deleteSelectedWaypoint,
    cancel: () => {
      setActiveTool('select');
      editing.selectWaypoint(null);
      // The dispatch below comes back through cancelAction, which records it.
      window.dispatchEvent(new CustomEvent('map-cancel-action'));
    },
    pickTool: (tool) => {
      pickTool(tool, 'key');
      setActiveTab('elements');
    }
  });

  // Sync state to the map. Each waypoint carries its payout, so the reward is
  // visible on the route and not only inside the challenge tab.
  const { waypoints, roads, challenges } = draft;
  const { selectedWaypointId, focusWaypointIds } = editing;
  useEffect(() => {
    onStateUpdate({
      draftWaypoints: waypoints.map((w) => ({
        ...w,
        // No reward badge on the finish: crossing the line pays nothing.
        coinReward: w.isFinish ? null : challenges[w.id]?.coin_reward ?? null
      })),
      draftRoads: roads,
      selectedWaypointId,
      editorTool: activeTool,
      focusWaypointIds
    });
  }, [waypoints, roads, challenges, selectedWaypointId, activeTool, focusWaypointIds, onStateUpdate]);

  const clearMap = useCallback(() => {
    board.reset();
    editing.selectWaypoint(null);
    setActiveTool('select');
    setActiveTab('elements');
    persistence.clearStoredDraft();
    window.dispatchEvent(new CustomEvent('map-cancel-action'));
    setShowClearModal(false);
  }, [board, editing, persistence]);

  const paneStyle = {
    '--pane-w': `${pane.width}px`,
    '--pane-h': `${Math.round(pane.height * 100)}%`
  } as React.CSSProperties;

  const paneClass = [
    'editor-pane',
    pane.collapsed ? 'editor-pane--collapsed' : '',
    pane.dragging ? '' : 'editor-pane--animated'
  ]
    .filter(Boolean)
    .join(' ');

  if (pane.collapsed) {
    return (
      <aside className={paneClass} style={paneStyle} aria-label="Map designer">
        <PaneRail
          active={activeTab}
          errorCount={errorCount}
          onBack={() => navigate('/')}
          onExpand={() => pane.setCollapsed(false)}
          onPick={(id) => {
            openTab(id);
            pane.setCollapsed(false);
          }}
        />
      </aside>
    );
  }

  return (
    <aside className={paneClass} style={paneStyle} aria-label="Map designer">
      <button
        type="button"
        className="editor-pane__resizer"
        aria-label="Resize panel"
        title="Drag to resize"
        onPointerDown={pane.handleResizeStart}
        onKeyDown={pane.handleResizeKey}
      />

      <PaneHeader
        name={draft.boardName}
        editable={persistence.isEditable}
        status={persistence.saveStatus}
        savedToServer={!!persistence.mapId}
        listed={persistence.isListed}
        waypointCount={draft.waypoints.length}
        roadCount={draft.roads.length}
        onNameChange={board.setBoardName}
        onBack={() => navigate('/')}
        onCollapse={() => pane.setCollapsed(true)}
      />

      <TabStrip active={activeTab} errorCount={errorCount} onChange={openTab} />

      <div className="pane-body">
        {!persistence.isEditable && (
          <ReadOnlyBanner
            mapName={draft.boardName}
            onFork={persistence.fork}
            isForking={persistence.isForking}
          />
        )}

        {persistence.errorMessage && (
          <div className="callout callout--curse">
            <div className="callout__kind">Save failure</div>
            <p className="fs-4">{persistence.errorMessage}</p>
          </div>
        )}

        {activeTab === 'elements' && (
          <ElementsTab
            waypointCount={draft.waypoints.length}
            activeTool={activeTool}
            editable={persistence.isEditable}
            selectedWaypoint={editing.selectedWaypoint}
            connectedRoads={editing.connectedRoads}
            onToolChange={(tool) => pickTool(tool, 'click')}
            onChangeWaypoint={editing.updateField}
            onLocateWaypoint={() =>
              editing.selectedWaypoint && editing.focusWaypoints([editing.selectedWaypoint.id])
            }
            onDeleteWaypoint={editing.deleteSelectedWaypoint}
            onDeleteRoad={editing.requestDeleteRoad}
          />
        )}

        {activeTab === 'challenges' && (
          <ChallengePoolEditor
            waypoints={draft.waypoints}
            roads={draft.roads}
            challenges={draft.challenges}
            selectedWaypointId={editing.selectedWaypointId}
            onSelectWaypoint={editing.selectWaypoint}
            onChangeChallenges={(updated) => persistence.isEditable && board.setChallenges(updated)}
          />
        )}

        {/* Deck builder tab inactive for current PoC
        {activeTab === 'decks' && (
          <DeckEditor
            roadblockCards={draft.roadblockCards}
            curseCards={draft.curseCards}
            isEditable={persistence.isEditable}
            onChangeRoadblocks={(updated) => persistence.isEditable && board.setRoadblockCards(updated)}
            onChangeCurses={(updated) => persistence.isEditable && board.setCurseCards(updated)}
          />
        )}
        */}

        {activeTab === 'powerups' && (
          <PowerupEditor
            powerups={draft.powerups}
            isEditable={persistence.isEditable}
            onChangePowerups={(updated) => persistence.isEditable && board.setPowerups(updated)}
          />
        )}

        {activeTab === 'validation' && (
          <ValidationPanel
            issues={validationIssues}
            onFocusIssue={editing.focusWaypoints}
            waypointCount={draft.waypoints.length}
          />
        )}
      </div>

      <input
        type="file"
        ref={files.fileInputRef}
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={files.handleFileChange}
      />

      <PaneFooter
        editable={persistence.isEditable}
        status={persistence.saveStatus}
        errorCount={errorCount}
        warningCount={warningCount}
        canShare={!!persistence.mapId}
        canClear={draft.waypoints.length > 0 || draft.roads.length > 0}
        listed={persistence.isListed}
        onReviewIssues={() => openTab('validation')}
        onClear={() => setShowClearModal(true)}
        onShare={() => setShowShareModal(true)}
        onSave={save}
        onImport={files.triggerImport}
        onExport={files.exportBoard}
      />

      {showShareModal && persistence.mapId && (
        <ShareModal
          mapId={persistence.mapId}
          mapName={draft.boardName}
          editToken={persistence.editToken}
          isListed={persistence.isListed}
          isDirty={persistence.saveStatus !== 'saved'}
          errorCount={errorCount}
          busy={persistence.listingBusy}
          error={persistence.listingError}
          onSetListed={persistence.setListed}
          onClose={() => {
            setShowShareModal(false);
            persistence.clearListingError();
          }}
        />
      )}

      {showClearModal && (
        <ClearMapConfirmModal
          waypointCount={draft.waypoints.length}
          roadCount={draft.roads.length}
          savedToServer={!!persistence.mapId}
          onConfirm={clearMap}
          onCancel={() => setShowClearModal(false)}
        />
      )}

      {editing.pendingDelete && (
        <DeleteConfirmModal
          target={editing.pendingDelete}
          onConfirm={editing.confirmDelete}
          onCancel={editing.cancelDelete}
        />
      )}

      {editing.pendingFinishRole && (
        <FinishRoleConfirmModal
          target={editing.pendingFinishRole}
          onConfirm={editing.confirmFinishRole}
          onCancel={editing.cancelFinishRole}
        />
      )}
    </aside>
  );
};
