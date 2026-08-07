# Privacy Policy

🇷🇺 [Русская версия](PRIVACY.ru.md)

**MikroTik DNS Helper** does not collect, transmit, or sell any user data to the developer
or any third party. There is no telemetry, analytics, or remote logging of any kind.

## What is stored

The extension stores the following locally in your browser, via `chrome.storage.local`:

- RouterOS connection profiles: address, login, password, and per-profile DNS defaults you
  configure.
- Extension settings and network-collector filter preferences.

`chrome.storage.local` is device-local. The extension does **not** use `chrome.storage.sync`,
so none of this is synchronised through your browser account, and it is never sent anywhere
except directly to the RouterOS device you configure.

Captured network metadata is kept in `chrome.storage.session`, which the browser discards
when it shuts down. It survives only so that the collector does not lose what it captured
when the extension's service worker is suspended, which Manifest V3 does whenever the
extension is idle.

### About the stored password

RouterOS passwords are stored **unencrypted**. Browser extension storage is not a secure
credential vault: it is readable by anyone with access to your browser profile directory or
to the machine while you are logged in. This is normal for browser extensions, but worth
being explicit about.

Recommended: create a dedicated RouterOS user for this extension, with permission to read
the system identity and to change DNS, and nothing else.

Passwords are masked in the extension's own diagnostic output (the "router response" view
and status tooltips) so they are not exposed by copying a result.

## What is transmitted, and to whom

The only network requests the extension makes are directly from your browser to the
RouterOS REST API endpoint(s) you configure (your own router, on your own network). These
requests carry the login/password you saved for that profile and the DNS records you choose
to add. No request is ever sent to the developer or to any third-party server.

The `webRequest` permission is used only to read metadata of requests made by the current
tab, entirely within your browser, in order to populate the network domain collector. Only
the host name, request method, resource type, timing and HTTP status/error are kept — full
URLs are discarded immediately, so query strings and the parameters they may carry are never
stored. This metadata stays in the browser session and leaves it only for the domain names
you explicitly choose to add to your router.

## Third parties

None. The extension has no runtime external dependencies, ad networks, or analytics SDKs.

It bundles a copy of the [Public Suffix List](https://publicsuffix.org/) (Mozilla Public
License 2.0) as static data, used offline to work out the registrable domain of a host name.
No request is made to fetch or update it while the extension runs.

## Changes

Any change to this policy will be reflected in this file and in the extension's version
history in this repository.

## Contact

Questions can be raised via [GitHub Issues](https://github.com/andrey-vk/wdrosdns/issues).
