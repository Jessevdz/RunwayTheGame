# Privacy Policy

Applies to the Runway software and to the public
instance at `https://playrunway.app/`.

## 1. The short version

- No account, no email address, no password, no real name.
- **Nothing is kept longer than 30 days.** Everything about a race is deleted 30 days after that race ends, whether or not you ask.
- Your live position is visible to everyone else in your race, for as long as
  the race is running. It is not kept afterwards.
- No cookies for tracking, no analytics, no advertising, no profiling, nothing
  sold or shared with anyone outside the list below.
- Your photo is only sent to an outside AI service if the host of your race
  chose that grading mode, and you are told which mode is in force before you
  take the picture.

## 2. What we collect, why, and on what legal basis

We collect only what the game mechanically needs. There is no analytics
pipeline, no advertising identifier, and no data collection that exists for our
benefit rather than for the game working.

### 2.1 While you play

| Data | Why | Legal basis (GDPR Art. 6) |
| :--- | :--- | :--- |
| **Your current GPS position** (latitude, longitude, and accuracy, reported repeatedly while a race is live) | To draw you on the map, to check you actually reached a waypoint, and to show the other teams where you are (which is the game) | 6(1)(b): performance of the game you asked to take part in. Access to the device's location sensor itself happens only after you grant the browser permission, which you can withdraw at any time in your device settings |
| **The team name or runner name you typed** | To identify you to the other players and on the race log | 6(1)(b) |
| **The player name you typed when joining** (the one shown beside your squad in the lobby) | So the people you are racing with can see which squad each of you is on before the race starts. It is used in the lobby and nowhere else: the race itself, the standings, the race log and the race report are all identified by squad, never by person | 6(1)(b) |
| **Photos you take as evidence**, plus the position and time they were taken at | To check the challenge was actually completed at the right place | 6(1)(b) |
| **The race's event log** (arrivals, verdicts, coins, vetoes, powerups, cards drawn, disputes and their outcomes) | This is the game state. The race cannot be scored, replayed, or disputed without it | 6(1)(b) |
| **Anti-cheat signals** derived from the above (the speed implied between two position reports, the distance and accuracy at an arrival) | To flag an arrival that could not have happened physically, so a host can arbitrate | 6(1)(f): our legitimate interest, and every honest player's, in a race that is not trivially cheatable |

**We do not build a location history.** The server keeps exactly **one** position
per team (the latest one), and each new report overwrites the previous one.
There is no table of where you have been, and no trail is recorded in the event
log. The only coordinates that persist are the single fix attached to each photo
you submitted.

**Positions are deleted when the race ends**, and in any case within 24 hours of
your last position report. They do not wait for the 30-day sweep.

### 2.2 Other people in your photos

A photo you take outdoors may contain passers-by who never agreed to any of
this. We take that seriously:

- Before every capture, the app asks you not to get other people in the shot.
  Please don't.
- We never run face recognition, face matching, or any other biometric
  processing on a photo. We do not attempt to identify anyone in an image.
- Photos are visible only to the people in your race (the other teams and the
  host), never publicly, and never indexed.
- Photos are deleted with everything else at 30 days.
- Our basis for the incidental appearance of a bystander is 6(1)(f), legitimate
  interest: the processing is necessary to verify the challenge, the impact is
  minimal and short-lived, and the alternative (no evidence at all) removes
  the game. **If you appear in a Runway photo and want it gone, write to the
  contact address above and we will delete it.** You do not have to be a player
  to ask.

A photo can incidentally reveal something sensitive in the meaning of Art. 9
(what someone is wearing, a place of worship in the background, a medical
setting). We never seek such information, never derive it, never index on it,
and delete the image within 30 days. If you are about to photograph something
you would rather not hand over, veto the challenge instead; it costs you the
waypoint and nothing else.

### 2.3 How your photo is graded

Every race is fixed at creation to one of three grading modes, and the app tells
you which one is in force.

| Mode | Who looks at your photo | Does it leave this instance? |
| :--- | :--- | :--- |
| `trust` | Nobody. The GPS check alone decides | **No** |
| `host` | A person (the host of your race, in their console) | **No** |
| `llm` | A multimodal AI model, via the provider in §4 | **Yes**, to that provider |

In `llm` mode the photo and the challenge's written criteria are sent to the
provider named in §4, which returns a pass or fail and a short reason. The
provider is instructed to use the image only to answer that question.

**This is not automated decision-making in the sense of Art. 22.** Losing a
waypoint in a game has no legal or similarly significant effect on you. Even
so, a human can always overturn it: you can dispute any verdict, and the host
can override any verdict from their tools.

An instance can be run with no AI grading at all, and with no AI provider
configured. Ask your host which mode they picked; the app will tell you anyway.

### 2.4 Things that are not about a race

| Data | Why | Legal basis |
| :--- | :--- | :--- |
| **Maps you design** (waypoint names, coordinates, challenge text) | So the board can be played | 6(1)(b). We store **no author identity with a board**: there is no user account, and nothing in the database says who made a map. A board is kept indefinitely, because a game with no maps is not a game. **Please do not put a waypoint on your own front door**: a map is playable content, and a listed one is visible to strangers |
| **Roadmap posts and votes** (the title and description you write, and a vote) | To run the public feature board | 6(1)(b) |
| **An anti-abuse fingerprint** on a roadmap vote or flag (a keyed HMAC of your IP address and browser user-agent) | So that "three people flagged this" means three people rather than three clicks. It is a one-way hash keyed with a secret; your IP address cannot be recovered from it, and it is not stored in the clear | 6(1)(f) |
| **Bug reports you file** (what you type, plus the page you were on, your browser and screen size, the app build, and the last few JavaScript errors your browser recorded) | So a playtester can report a fault without leaving the game, and so it can be reproduced and fixed. The button only appears on a browser marked as a playtester's. **No screenshot is taken, no photo is attached, and no location is sent.** Capability tokens are stripped from captured errors before they leave your device, and the report is visible to the operator only — never to other players | 6(1)(f): legitimate interest in fixing an alpha, and 6(1)(a) for the text you choose to write |
| **Server logs** (request paths, status codes, timings, and the connecting IP address) | To keep the service up and to investigate abuse | 6(1)(f) |
| **Optional editor telemetry** (disabled by default; active only if operator sets `RUNWAY_ANALYTICS=1`): allowlisted UI action names and closed property enums | To improve the usability of the board designer and map tools. Uses an ephemeral in-memory session UUID that is never written to cookies, `localStorage`, or `IndexedDB`. Records zero personal data, zero coordinates, zero board IDs, and zero race data | 6(1)(f): legitimate interest in software usability, strictly minimized under Art. 5(1)(c) and ePrivacy Art. 5(3) |
| **Local storage in your browser** (your session tokens for the race you joined, your chosen theme, a random id for your own roadmap votes) | These are strictly necessary to do the thing you asked for: without a session token you are logged out of your own race on every refresh. **We set no cookies and use no tracking or advertising storage of any kind**, which is why this site shows you no cookie banner | Strictly necessary under Art. 5(3) ePrivacy (no consent required, and none is faked) |

### 2.5 The solo leaderboard

Posting a solo time to a board's leaderboard is **opt-in**. Nothing is published
unless you press the button, and the run is complete and scored either way.

If you do post: your runner name, your time, your veto count, and how the run
was graded become publicly visible on that board. **Use a nickname.** The leaderboard is a rolling 30-day board (entries older than 30 days drop off with
everything else), and you can ask us to remove yours sooner at any time. Legal
basis: 6(1)(a), your consent, which you may withdraw.

### 2.6 What we never do

- We do not sell, rent, or trade your data.
- We do not profile you, score you, or build a behavioural model of you.
- We do not track you across other websites or apps.
- We do not use your photos to train any AI model, and the provider in §4 is
  contracted not to train on submitted content.
- We do not ask for, or want, your real name, address, phone number, email
  address, or payment details. If you type any of those into a team name, a
  roadmap post, or a bug report, that is you choosing to hand them over. Please
  don't.

## 3. How long we keep it

**Nothing about a race survives 30 days.**

| Data | Deleted |
| :--- | :--- |
| Live positions | When the race ends; at the latest 24 hours after the last report |
| Evidence photos, and the coordinates attached to them | 30 days after the race ends |
| The race's event log, team names, player names, coins, standings | 30 days after the race ends |
| A race that was created but never started or never finished | 30 days after it was created |
| Solo leaderboard entries | 30 days after the run |
| Roadmap anti-abuse fingerprints | 30 days |
| Bug reports | 90 days after they are filed |
| Server logs | 7 days |
| Database backups | 30 days, on a rolling window |
| Maps and boards (no personal data, no author recorded) | Kept (see §2.4) |

If you ask us to delete something sooner, we do it and it does not wait for the
sweep.

## 4. Your rights

Under the GDPR you have the right to **access** your data, to have it
**corrected**, to have it **erased**, to **restrict** or **object to** its
processing, to receive it in a **portable** format, and (where we rely on your
consent) to **withdraw that consent** at any time without affecting what was
lawful before.

## 5. Security

- All traffic is over HTTPS. The browser will not grant camera or location
  access otherwise, so there is no insecure mode to fall back to.
- Race capabilities are bearer tokens. The host token is stored only as a
  SHA-256 hash (the plaintext is shown once, to whoever created the race).
- The live position feed is authenticated per race and per capability. There is
  no spectator mode and no anonymous door onto it: a race is raced or run, never
  watched by strangers.
- Photos are served through short-lived presigned URLs, not from a public
  bucket.
- Anti-abuse fingerprints are keyed HMACs, not recoverable IP addresses.

No system is perfect. If you find a vulnerability, please report it privately
(see [`SECURITY.md`](SECURITY.md)). If a breach affects your rights and freedoms,
we will notify the supervisory authority within 72 hours and tell affected
players directly where the risk is high.

## 6. Alpha status, and changes to this policy

Runway is an alpha. Rules, formats, and databases change, and **data may be
wiped between releases** (which is a deletion, never a retention).

If we change this policy we will update the date at the top and note the change
in the repository's history, which is public. If a change materially affects how
your data is handled, we will surface it in the app before your next race rather
than relying on you re-reading this page.
