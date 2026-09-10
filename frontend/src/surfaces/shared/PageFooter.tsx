import React from 'react';
import { BrandLines, LinkButton, IconBook, IconGithub } from '@ds';
import { CONTACT_EMAIL, contactMailto, docsUrl, GITHUB_URL } from '../../core/docs';

/** Closing rule for the document-scroll surfaces (landing, gallery, roadmap). */
export const PageFooter: React.FC = () => {
  return (
    <footer
      style={{
        maxWidth: 'var(--wrap-content)',
        margin: '0 auto',
        padding: 'var(--sp-6) 0',
        borderTop: '0.0625rem solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--sp-4)',
        flexWrap: 'wrap'
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <BrandLines size={20} />
          <span className="t-narrate fs-6" style={{ fontStyle: 'italic', color: 'var(--ink-muted)' }}>
            Race the globe.
          </span>
        </div>
        <a
          className="t-data fs-2"
          href={contactMailto('Runway')}
          style={{ color: 'var(--ink-muted)' }}
        >
          {CONTACT_EMAIL}
        </a>
      </div>

      {/* Plain anchors, not router pushes: the docs are a separate static site
          and the SPA router knows no such route. */}
      <nav
        aria-label="Documentation"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <LinkButton href={docsUrl()} icon={<IconBook />} variant="ghost" size="sm">
            Docs
          </LinkButton>
          <LinkButton href={GITHUB_URL} external icon={<IconGithub />} variant="ghost" size="sm">
            GitHub
          </LinkButton>
        </div>
      </nav>
    </footer>
  );
};


