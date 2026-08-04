# Privacy Policy

🇷🇺 [Русская версия](PRIVACY.ru.md)

**MikroTik DNS Helper** does not collect, transmit, or sell any user data to the developer
or any third party. There is no telemetry, analytics, or remote logging of any kind.

## What is stored

The extension stores the following locally in your browser, via the `chrome.storage` API:

- RouterOS connection profiles: address, login, password, and per-profile DNS defaults you
  configure.
- Extension settings and network-collector filter preferences.

This data stays on your device (or syncs through your own browser's account sync, if
`chrome.storage.sync` is enabled by your browser profile) and is never sent anywhere except
directly to the RouterOS device you configure.

## What is transmitted, and to whom

The only network requests the extension makes are directly from your browser to the
RouterOS REST API endpoint(s) you configure (your own router, on your own network). These
requests carry the login/password you saved for that profile and the DNS records you choose
to add. No request is ever sent to the developer or to any third-party server.

The `webRequest` permission is used only to read metadata (URL, host, HTTP status) of
requests made by the current tab, entirely within your browser, in order to populate the
network domain collector. This data is not persisted beyond the current popup/devtools
session unless you explicitly add a domain to your router.

## Third parties

None. The extension has no external dependencies, ad networks, or analytics SDKs.

## Changes

Any change to this policy will be reflected in this file and in the extension's version
history in this repository.

## Contact

Questions can be raised via [GitHub Issues](https://github.com/andrey-vk/wdrosdns/issues).
