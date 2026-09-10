/** Head metadata for one surface. */
export interface DocumentMeta {
  title: string;
  description: string;
  /** False for session and device-local surfaces, which carry a `noindex`. */
  indexable: boolean;
}

const SUFFIX = 'Runway';

/** Composes a tab title in the same shape the Starlight docs use. */
const title = (page: string | null): string =>
  page ? `${page} | ${SUFFIX}` : 'Runway — race the real world';

const LANDING: DocumentMeta = {
  title: title(null),
  description:
    'Design a racing board over real places, then race friends between waypoints, clearing photo challenges along the way.',
  indexable: true,
};

const GALLERY: DocumentMeta = {
  title: title('Gallery'),
  description:
    'Browse public Runway boards built over real places, and fork any of them into a race of your own.',
  indexable: true,
};

const ROADMAP: DocumentMeta = {
  title: title('Roadmap'),
  description: 'What is being built next in Runway, and what has already shipped.',
  indexable: true,
};

/* Everything below is thin app UI or a live session: worth a real tab title, never worth indexing. */
const DESIGN: DocumentMeta = {
  title: title('Design a board'),
  description: 'Draw waypoints and roads over a real map to build a Runway board.',
  indexable: false,
};

const HOST: DocumentMeta = {
  title: title('Host a race'),
  description: 'Open a race on one of your boards and invite teams to join.',
  indexable: false,
};

const SOLO: DocumentMeta = {
  title: title('Solo run'),
  description: 'Run a Runway board on your own, against the clock.',
  indexable: false,
};

const RACES: DocumentMeta = {
  title: title('My races'),
  description: 'Races this device has hosted or joined.',
  indexable: false,
};

const LOBBY: DocumentMeta = {
  title: title('Race lobby'),
  description: 'Pick a team and wait for the host to start the race.',
  indexable: false,
};

const RACE: DocumentMeta = {
  title: title('Live race'),
  description: 'A race in progress.',
  indexable: false,
};

const REPORT: DocumentMeta = {
  title: title('Race report'),
  description: 'How a finished race played out, leg by leg.',
  indexable: false,
};

const ADMIN: DocumentMeta = {
  title: title('Admin'),
  description: 'Operator console.',
  indexable: false,
};

const NOT_FOUND: DocumentMeta = {
  title: title('Not found'),
  description: 'No such page.',
  indexable: false,
};

/**
 * Maps a pathname to its head metadata, mirroring `surfaceFor` in the analytics hook.
 */
export function metaFor(pathname: string): DocumentMeta {
  const path = pathname.replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const [first, , third] = segments;

  if (path === '/') return LANDING;

  switch (first) {
    case 'gallery':
      return GALLERY;
    // Handle the admin subroute under roadmap.
    case 'roadmap':
      return segments[1] === 'admin' ? ADMIN : ROADMAP;
    case 'admin':
      return ADMIN;
    case 'design':
      return DESIGN;
    case 'races':
      return RACES;
    case 'host':
      return segments.length === 1 ? HOST : LOBBY;
    case 'join':
      return LOBBY;
    case 'solo':
      return SOLO;
    case 'race':
      return third === 'report' ? REPORT : RACE;
    case 'play':
      return LOBBY;
    default:
      return NOT_FOUND;
  }
}
