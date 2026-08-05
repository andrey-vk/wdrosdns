# MikroTik DNS Helper v0.7.0

[![License: MIT](https://img.shields.io/github/license/andrey-vk/wdrosdns)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/andrey-vk/wdrosdns)](https://github.com/andrey-vk/wdrosdns/releases/latest)
[![Lint](https://img.shields.io/github/actions/workflow/status/andrey-vk/wdrosdns/lint.yml?branch=main&label=lint)](https://github.com/andrey-vk/wdrosdns/actions/workflows/lint.yml)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-blue)](manifest.json)

🇷🇺 [Русская версия](README.ru.md) · [Changelog](CHANGELOG.md)

Edge/Chrome MV3 extension for adding current page domains and Network request domains to MikroTik RouterOS static DNS through the RouterOS REST API.

## Main features

### Popup

- App bar with a connection dot: the router is probed automatically when the popup opens.
- Profile picker (auto-detect plus every saved profile) behind the app bar caret.
- Domain field with a `Domain / Host` segmented switch that rewrites the value in place.
- A chip row showing exactly what will be created — record type and target, `match-subdomain`,
  `address-list`, `:resolve` server — and opening the settings page on click.
- Additional domains stay under a details block.
- Network domain collector:
  - collects requests by current `tabId`;
  - groups domains by host/base-host with HTTP status and error badges;
  - search field, filter popover (`show all` included), select all/none, selection counter;
  - one primary action (add selected) with `add shown` / `add all captured` in its menu.
- Result block: one line per domain with add and `:resolve` outcome, plus the raw router
  response behind a details toggle.

### Options page

A right-side panel groups `Global RouterOS settings`, `Network collector`, and the `Profiles`
list; clicking any of them shows just that section in the main area.

- Record fields follow the record type: `A` shows `address`, `FWD` shows `forward-to`.
- Profile overrides mark every field that differs from the global value and offer a one-click
  reset back to it.
- Password field has a show/hide toggle.
- A sticky save bar holds both save buttons, the status line, and an unsaved-changes marker.

### DevTools panel

Same visual system as the popup: single toolbar, `Domain / Host` switch, search, selection
counter, and the shared result block. All strings go through `_locales`.

Every surface follows the browser/system light/dark theme through CSS `prefers-color-scheme`.

### Profiles

- Multiple RouterOS profiles.
- Last successfully used profile is tried first.
- Identity can be fetched from `/rest/system/identity` or entered manually.
- Profile copy support.
- Per-profile overrides:
  - DNS record type: `FWD` / `A`
  - `address`
  - `forward-to`
  - `address-list`
  - `comment`
  - `match-subdomain`
  - default base-domain trimming
  - `:resolve` after adding
  - `:resolve` server (default `127.0.0.1`)
  - request timeout

### Router detection

Detection order:

1. Try the last successfully used profile.
2. If the IP is unreachable, timeout, or connection is refused, continue with saved profiles using the same IP.
3. If no profile on that IP works, continue with profiles using other IP addresses.
4. If connection succeeds but authorization fails, try other saved profiles with the same IP.
5. If authorization succeeds, request `/rest/system/identity`.
6. If identity matches the profile, use that profile.
7. If identity differs:
   - search for another saved profile with the same URL/login/password and detected identity;
   - if found, switch to that profile;
   - if not found, offer to create a new profile with fields prefilled;
   - also offer to update identity in the matched profile, with explicit confirmation.
8. If no saved IP/login/password combination works, report that no saved router was detected.

### Network collector

Uses `chrome.webRequest`.

Default filters:

Enabled:

- HTTP 4xx
- HTTP 5xx
- `ERR_CONNECTION_REFUSED`
- pending request without response headers longer than 5000 ms

Disabled:

- HTTP 2xx
- HTTP 3xx

The filter list is editable in Options. The popup uses those values as defaults, but the user can enable/disable filters dynamically in the popup without changing saved defaults.

`pending without data` means no response headers were observed through `webRequest`. Browser extensions cannot inspect raw socket payloads.

### i18n

Added extension localization structure:

```text
_locales/en/messages.json
_locales/ru/messages.json
```

The browser chooses the language automatically. New translations can be added by creating another `_locales/<locale>/messages.json`.


## Base domain detection

The `Domain` / `Host` toggle decides whether a captured host is reduced to its registrable
domain before being added. The reduction uses a bundled copy of the
[Public Suffix List](https://publicsuffix.org/), so `a.b.example.co.uk` becomes
`example.co.uk` rather than `co.uk`, and private suffixes such as `github.io` are handled
too. IP literals, `localhost` and hosts that are themselves a public suffix are left alone.

The list is static data in `public-suffix-list.js` — nothing is fetched at runtime. Refresh
it with `npm run update:psl`.

`Host` mode adds the exact host name and is the safer choice when the record has
`match-subdomain` enabled.

## Resolve behavior with match-subdomain

Since v0.6.1, `:resolve` uses captured exact hosts from the current tab.

If the effective DNS record has `match-subdomain` enabled, the extension resolves:

- the added domain itself;
- every captured host from the current tab that equals the added domain;
- every captured host from the current tab that ends with `.` + added domain.

Example:

Added domain:

```text
example.com
```

Captured hosts:

```text
example.com
api.example.com
cdn.static.example.com
other.net
```

RouterOS will receive `:resolve` for:

```text
example.com
api.example.com
cdn.static.example.com
```

If `match-subdomain` is disabled, only the explicitly added domains are resolved.

## RouterOS requirements

RouterOS REST API must be enabled through `www` or `www-ssl`.

Recommended minimal setup:

```routeros
/ip service enable www-ssl
/ip service set www-ssl address=192.168.0.0/16
/ip dns set allow-remote-requests=yes
```

Use a dedicated RouterOS user.

## Browser limitations

The extension cannot read Windows default gateway, SSID, or network profile name directly. It can only try saved RouterOS URLs and identify routers by `/rest/system/identity`.

The extension also cannot send UDP DNS queries directly. It triggers DNS resolving through RouterOS REST:

```routeros
:resolve "example.com" server=127.0.0.1
```

`server=` is required: without it RouterOS resolves through its own client resolver and the
static DNS entry (and its `address-list`) is never populated. The server is configurable
globally and per profile; it defaults to `127.0.0.1`, i.e. the router's own DNS server.

If using HTTPS with a self-signed RouterOS certificate, the browser may block `fetch`. Use a trusted certificate, accept the certificate manually in the browser if possible, or use HTTP only in a trusted LAN.

## Permissions

Manifest permissions and why each is requested:

- `activeTab` / `tabs` — read the URL and host of the current tab so the popup and devtools
  panel can prefill the domain to add, and so the network collector can group captured
  requests by the tab that made them.
- `webRequest` — observe outgoing request URLs, hosts, and status codes for the network
  collector. The extension only reads request metadata; it never reads or modifies request
  or response bodies.
- `storage` — save RouterOS profiles (URL, login, password, per-profile DNS defaults) and
  extension settings on this device via `chrome.storage.local`, and keep captured request
  metadata in `chrome.storage.session` so it survives the service worker being suspended.
  Nothing is synchronised through the browser account, and passwords are stored unencrypted
  — see [PRIVACY.md](PRIVACY.md).
- Host permissions (`http://*/*`, `https://*/*`, `ws://*/*`, `wss://*/*`) — the extension
  talks directly to whatever RouterOS device the user configures, which can be any LAN or
  WAN address, so the permission cannot be narrowed to a fixed origin. These permissions are
  also required for `webRequest` to observe requests on the pages the user browses.

No data leaves the browser except the calls the extension makes directly to the RouterOS
REST API endpoint(s) the user configures. See [PRIVACY.md](PRIVACY.md) for details.

## Adding a domain twice

Adds are idempotent. Before writing, the extension reads the router's static DNS list once
per batch and then, per domain:

- creates the record if no entry with that name exists;
- updates the existing entry (`PATCH`) if one exists but differs;
- does nothing if an equivalent entry is already there.

The result view says which of the three happened for each domain, and reports how many extra
records with the same name the router already holds — for example duplicates left behind by
earlier versions. Those are reported, not deleted; remove them yourself if you want to.

## Development

```bash
npm ci
npm run lint            # eslint
npm test                # node --test, no extra dependencies
npm run validate:manifest
npm run build           # unpacked extension into dist/wdrosdns
npm run update:psl      # refresh the bundled Public Suffix List
```

The packaged file list is derived from `manifest.json` and the HTML/JS reference graph, so a
new module is picked up automatically. CI builds and validates the ZIP on every push; the
release workflow additionally requires the git tag, `manifest.json` and `package.json`
versions to agree.

## Install

1. Unzip.
2. Open `edge://extensions/`.
3. Enable Developer mode.
4. Click `Load unpacked`.
5. Select the unzipped folder, not the zip file.
