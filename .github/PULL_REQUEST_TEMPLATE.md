<!--
Thanks for sending a PR! Before you submit:
- Fork → branch → PR. We do not accept PRs from `main` directly.
- Make sure `npm run type-check` and `npm run lint` are clean.
- One concern per PR. Split refactors from feature work when possible.
-->

## Summary

<!-- 1–3 sentences: what changes, what user pain it addresses. -->

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation only
- [ ] Refactor / chore (no user-visible change)

## Related issues / discussions

<!-- "Closes #123", "Refs #456", or links to Discussions threads. -->

## Screenshots / video

<!-- For UI changes, include before/after screenshots or a 5-second screen recording. -->

## Test plan

- [ ] `npm run type-check` is green
- [ ] `npm run lint` is green
- [ ] `npm run test:unit` is green (if relevant)
- [ ] Tested manually in `npm run dev`

## Checklist

- [ ] My code follows the [contributing guidelines](https://github.com/InspectorHub/OpenInspection/blob/main/CONTRIBUTING.md)
- [ ] I have read and agreed to the [Code of Conduct](https://github.com/InspectorHub/OpenInspection/blob/main/CODE_OF_CONDUCT.md)
- [ ] I have added tests that prove my fix is effective or that my feature works (or explained why tests are not feasible)
- [ ] I have updated the documentation in `docs/` where relevant
- [ ] I have added entries to `CHANGELOG.md` if this PR is user-visible
- [ ] My commits include `Co-Authored-By:` lines for any AI assistants used

<!-- Maintainer note: a PR may be merged once CI is green, with a normal merge
     commit. Do NOT squash: a squash rewrites the branch's commits into a new
     one, so `git merge-base --is-ancestor` and `git cherry` both go on calling
     the landed work unmerged, and the branch looks safe to delete when it is
     not. PRs touching billing or auth always need a human reviewer. -->
