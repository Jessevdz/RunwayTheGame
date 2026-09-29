import React from 'react';
import { Button, Card, Chip, Icon, type IconName } from '@ds';
import { useDevicePermissions } from '../../core/permissions/useDevicePermissions';
import { permissionHint, type DeviceKind, type PermissionStatus } from '../../core/permissions/devicePermissions';

const ROWS: Array<{ kind: DeviceKind; icon: IconName; title: string; why: string }> = [
  { kind: 'location', icon: 'pin', title: 'Location', why: 'Shows your team on the map and checks you have arrived.' },
  { kind: 'camera', icon: 'camera', title: 'Camera', why: 'For challenge photos. Nothing is shot now.' }
];

const STATUS_LABEL: Record<PermissionStatus, string> = {
  unknown: 'NOT CHECKED',
  checking: 'CHECKING',
  prompt: 'NOT ALLOWED YET',
  granted: 'READY',
  denied: 'BLOCKED',
  unsupported: 'NOT AVAILABLE',
  error: 'NEEDS ATTENTION'
};

const chipKind = (status: PermissionStatus) =>
  status === 'granted' ? 'live' : status === 'denied' || status === 'error' ? 'curse' : 'challenge';

const RECHECK: PermissionStatus[] = ['granted', 'denied', 'error'];

/** Lobby step that asks for location and camera access before the race starts. */
export const GetReadyCard: React.FC = () => {
  const permissions = useDevicePermissions();

  return (
    <Card className="card--pad lobby-card get-ready">
      <div className="lobby-card__head">
        <h2 className="t-announce fs-7">GET READY</h2>
        {permissions.ready && <Chip kind="live">ALL SET</Chip>}
      </div>

      <p className="fs-5 lobby-note">
        Allow these now so nothing interrupts the race. This only checks your phone will allow them: no photo is taken
        and your position is not sent anywhere.
      </p>

      <ul className="get-ready__list">
        {ROWS.map((row) => {
          const status = permissions[row.kind];
          const hint = permissionHint(row.kind, status);
          const busy = status === 'checking';
          return (
            <li key={row.kind} className="get-ready__row">
              <div className="get-ready__main">
                <span className="get-ready__icon" aria-hidden="true"><Icon name={row.icon} /></span>
                <div className="get-ready__text">
                  <span className="fs-5 get-ready__title">{row.title}</span>
                  <span className="fs-3 get-ready__why">{row.why}</span>
                </div>
                <Chip kind={chipKind(status)}>{STATUS_LABEL[status]}</Chip>
              </div>
              {hint && (
                <p className="fs-3 get-ready__hint" role="status">
                  {hint}
                </p>
              )}
              {status !== 'unsupported' && (
                <Button
                  variant={status === 'granted' ? 'ghost' : 'secondary'}
                  size="sm"
                  disabled={busy}
                  onClick={() => permissions.request(row.kind)}
                >
                  {busy ? 'Checking…' : RECHECK.includes(status) ? 'Check again' : `Allow ${row.title.toLowerCase()}`}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
