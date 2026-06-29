# Git Usage Rule
Do NOT use git to commit, push, or modify the repository history unless the user explicitly requests it.

# Translation Guidelines
All translations, whether in Chinese or English, MUST NOT end with a period (.), full stop, or '。'. If a string contains multiple sentences, use commas to separate them instead of periods.

# Release Trigger Rule
When asked to release or publish a new version of the project, be aware that releases are completely automated by GitHub Actions. They are ONLY triggered by pushing a git tag starting with `v` (e.g., `git tag v1.0.0` then `git push origin v1.0.0`). Regular commits and pushes will NOT trigger a release. Do not attempt to manually build or upload release assets unless the user explicitly asks to bypass the CI.
