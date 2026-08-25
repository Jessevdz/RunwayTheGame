import React from 'react';
import {
  IconWaypoint,
  IconCursor,
  IconFinish,
  IconRoad,
  IconStart,
  IconTrash
} from './EditorIcons';

export type EditorTool = 'select' | 'waypoint' | 'road' | 'start' | 'finish' | 'delete';

export interface EditorToolDef {
  id: EditorTool;
  label: string;
  /** Single-key shortcut, shown in the tooltip and the mode readout. */
  key: string;
  icon: React.ReactNode;
  /** What the *next click on the map* will do. */
  hint: string;
  /** Whether the tool mutates the board, and so needs edit rights. */
  writes: boolean;
}

export const EDITOR_TOOLS: EditorToolDef[] = [
  {
    id: 'select',
    label: 'Select',
    key: 'V',
    icon: <IconCursor />,
    hint: 'Click a waypoint to inspect it, or drag it to move it.',
    writes: false
  },
  {
    id: 'waypoint',
    label: 'Point',
    key: 'C',
    icon: <IconWaypoint />,
    hint: 'Click anywhere on the map to drop a waypoint.',
    writes: true
  },
  {
    id: 'road',
    label: 'Road',
    key: 'R',
    icon: <IconRoad />,
    hint: 'Click two waypoints in turn to lay a road between them.',
    writes: true
  },
  {
    id: 'start',
    label: 'Start',
    key: 'S',
    icon: <IconStart />,
    hint: 'Click a waypoint to make it the starting line.',
    writes: true
  },
  {
    id: 'finish',
    label: 'Finish',
    key: 'F',
    icon: <IconFinish />,
    hint: 'Click a waypoint to make it the finish line.',
    writes: true
  },
  {
    id: 'delete',
    label: 'Delete',
    key: 'D',
    icon: <IconTrash />,
    hint: 'Click a waypoint or road section on the map to remove it.',
    writes: true
  }
];
