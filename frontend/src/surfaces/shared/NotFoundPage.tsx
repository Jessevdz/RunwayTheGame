import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from './PageShell';
import { PageFooter } from './PageFooter';
import { Button } from '@ds';
import './not-found.css';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <PageShell navPlacement="topbar">
      <section className="notfound">
        <p className="t-label fs-label">ERROR 404</p>
        <h1 className="t-announce fs-d-md notfound__title">NO SUCH GATE</h1>
        <p className="t-narrate fs-6 notfound__body">
          This link goes nowhere. If a race was deleted, ask your host for a new invite.
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
