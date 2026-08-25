import React, { useEffect, useRef, useState } from 'react';
import { isSoloMode, isCoinRush, type GameState, type Powerup } from '../../core/projection/projectionStore';
import type { TeamSession } from '../../core/game/teamSession';
import { buyPowerup, activatePowerup } from '../../core/api/client';
import { Dialog, Button, Stat, Callout, Chip, Empty, IconCoin } from '@ds';
import './shop-panel.css';

interface ShopPanelProps {
  session: TeamSession;
  gameState: GameState;
  /** Active gating waypoint ID for challenge skip targeting. */
  gatingWaypointId?: string;
  onClose: () => void;
}

interface CatalogEntry {
  id: Powerup;
  name: string;
  cost: number;
  desc: string;
  /** Short label for the powerup effect. */
  short: string;
  /** True when effect targets the user team rather than rivals. */
  selfAffecting?: boolean;
}

const POWERUP_CATALOG: CatalogEntry[] = [
  { id: 'nerf', name: 'Nerf Dart', cost: 10, desc: 'Freeze the opposing team where they stand. They cannot act until it wears off.', short: '30 min freeze' },
  // { id: 'roadblock', name: 'Roadblock', cost: 15, desc: 'Block a road of your choice with a roadblock challenge.', short: 'One road' },
  { id: 'tracker_off', name: 'Tracker Off', cost: 25, desc: 'Hide your position dot from opponents so they cannot read your route.', short: '45 min hidden' },
  // { id: 'curse', name: 'Curse', cost: 25, desc: 'Force the opposing team to satisfy a travel constraint before they continue.', short: 'Until resolved' },
  { id: 'challenge_skip', name: 'Challenge Skip', cost: 100, desc: 'Bypass your current blocking challenge immediately, with no penalty.', short: 'Instant', selfAffecting: true }
];

const CATALOG_BY_ID = new Map(POWERUP_CATALOG.map((p) => [p.id, p]));

/** Filters powerup catalog entries that affect the purchasing player/team directly. */
const isSelfAffecting = (entry: CatalogEntry): boolean => entry.selfAffecting === true;

const labelFor = (id: Powerup): string => CATALOG_BY_ID.get(id)?.name ?? id.replace(/_/g, ' ');

/** Inventory arrives as a flat list with repeats — players read it as counts. */
const countByPowerup = (inventory: Powerup[]): Array<{ id: Powerup; count: number }> => {
  const counts = new Map<Powerup, number>();
  inventory.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
};

export const ShopPanel: React.FC<ShopPanelProps> = ({ session, gameState, gatingWaypointId, onClose }) => {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const teamId = session.teamId;
  const coins = gameState.coins[teamId] || 0;
  const inventory = gameState.inventory[teamId] || [];

  const solo = isSoloMode(gameState.mode);
  const catalog = solo ? POWERUP_CATALOG.filter(isSelfAffecting) : POWERUP_CATALOG;
  // Indicates if team has finished in coin rush mode.
  const lockedOut = isCoinRush(gameState.mode) && !!gameState.progress[teamId]?.reachedFinish;
  const owned = countByPowerup(inventory);

  const opponentTeam = Object.keys(gameState.teams).find((id) => id !== teamId) || 'opponent-team';

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const showNotification = (text: string, isErr = false) => {
    setNotice({ kind: isErr ? 'error' : 'success', text });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  };

  const handleBuy = async (powerup: Powerup, cost: number) => {
    if (coins < cost) {
      showNotification('Not enough coins.', true);
      return;
    }
    setBusy(true);
    try {
      await buyPowerup(gameState.gameId!, {
        powerup,
        team_token: session.teamToken,
        idempotency_key: `buy-${Date.now()}`
      });
      showNotification(`Purchased ${labelFor(powerup)}.`);
    } catch (err: any) {
      showNotification(err.message || 'Failed to buy power-up', true);
    } finally {
      setBusy(false);
    }
  };

  const handleUse = async (powerup: Powerup, roadId?: string) => {
    const target = roadId ?? (powerup === 'challenge_skip' ? gatingWaypointId : undefined);
    if (powerup === 'challenge_skip' && !target) {
      showNotification('Nothing to skip — you are not standing at a challenge.', true);
      return;
    }

    setBusy(true);
    try {
      await activatePowerup(gameState.gameId!, {
        powerup,
        team_token: session.teamToken,
        target_team_id: opponentTeam,
        road_id: target,
        idempotency_key: `use-${Date.now()}`
      });
      showNotification(`Used ${labelFor(powerup)}.`);
    } catch (err: any) {
      showNotification(err.message || 'Failed to use power-up', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title="🛒 Power-up shop" onClose={onClose} className="dialog--shop">
      <div className="shop">
        {notice && (
          <Callout kind={notice.kind === 'error' ? 'curse' : 'power'}>
            <div className="callout__kind">{notice.kind === 'error' ? 'Error' : 'Done'}</div>
            <p className="fs-4">{notice.kind === 'error' ? '⚠️' : '✓'} {notice.text}</p>
          </Callout>
        )}

        {/* Balance and holdings, side by side — the two numbers every buying
            decision is measured against. */}
        <div className="shop__ledger">
          <Stat
            className="shop__balance"
            label={lockedOut ? 'Final score' : 'Balance'}
            value={<><IconCoin /> {coins}</>}
            tone="bright"
          />
          <Stat label="Inventory" value={inventory.length} hint={inventory.length === 1 ? 'item held' : 'items held'} />
        </div>

        {/* Curses display inactive for current PoC
        {activeEffects.curses.length > 0 && (
          <Callout kind="curse">
            <div className="callout__kind">Active curses</div>
            <div className="shop__rows">
              {activeEffects.curses.map((c) => (
                <div key={c.id} className="shop__row">
                  <span className="shop__row-text">
                    <span className="shop__row-name">{c.text}</span>
                  </span>
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => handleResolveCurse(c.id)}>
                    Resolve
                  </Button>
                </div>
              ))}
            </div>
          </Callout>
        )}
        */}

        {owned.length > 0 && (
          <section className="shop__section">
            <div className="shop__section-head">
              <h3 className="shop__section-title">🎒 Owned power-ups</h3>
              <span className="shop__count">{inventory.length} held</span>
            </div>
            <div className="shop__rows">
              {owned.map(({ id, count }) => {
                // A skip with nothing to skip is a wasted item, so the button
                // waits until the player is actually standing at a challenge.
                const unusable = (id === 'challenge_skip' && !gatingWaypointId) || lockedOut;
                return (
                  <div key={id} className="shop__row">
                    <span className="shop__row-text">
                      <span className="shop__row-name">{labelFor(id)}</span>
                      <span className="shop__row-note">
                        {lockedOut
                          ? 'Your race is over'
                          : unusable
                            ? 'Nothing to skip right now'
                            : CATALOG_BY_ID.get(id)?.short ?? 'Ready'}
                      </span>
                    </span>
                    <Chip kind="power">×{count}</Chip>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="⚡"
                      disabled={busy || unusable}
                      onClick={() => handleUse(id)}
                    >
                      Use
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* A solo shelf filtered down to nothing renders as nothing — an empty
            grid under a "0/0 affordable" heading is worse than no section. */}
        {lockedOut ? (
          <Empty
            icon="🏁"
            title="Your score is settled"
            description="You have crossed the finish line. Your coins are your final score now — nothing left to spend them on."
          />
        ) : catalog.length === 0 ? (
          <Empty
            icon="🛒"
            title="Nothing to sell you"
            description="Every item in this game acts on a rival team, and you are running alone."
          />
        ) : (
        <section className="shop__section">
          <div className="shop__section-head">
            <h3 className="shop__section-title">🛒 Available items</h3>
            <span className="shop__count">
              {catalog.filter((p) => coins >= p.cost).length}/{catalog.length} affordable
            </span>
          </div>
          <div className="shop__catalog">
            {catalog.map((p) => {
              const canAfford = coins >= p.cost;
              return (
                <article key={p.id} className={`shop-item${canAfford ? '' : ' shop-item--locked'}`}>
                  <div className="shop-item__head">
                    <h4 className="shop-item__name">{p.name}</h4>
                    <Chip kind={canAfford ? 'power' : 'veto'}><IconCoin /> {p.cost}</Chip>
                  </div>
                  <p className="shop-item__desc">{p.desc}</p>
                  <div className="shop-item__foot">
                    <span className="shop-item__short">
                      {canAfford ? p.short : `Need ${p.cost - coins} more`}
                    </span>
                    <Button
                      variant={canAfford ? 'primary' : 'secondary'}
                      size="sm"
                      disabled={busy || !canAfford}
                      onClick={() => handleBuy(p.id, p.cost)}
                    >
                      Buy
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        )}
      </div>
    </Dialog>
  );
};
export default ShopPanel;
