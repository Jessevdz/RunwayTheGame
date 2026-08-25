# Security Policy

## Supported versions

Runway is in **alpha**. Only the current `master` branch is supported. There are
no maintained release branches and no backported fixes.


## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting:

> **[Security → Advisories → Report a vulnerability](https://github.com/Jessevdz/RunwayTheGame/security/advisories/new)**

This creates a private advisory visible only to you and the maintainers. It needs
no email address and keeps the report out of public view until there is a fix.

If you would rather not use GitHub, or you do not have an account, email
**[hello@playrunway.app](mailto:hello@playrunway.app)** instead. Put `SECURITY`
in the subject line.

### What to include

- What the issue is and roughly how bad you think it is
- Steps to reproduce, or a proof of concept
- The affected component (`internal/api`, the verification worker, the frontend,
  the deployment story, …) and the commit or version you tested
- Anything you know about who is exposed: a self-hosted instance operator, a
  player, a host, or a bystander

## What we consider in scope

This project handles categories of data that make some ordinary-looking bugs
serious. Reports in these areas are especially welcome:

- **Location data exposure.** Anything that lets a party read a team's live or
  historical GPS position when they should not — for example a flaw in the
  capability checks in `internal/api/auth.go`, or a websocket subscription that
  is authorised too broadly. The realtime feed carries every team's position.
- **Evidence photo exposure.** Unauthorised access to capture photos, presigned
  URL weaknesses, or anything that lets a blob reference reach outside its
  intended object.
- **SSRF and request forgery** in the verification worker or the blob store — the
  worker fetches URLs and calls a third-party API with a credential.
- **Authentication and capability bypass**: forging host or team capabilities,
  escalating from player to host, tampering with verdicts, or reaching the
  worker verdict route without `RUNWAY_WORKER_TOKEN`.
- **Event log integrity**: anything that lets a client write events it should not,
  or corrupt the ordering guarantees the game state depends on.
- **Cost abuse**: anything that lets an unauthenticated or low-privilege party
  drive unbounded LLM calls on an operator's key.
- **Secrets in the repository or in build output.**

## Out of scope

- Findings that require the attacker to already be an authorised host of the
  game in question. A host can already override verdicts by design.
- Cheating within the game's own rules — spoofing a photo, gaming a challenge, or
  beating the anti-spoof heuristics. That is a gameplay bug: open a normal issue.
  Reliably defeating the heuristics *in a way that generalises* is interesting;
  please still report it as a normal issue, not an advisory.
- Missing hardening headers, rate limits, or TLS configuration on somebody's
  self-hosted deployment. Deployment configuration is the operator's
  responsibility.
- Automated scanner output with no demonstrated impact.