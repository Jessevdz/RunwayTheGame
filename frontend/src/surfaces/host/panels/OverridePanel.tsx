import React, { useMemo, useState } from 'react';
import type { GameState } from '../../../core/projection/projectionStore';
import { overrideCoins, overrideClearChallenge, overrideClearEffect } from '../../../core/api/client';
import { Card, Select, Input, Checkbox, Button, Dialog } from '@ds';
import type { ToastMessage } from '../HostToolsPanel';

interface OverridePanelProps {
  gameId: string;
  hostToken: string;
  gameState: GameState;
  onToast: (text: string, tone?: ToastMessage['tone']) => void;
}

const isActive = (until?: string) => (until ? new Date(until).getTime() > Date.now() : false);

type PendingAction =
  | { kind: 'coins'; teamId: string; delta: number; note: string }
  | { kind: 'clear-challenge'; teamId: string; waypointId: string; note: string; awardCoins: boolean }
  | { kind: 'clear-effect'; teamId: string; effectType: 'freeze' | 'curse' | 'veto_penalty' | 'tracker_off'; note: string };

export const OverridePanel: React.FC<OverridePanelProps> = ({ gameId, hostToken, gameState, onToast }) => {
  const teamOptions = useMemo(
    () => Object.entries(gameState.teams).map(([id, info]) => ({ id, name: info.name })),
    [gameState.teams]
  );

  const [coinsTeam, setCoinsTeam] = useState('');
  const [coinsDelta, setCoinsDelta] = useState('');
  const [coinsNote, setCoinsNote] = useState('');

  const [chalTeam, setChalTeam] = useState('');
  const [chalWaypoint, setChalWaypoint] = useState('');
  const [chalAward, setChalAward] = useState(true);
  const [chalNote, setChalNote] = useState('');

  const stuckWaypointsForTeam = useMemo(() => {
    if (!chalTeam) return [];
    const prog = gameState.progress[chalTeam];
    if (!prog?.currentWaypointId) return [];
    const state = gameState.waypointStates[prog.currentWaypointId];
    const open =
      Object.values(state?.clearedBy || {}).some(Boolean) || !!state?.bypassed?.[chalTeam];
    if (open) return [];
    const wp = gameState.waypoints.find((w) => w.id === prog.currentWaypointId);
    return [{ id: prog.currentWaypointId, name: wp?.name || prog.currentWaypointId }];
  }, [chalTeam, gameState.progress, gameState.waypointStates, gameState.waypoints]);

  const [effTeam, setEffTeam] = useState('');
  const [effType, setEffType] = useState('');
  const [effNote, setEffNote] = useState('');

  const activeEffectsForTeam = useMemo(() => {
    if (!effTeam) return [];
    const eff = gameState.effects[effTeam];
    if (!eff) return [];
    const options: string[] = [];
    if (isActive(eff.frozenUntil)) options.push('freeze');
    if (isActive(eff.vetoPenaltyUntil)) options.push('veto_penalty');
    if (isActive(eff.trackerOffUntil)) options.push('tracker_off');
    // if (eff.curses.length > 0) options.push('curse');
    return options;
  }, [effTeam, gameState.effects]);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirmAndSubmit = async () => {
    if (!pending) return;
    setSubmitting(true);
    try {
      if (pending.kind === 'coins') {
        const resp = await overrideCoins(gameId, hostToken, pending.teamId, pending.delta, pending.note);
        onToast(`Coins adjusted — new balance ${resp.new_balance}.`, 'moss');
        setCoinsTeam('');
        setCoinsDelta('');
        setCoinsNote('');
      } else if (pending.kind === 'clear-challenge') {
        await overrideClearChallenge(gameId, hostToken, pending.teamId, pending.waypointId, pending.note, pending.awardCoins);
        onToast('Challenge cleared.', 'moss');
        setChalTeam('');
        setChalWaypoint('');
        setChalNote('');
        setChalAward(true);
      } else {
        await overrideClearEffect(gameId, hostToken, pending.teamId, pending.effectType, pending.note);
        onToast('Effect cleared.', 'moss');
        setEffTeam('');
        setEffType('');
        setEffNote('');
      }
    } catch (err: any) {
      onToast(err.message || 'Override failed', 'crimson');
    } finally {
      setSubmitting(false);
      setPending(null);
    }
  };

  return (
    <div className="override-panel">
      <Card className="card--pad override-panel__form">
        <h2 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-strong)' }}>ADJUST COINS</h2>
        <Select label="TEAM" value={coinsTeam} onChange={(e) => setCoinsTeam(e.target.value)}>
          <option value="">Select a team…</option>
          {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Input label="AMOUNT" type="number" value={coinsDelta} onChange={(e) => setCoinsDelta(e.target.value)} placeholder="e.g. -5 or 10" />
        <Input label="NOTE" value={coinsNote} onChange={(e) => setCoinsNote(e.target.value)} placeholder="Reason for adjustment" />
        <Button
          variant="primary"
          disabled={!coinsTeam || !coinsNote || coinsDelta === ''}
          onClick={() => setPending({ kind: 'coins', teamId: coinsTeam, delta: Number(coinsDelta), note: coinsNote })}
        >
          Adjust Coins
        </Button>
      </Card>

      <Card className="card--pad override-panel__form">
        <h2 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-strong)' }}>CLEAR CHALLENGE</h2>
        <Select label="TEAM" value={chalTeam} onChange={(e) => { setChalTeam(e.target.value); setChalWaypoint(''); }}>
          <option value="">Select a team…</option>
          {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select label="WAYPOINT" value={chalWaypoint} onChange={(e) => setChalWaypoint(e.target.value)}>
          <option value="">{chalTeam ? (stuckWaypointsForTeam.length ? 'Select a waypoint…' : 'Not stuck on any waypoint') : 'Select a team first'}</option>
          {stuckWaypointsForTeam.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </Select>
        <Checkbox label="Award coins" checked={chalAward} onChange={(e) => setChalAward(e.target.checked)} />
        <Input label="NOTE" value={chalNote} onChange={(e) => setChalNote(e.target.value)} placeholder="Reason for clearing" />
        <Button
          variant="primary"
          disabled={!chalTeam || !chalWaypoint || !chalNote}
          onClick={() => setPending({ kind: 'clear-challenge', teamId: chalTeam, waypointId: chalWaypoint, note: chalNote, awardCoins: chalAward })}
        >
          Clear Challenge
        </Button>
      </Card>

      <Card className="card--pad override-panel__form">
        <h2 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-strong)' }}>CLEAR EFFECT</h2>
        <Select label="TEAM" value={effTeam} onChange={(e) => { setEffTeam(e.target.value); setEffType(''); }}>
          <option value="">Select a team…</option>
          {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select label="EFFECT" value={effType} onChange={(e) => setEffType(e.target.value)}>
          <option value="">{effTeam ? (activeEffectsForTeam.length ? 'Select an effect…' : 'No active effects') : 'Select a team first'}</option>
          {activeEffectsForTeam.map((e) => <option key={e} value={e}>{e}</option>)}
        </Select>
        <Input label="NOTE" value={effNote} onChange={(e) => setEffNote(e.target.value)} placeholder="Reason for clearing" />
        <Button
          variant="primary"
          disabled={!effTeam || !effType || !effNote}
          onClick={() => setPending({ kind: 'clear-effect', teamId: effTeam, effectType: effType as 'freeze' | 'curse' | 'veto_penalty' | 'tracker_off', note: effNote })}
        >
          Clear Effect
        </Button>
      </Card>

      <Dialog open={!!pending} title="Confirm override" onClose={() => setPending(null)}>
        <p className="fs-5" style={{ color: 'var(--ink-muted)' }}>
          This action is permanent and will appear in the public event log.
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end', marginTop: 'var(--sp-4)' }}>
          <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="primary" onClick={confirmAndSubmit} disabled={submitting}>{submitting ? 'Applying…' : 'Confirm'}</Button>
        </div>
      </Dialog>
    </div>
  );
};
export default OverridePanel;
