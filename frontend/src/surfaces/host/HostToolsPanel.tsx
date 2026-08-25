import React, { useEffect, useMemo, useRef, useState } from 'react';
import { elapsedSeconds, type GameState } from '../../core/projection/projectionStore';
import { formatClock } from '../../core/format/clock';
import { Tabs, type TabItem } from '@ds';
import { HostDashboard } from './panels/HostDashboard';
import { DisputeQueue } from './panels/DisputeQueue';
import { ReviewQueue } from './panels/ReviewQueue';
import { OverridePanel } from './panels/OverridePanel';
import { HostEventLog } from './panels/HostEventLog';
import { PostGameRecap } from './panels/PostGameRecap';
import './host-console.css';

export type HostTab = 'dashboard' | 'review' | 'disputes' | 'overrides' | 'log' | 'recap';

export interface ToastMessage {
  id: number;
  tone: 'gold' | 'rust' | 'moss' | 'crimson' | 'neutral';
  text: string;
}

interface HostToolsPanelProps {
  gameId: string;
  hostToken: string;
  gameState: GameState;
  onToast: (text: string, tone?: ToastMessage['tone']) => void;
}

/** Host management panel containing dashboard, disputes, overrides, log, and recap. */
export const HostToolsPanel: React.FC<HostToolsPanelProps> = ({ gameId, hostToken, gameState, onToast }) => {
  const [activeTab, setActiveTab] = useState<HostTab>('dashboard');

  const disputeCount = useMemo(
    () => Object.values(gameState.disputes).filter((d) => d.status === 'pending').length,
    [gameState.disputes]
  );

  // In host grading mode this is the host's actual job for the whole race, so it
  // sits second — ahead of disputes and overrides, which are exceptions.
  const hostGrades = gameState.ruleset.verification === 'host';
  const reviewCount = useMemo(
    () => Object.values(gameState.submissions).filter((s) => s.status === 'pending').length,
    [gameState.submissions]
  );

  const tabs: TabItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    ...(hostGrades ? [{ id: 'review', label: 'Review', icon: '📷', badge: reviewCount }] : []),
    { id: 'disputes', label: 'Disputes', icon: '⚖️', badge: disputeCount },
    { id: 'overrides', label: 'Overrides', icon: '🛠️' },
    { id: 'log', label: 'Log', icon: '📜' },
    ...(gameState.state === 'ended' ? [{ id: 'recap', label: 'Recap', icon: '🏆' }] : [])
  ];

  // The bar is sticky and the clock is the only thing on it that moves, so it
  // ticks on its own rather than waiting for the next projection push — which in
  // a quiet race can be a minute apart.
  const live = gameState.state === 'live';
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  const elapsed = elapsedSeconds(gameState.clock, nowMs);

  // A finished race has one thing worth looking at, and it is not the override
  // panel. A tab that is not on offer in this game's grading mode falls back the
  // same way rather than rendering an empty pane.
  let resolvedTab: HostTab = activeTab;
  if (gameState.state === 'ended' && activeTab === 'overrides') resolvedTab = 'recap';
  if (activeTab === 'review' && !hostGrades) resolvedTab = 'dashboard';

  // Scrolls the active tab into view when selected or when tab list changes.
  const barRef = useRef<HTMLDivElement>(null);
  const tabCount = tabs.length;
  useEffect(() => {
    barRef.current
      ?.querySelector('.host-console__tabs .tab--active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [resolvedTab, tabCount]);

  return (
    <div className="host-console">
      <div className="host-console__bar" ref={barRef}>
        <Tabs items={tabs} active={resolvedTab} onChange={(id) => setActiveTab(id as HostTab)} className="host-console__tabs" />
        <div className="host-console__clock t-data fs-3">
          {gameState.clock.startedAt ? (
            <>
              <span className={`host-console__state${live ? ' host-console__state--live' : ''}`}>
                {live ? 'LIVE' : 'ENDED'}
              </span>
              <b>{formatClock(elapsed)}</b>
            </>
          ) : (
            <span className="host-console__state">NOT STARTED</span>
          )}
        </div>
      </div>

      <div className="host-console__panel">
        {resolvedTab === 'dashboard' && (
          <HostDashboard
            gameId={gameId}
            hostToken={hostToken}
            gameState={gameState}
            onToast={onToast}
            onOpenDisputes={() => setActiveTab('disputes')}
            onOpenReview={hostGrades ? () => setActiveTab('review') : undefined}
          />
        )}
        {resolvedTab === 'review' && (
          <ReviewQueue gameId={gameId} hostToken={hostToken} gameState={gameState} onToast={onToast} />
        )}
        {resolvedTab === 'disputes' && (
          <DisputeQueue gameId={gameId} hostToken={hostToken} gameState={gameState} onToast={onToast} />
        )}
        {resolvedTab === 'overrides' && (
          <OverridePanel gameId={gameId} hostToken={hostToken} gameState={gameState} onToast={onToast} />
        )}
        {resolvedTab === 'log' && <HostEventLog gameState={gameState} />}
        {resolvedTab === 'recap' && <PostGameRecap gameState={gameState} />}
      </div>
    </div>
  );
};
