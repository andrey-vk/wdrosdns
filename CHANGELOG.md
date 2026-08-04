# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.3] - 2026-08-05

### Fixed

- Options page: the settings menu (`Global RouterOS settings` / `Network collector` /
  `Profiles`) is back on the left, matching the original layout — it had been moved to the
  right by mistake in 0.6.2. Also fixed the menu rendering a few pixels lower than the main
  panel, caused by a sticky offset that exceeded the actual header height.

### Changed

- CI: bumped `actions/checkout` (v4 → v7), `actions/setup-node` (v4 → v7, targeting Node
  24), and `softprops/action-gh-release` (v2 → v3) to resolve a Node 20 deprecation warning
  in GitHub Actions runs.

## [0.6.2] - 2026-08-04

### Added

- Russian translations of the documentation (`README.ru.md`, `PRIVACY.ru.md`), with
  language-switch links from the English versions.
- Badges (license, latest release, lint status, manifest version) on both README variants.
- `CHANGELOG.md`, linked from both README variants.

### Changed

- Options page navigation: a right-side panel now groups `Global RouterOS settings`,
  `Network collector`, and `Profiles`, showing a single active section instead of stacked
  cards with anchor-scroll tabs.

## [0.6.1] - 2026-08-04

### Added

- First public GitHub release: MIT license, privacy policy (`PRIVACY.md`), a `Permissions`
  section in the README justifying every requested manifest permission, placeholder
  extension icons, and GitHub Actions CI (ESLint + manifest/locale validation on every
  push, packaged `.zip` attached to tagged GitHub Releases).
- `:resolve` now uses captured exact hosts from the current tab: when the effective DNS
  record has `match-subdomain` enabled, every captured host equal to or a subdomain of the
  added domain is resolved, not just the added domain itself.

[Unreleased]: https://github.com/andrey-vk/wdrosdns/compare/v0.6.3...HEAD
[0.6.3]: https://github.com/andrey-vk/wdrosdns/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/andrey-vk/wdrosdns/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/andrey-vk/wdrosdns/releases/tag/v0.6.1
