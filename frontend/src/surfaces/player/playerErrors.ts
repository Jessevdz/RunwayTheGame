/** The player actions that can fail, each with its own fallback wording. */
export type PlayerAction = 'start' | 'arrive' | 'veto' | 'end' | 'photo';

/** Shown instead of sending a command that needs a position when the phone has none. */
export const NO_FIX_MESSAGE = "We can't see where you are yet. Step into the open and wait for the GPS chip to settle, then try again.";

const FALLBACK: Record<PlayerAction, string> = {
  start: "Couldn't start the challenge. Try again.",
  arrive: "Couldn't record your arrival. Try again.",
  veto: "Couldn't skip that challenge. Try again.",
  end: "Couldn't end the run. Try again.",
  photo: 'Upload failed. Check your signal and try again.'
};

interface ErrorLike {
  status?: unknown;
  message?: unknown;
  name?: unknown;
}

const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /you are (\d+) m from the waypoint .*get within (\d+) m/i,
    (m) => `You're still about ${m[1]} m out. Get within ${m[2]} m and try again.`
  ],
  [
    /accuracy .*(too poor|exceeds the waypoint radius)/i,
    () => "Your GPS isn't accurate enough yet. Step into the open and wait a few seconds."
  ],
  [
    /implausible|stay where you are/i,
    () => 'That jump looked too fast for walking. Stay put for a few seconds and try again.'
  ],
  [/not a valid coordinate|not a valid measurement/i, () => 'Your GPS gave an odd reading. Wait a moment and try again.'],
  [/team is frozen/i, () => 'Your team is frozen. Wait for the freeze to wear off.'],
  [/veto cooldown/i, () => 'Challenges are locked while your skip cooldown runs.'],
  [/must be at (the waypoint|an endpoint)/i, () => 'Get to the waypoint first, then try again.'],
  [/must be cleared before moving/i, () => "Clear this waypoint's challenge before you head on."],
  [/no road connects/i, () => "That waypoint isn't connected to where you are."],
  [/still being reviewed/i, () => 'Your last photo is still being checked. Hang tight.'],
  [/already been used/i, () => 'That photo was already sent.'],
  [/game is not live|game has already ended|no longer accepting|being deleted/i, () => "This race isn't running right now."],
  [/finish line carries no challenge/i, () => 'The finish has no challenge. Just arrive.'],
  [/lat and lon are required|lat\/lon must be/i, () => NO_FIX_MESSAGE]
];

/** Tells a dropped connection from a server answer, which matters because nothing was sent in the first case. */
const isNetworkFailure = (err: ErrorLike, message: string): boolean =>
  typeof err.status !== 'number' &&
  (err.name === 'TypeError' || /failed to fetch|networkerror|load failed|network request failed|aborted/i.test(message));

/** Turns any thrown value into one plain sentence a player can act on, never raw server text. */
export function playerErrorMessage(err: unknown, action: PlayerAction): string {
  const like: ErrorLike = typeof err === 'object' && err !== null ? (err as ErrorLike) : {};
  const message = typeof like.message === 'string' ? like.message : typeof err === 'string' ? err : '';

  if (isNetworkFailure(like, message)) {
    return "No signal, so nothing was sent. Try again when you're back online.";
  }

  for (const [pattern, say] of PATTERNS) {
    const match = message.match(pattern);
    if (match) return say(match);
  }

  const status = typeof like.status === 'number' ? like.status : 0;
  if (status === 429) return 'Too many taps. Wait a moment and try again.';
  if (status === 401) return "The race didn't recognise this phone. Reload the page and try again.";
  if (status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  return FALLBACK[action];
}
