/** Base URL for the documentation site. */
const DOCS_BASE_URL: string =
  import.meta.env.VITE_DOCS_BASE_URL || '/docs/';

/** `docsUrl('what-is-runway/')` → the docs page, wherever the docs are served. */
export const docsUrl = (path = ''): string => `${DOCS_BASE_URL}${path}`;

/** Public contact address for support, privacy requests, and takedowns. */
export const CONTACT_EMAIL = 'hello@playrunway.app';

/** `mailto:` href for the contact address, optionally with a prefilled subject. */
export const contactMailto = (subject?: string): string =>
  subject ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}` : `mailto:${CONTACT_EMAIL}`;

/** Main GitHub project repository URL. */
export const GITHUB_URL = 'https://github.com/Jessevdz/RunwayTheGame';
export const githubUrl = (): string => GITHUB_URL;
