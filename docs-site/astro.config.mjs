// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  // Set `site` to the real origin before deploying — it only affects the
  // sitemap and canonical URLs.
  site: 'https://example.invalid',
  // The docs ship inside the frontend's nginx image and are served from the same
  // origin as the app, under /docs/. Same origin means the landing page links to
  // them with a plain relative href and no CORS is involved.
  //
  // Links in page content are RELATIVE for this reason: Astro rewrites asset and
  // sidebar URLs for `base` automatically, but not arbitrary link strings in
  // frontmatter or markdown body. Relative links survive a change of base.
  base: '/docs',
  integrations: [
    starlight({
      title: 'Runway',
      description:
        'A real-world, location-based racing game. Teams walk a board of real places, clear challenges with photo evidence, and race to the finish.',
      tagline: 'Race the real world.',
      customCss: ['./src/styles/departure.css'],
      components: {
        // The header wordmark links back to the app's landing page; see the
        // note in the component for why that is a bare `/`.
        SiteTitle: './src/components/SiteTitle.astro',
      },
      // The four Departure voices: Announce, Narrate, UI, Data. See DESIGN.md.
      head: [
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://fonts.gstatic.com',
            crossorigin: true,
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Playfair+Display:ital@0;1&display=swap',
          },
        },
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Jessevdz/RunwayTheGame',
        },
      ],
      // No splash page: /docs/ is the first documentation page itself, so the
      // sidebar is in view on arrival and doubles as the index of what exists.
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'What is Runway?', slug: '' },
            { label: 'Design a board', slug: 'design-a-board' },
            { label: 'Set up a race', slug: 'set-up-a-race' },
            { label: 'Run your own instance', slug: 'run-it-locally' },
          ],
        },
      ],
      // The generator credit is on by default; keep or drop as you like.
      credits: false,
    }),
    react(),
  ],
});
