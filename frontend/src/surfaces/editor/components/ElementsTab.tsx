import React from 'react';
import { Button, Empty } from '@ds';
import { IconWaypoint } from './EditorIcons';
import { ToolPalette } from './ToolPalette';
import { WaypointInspector } from './WaypointInspector';
import type { EditorTool } from './toolDefs';
import type { WaypointDraft } from '../../../core/editor/geometryUtils';
import type { ConnectedRoad } from '../useWaypointEditing';

interface ElementsTabProps {
  waypointCount: number;
  activeTool: EditorTool;
  editable: boolean;
  selectedWaypoint: WaypointDraft | null;
  connectedRoads: ConnectedRoad[];
  onToolChange: (tool: EditorTool) => void;
  onChangeWaypoint: (field: keyof WaypointDraft, value: string | number | boolean) => void;
  onLocateWaypoint: () => void;
  onDeleteWaypoint: () => void;
  onDeleteRoad: (roadId: string) => void;
}

/** The map tab: the tools, and the record of whichever waypoint is selected. */
export const ElementsTab: React.FC<ElementsTabProps> = ({
  waypointCount,
  activeTool,
  editable,
  selectedWaypoint,
  connectedRoads,
  onToolChange,
  onChangeWaypoint,
  onLocateWaypoint,
  onDeleteWaypoint,
  onDeleteRoad
}) => {
  if (waypointCount === 0) {
    return (
      <>
        <Empty
          icon={<IconWaypoint />}
          title="No waypoints yet"
          action={
            <Button
              variant="primary"
              size="sm"
              disabled={!editable}
              onClick={() => onToolChange('waypoint')}
            >
              Start placing waypoints
            </Button>
          }
        />
        <ToolPalette active={activeTool} editable={editable} onChange={onToolChange} />
      </>
    );
  }

  return (
    <>
      <ToolPalette active={activeTool} editable={editable} onChange={onToolChange} />

      {selectedWaypoint ? (
        <WaypointInspector
          waypoint={selectedWaypoint}
          editable={editable}
          connectedRoads={connectedRoads}
          onChange={onChangeWaypoint}
          onLocate={onLocateWaypoint}
          onDelete={onDeleteWaypoint}
          onDeleteRoad={onDeleteRoad}
        />
      ) : (
        <p className="tool-hint tool-hint--muted">
          <span className="tool-hint__mark" aria-hidden="true">
            <IconWaypoint />
          </span>
          <span>Select a waypoint on the map to edit its name, radius and role.</span>
        </p>
      )}
    </>
  );
};
