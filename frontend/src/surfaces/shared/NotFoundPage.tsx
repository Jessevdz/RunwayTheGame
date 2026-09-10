import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from './PageShell';
import { PageFooter } from './PageFooter';
import { Button, BrandLines } from '@ds';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <PageShell
      navPlacement="topbar"
      topBarProps={{
        title: (
          <div className="landing-brand">
            <BrandLines size={24} />
            <span className="t-announce fs-7 landing-brand__text">RUNWAY</span>
          </div>
        ),
      }}
    >
      <section className="notfound">
        <p className="t-label fs-label">ERROR 404</p>
        <h1 className="t-announce fs-d-md notfound__title">NO SUCH GATE</h1>
        <p className="t-narrate fs-6 notfound__body">
          This link doesn&rsquo;t lead anywhere. A race that has already been packed
          up lands here too &mdash; ask your host for a fresh invite.
        </p>
        <div className="notfound__ctas">
          <Button variant="primary" onClick={() => navigate('/')}>
            Back to the start
          </Button>
          <Button variant="ghost" onClick={() => navigate('/gallery')}>
            Browse the gallery
          </Button>
        </div>
      </section>

      <PageFooter />
    </PageShell>
  );
};
