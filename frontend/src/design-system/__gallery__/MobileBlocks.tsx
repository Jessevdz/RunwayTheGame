import React from 'react';
import { Button } from '../primitives/Button';
import { Skeleton } from '../primitives/Skeleton';
import { Progress } from '../primitives/Progress';
import { Clock } from '../primitives/Clock';
import { BrandMark } from '../primitives/BrandMark';
import { PageHeader } from '../layout/PageHeader';
import { ActionBar } from '../layout/ActionBar';
import { Dialog, type DialogPresentation } from '../overlays/Dialog';
import { Sheet, type SheetSnap } from '../overlays/Sheet';
import { ConfirmProvider } from '../overlays/ConfirmSheet';
import { useConfirm } from '../overlays/useConfirm';
import { ToastRegion } from '../overlays/ToastRegion';
import { useToast, type ToastTone } from '../overlays/toastStore';

const TONES: ToastTone[] = ['neutral', 'moss', 'gold', 'rust', 'crimson'];

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="gallery-section">
    <h2 className="t-label fs-label gallery-section__title">{title}</h2>
    {children}
  </section>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="gallery-row">{children}</div>;

const Demo: React.FC = () => {
  const confirm = useConfirm();
  const toast = useToast();
  const [presentation, setPresentation] = React.useState<DialogPresentation | null>(null);
  const [sheetShown, setSheetShown] = React.useState(false);
  const [snap, setSnap] = React.useState<SheetSnap>('peek');
  const [answer, setAnswer] = React.useState('');
  const [progress, setProgress] = React.useState(3);

  return (
    <>
      <Section title="Sheet — collapsed / peek / expanded">
        <Row>
          <Button variant="secondary" onClick={() => setSheetShown((v) => !v)}>
            {sheetShown ? 'Hide sheet' : 'Show sheet'}
          </Button>
          <span className="t-data fs-4">snap: {snap}</span>
        </Row>
        {sheetShown && (
          <Sheet
            label="race panel"
            snap={snap}
            onSnapChange={setSnap}
            summary={
              <Row>
                <Clock seconds={261} size="md" caption="Time left" />
                <Progress value={progress} max={8} label="Waypoints reached" valueText={`${progress} of 8`} variant="sunset" />
              </Row>
            }
          >
            <div className="gallery-mt-3">
              <p className="fs-6">Drag the handle, tap it, or use the arrow keys.</p>
              <Button variant="secondary" onClick={() => setProgress((p) => (p % 8) + 1)}>
                Advance progress
              </Button>
            </div>
          </Sheet>
        )}
      </Section>

      <Section title="Dialog presentations">
        <Row>
          {(['center', 'sheet', 'fullscreen'] as const).map((p) => (
            <Button key={p} variant="secondary" onClick={() => setPresentation(p)}>
              {p}
            </Button>
          ))}
        </Row>
        <Dialog
          open={presentation !== null}
          presentation={presentation ?? 'center'}
          title={`Dialog · ${presentation}`}
          onClose={() => setPresentation(null)}
        >
          <p className="fs-6">Heights use dvh, so the on-screen browser chrome never clips this.</p>
        </Dialog>
      </Section>

      <Section title="Confirm sheet and toasts">
        <Row>
          <Button
            variant="secondary"
            onClick={async () => {
              const ok = await confirm({
                title: 'Leave the race?',
                message: 'Your team keeps its place, but you stop earning points.',
                confirmLabel: 'Leave race',
                danger: true,
              });
              setAnswer(ok ? 'confirmed' : 'cancelled');
            }}
          >
            Confirm
          </Button>
          <span className="t-data fs-4">{answer}</span>
        </Row>
        <div className="gallery-mt-3">
          <Row>
            {TONES.map((tone) => (
              <Button key={tone} variant="ghost" onClick={() => toast.show(`A ${tone} toast.`, { tone })}>
                {tone}
              </Button>
            ))}
          </Row>
        </div>
        <ToastRegion />
      </Section>

      <Section title="Skeleton, progress, clock">
        <div className="gallery-grid-sm">
          <Skeleton variant="text" lines={3} />
          <Skeleton variant="block" height="var(--sp-8)" />
          <Skeleton variant="circle" />
        </div>
        <div className="gallery-grid-sm gallery-mt-4">
          <Progress value={35} label="Plain progress" />
          <Progress value={60} label="Sunset progress" variant="sunset" />
          <Progress value={75} label="Sunset arc progress" variant="arc" />
        </div>
        <div className="gallery-mt-4">
          <Row>
            <Clock seconds={261} size="md" caption="Elapsed" />
            <Clock seconds={3725} size="lg" caption="Run clock" />
            <Clock seconds={261} size="xl" flap caption="Countdown" />
          </Row>
        </div>
      </Section>

      <Section title="Brand mark, page header, action bar">
        <Row>
          <BrandMark size="sm" />
          <BrandMark />
          <BrandMark size="lg" />
          <BrandMark iconOnly />
        </Row>
        <div className="gallery-mt-3">
          <PageHeader
            brand
            eyebrow="Host"
            title="Pick a map"
            onBack={() => undefined}
            actions={<Button variant="secondary" size="sm">Filter</Button>}
          />
        </div>
        <div className="gallery-mt-3">
          <ActionBar>
            <Button variant="secondary">Back</Button>
            <Button variant="primary">Start race</Button>
          </ActionBar>
        </div>
      </Section>
    </>
  );
};

/** Gallery block for the mobile building blocks, with its own ConfirmProvider. */
export const MobileBlocks: React.FC = () => (
  <ConfirmProvider>
    <Demo />
  </ConfirmProvider>
);
