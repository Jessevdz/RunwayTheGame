<!--
Thanks for contributing. Keep this short, the diff already says what changed, so spend the words on why.
New here? CONTRIBUTING.md covers setup, the test commands, and the architectural rules that are easy to break by accident.
-->

## What and why

<!-- What problem does this solve? Why this approach over the alternatives? -->

Fixes #

## How it was tested

<!--
For anything touching GPS, the camera, or offline sync, say whether you tested on a real device.
-->

- [ ] `RUNWAY_REQUIRE_DB=1 go test -count=1 ./cmd/... ./internal/...`
- [ ] `cd frontend && npm run lint && npm run build`
- [ ] Tested by hand, describe:

## Checklist

- [ ] One concern per PR
- [ ] Commit messages are real messages
- [ ] No secrets, tokens, `.env` files, real coordinates, or identifiable faces
      anywhere in the diff or its history
- [ ] Backend logic changes come with tests
- [ ] Tests get their database from `testsupport.DB(t, "<pkg>")`

## If this touches any of these, say so

<!-- Leave unchecked if not applicable. -->

- [ ] Event types
- [ ] Scoring or capture rules
- [ ] Location or photo data
- [ ] Database schema
- [ ] LLM cost

## UI changes

<!-- Delete this section if the PR has no UI. -->

- [ ] Conforms to [DESIGN.md](../DESIGN.md).
- [ ] Built from `@ds` primitives; no hardcoded colours, px values, or fonts
- [ ] Screenshots below, in both light and dark mode
- [ ] Checked at mobile width — the player console is used one-handed, outdoors

| Light | Dark |
| :--- | :--- |
|  |  |
