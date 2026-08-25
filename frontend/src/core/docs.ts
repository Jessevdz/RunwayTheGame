/** Base URL for the documentation site. */
const DOCS_BASE_URL: string =
  import.meta.env.VITE_DOCS_BASE_URL || '/docs/';

/** `docsUrl('what-is-runway/')` → the docs page, wherever the docs are served. */
export const docsUrl = (path = ''): string => `${DOCS_BASE_URL}${path}`;

/** Main GitHub project repository URL. */
export const GITHUB_URL = 'https://github.com/Jessevdz/RunwayTheGame';
export const githubUrl = (): string => GITHUB_URL;
