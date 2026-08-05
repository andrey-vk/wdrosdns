# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-08-05

### Fixed

- **Adding a domain twice no longer creates duplicate static DNS entries.** RouterOS `PUT`
  always creates a new object, so repeat adds accumulated duplicates. The extension now reads
  the static DNS list once per batch and creates, updates (`PATCH`) or skips each domain
  accordingly. Every add reports which of the three happened, and duplicates already present
  on the router are counted in the result.
- **Popup selection no longer resets.** Rows were rebuilt with `selected: true` on every
  render, so "select none", searching, changing filters and switching Domain/Host mode all
  silently re-selected everything. Selection now lives in a set outside the rendered rows:
  a domain seen for the first time starts selected, and deselecting it sticks. Switching
  between Domain and Host mode still clears the selection, because the names change.
- **Captured requests survive service-worker suspension.** Manifest V3 terminates idle
  service workers, which discarded everything the collector had captured. State is now
  mirrored into `chrome.storage.session` in batched writes and restored when the worker
  restarts.
- **The popup can no longer show one profile's settings while using another's.** When router
  detection lands on a different profile (same address and credentials, different identity),
  the selected profile, the profile list and the record chips now follow it.
- **Base-domain detection uses the Public Suffix List.** The previous 18-entry hard-coded
  list mis-handled most multi-part suffixes — including reducing a host to a bare public
  suffix such as `co.uk`, which combined with `match-subdomain` was a real hazard. The full
  list is bundled as static data; nothing is fetched at runtime.
- Passwords are masked in the "router response" view and status tooltips, which previously
  rendered whole profile objects verbatim.

### Added

- Domain input validation: full URLs are reduced to their host, IDN names are punycoded, and
  whitespace, paths, non-HTTP schemes, malformed labels and bad wildcards are rejected with
  an explicit report instead of being passed to RouterOS.
- A test suite (`npm test`, Node's built-in runner, no new dependencies) covering domain
  parsing, public-suffix handling, collector filters, selection behaviour, profile
  inheritance, router detection and duplicate-record handling.
- Release validation: git tag, `manifest.json` and `package.json` versions must agree, the
  package file list is derived from the manifest's own reference graph, and the produced ZIP
  is unpacked and validated instead of only the source tree. Locale files are checked for
  key parity.
- `npm run update:psl` regenerates the bundled Public Suffix List.

### Changed

- Profile overrides store `null` for fields left equal to the global value, so later changes
  to the global settings keep propagating into profiles instead of being frozen at the value
  captured when the override was saved.
- The collector stores only the fields it uses — host, method, type, timing, status and error.
  Full request URLs, and therefore query strings, are no longer retained.
- The service worker caches settings and refreshes them via `chrome.storage.onChanged`,
  instead of reading storage once per captured request.
- The DevTools panel aggregates by host with the same configurable per-tab limit as the popup
  collector, so a long session no longer grows without bound.
- `match-subdomain` is always written explicitly (`yes`/`no`) so an existing record cannot
  look equivalent to a request that asked for the opposite.

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
