# Zen Tab Sleep

*[Deutsche Fassung](README.de.md)*

Puts inactive tabs to sleep across **all** workspaces of the
[Zen browser](https://zen-browser.app). Essentials, exceptions and tabs
playing audio or using the camera stay awake.

"Sleeping" is the same as Zen's own *Unload*: the tab stays in the sidebar,
frees its memory and reloads when you click it.

## Why another tab unloader?

Zen only hands extensions the tabs of the **active** workspace. Typical tab
unloaders never see the tabs in your other workspaces, which are exactly the
tabs you aren't using. Zen Tab Sleep remembers every tab it has seen once and
reaches it later in any workspace. After a browser restart, tabs aren't loaded
until you open them anyway, so every tab that uses memory is covered.

## What stays awake

- Essentials (can be turned off)
- pinned workspace tabs and folders, if you turn it on
- tabs playing audio (can be turned off) and tabs using the camera,
  microphone or screen sharing (always)
- tabs on your exception list
- tabs you keep awake from the tab context menu or the popup (until restart)
- the active tab, and a split view as long as one of its tabs is active
- pages that would ask before being left (Firefox decides)

## Exceptions

One rule per line in the popup; `#` starts a comment.

| Rule | Matches |
|---|---|
| `github.com` | the domain and all its subdomains |
| `https://example.com/app` | every address that starts like this |
| `*://*.example.com/*.pdf` | a pattern over the whole address, `*` = anything |

Right-click a tab and choose **Always keep “example.com” awake** to add or
remove its domain.

## Installation

- **Firefox Add-ons:** coming soon.
- **From source:** open `about:debugging`, choose *This Firefox* →
  *Load Temporary Add-on…* and pick `extension/manifest.json`. It stays
  installed until the next restart.

## How it works and limitations

- Every minute, and whenever you switch tabs, the extension looks for tabs
  that haven't been used for longer than the set time and unloads them with
  `tabs.discard()`.
- Essentials are recognized by being visible in every workspace. Tabs in
  folders are never Essentials (Zen removes a tab from the Essentials when it
  moves into a folder), so they count as workspace tabs right away. Any other
  pinned tab only counts as a workspace tab once it was missing in two checks
  in a row, that is after you left its workspace for about two minutes. Until
  then it stays awake.
- With container-specific Essentials, the Essentials of other containers look
  like workspace tabs. Turn on *Keep pinned workspace tabs and folders awake*
  or add them to the exceptions.
- A split view only sleeps as a whole, because Zen unloads the whole view as
  soon as one of its tabs is unloaded.
- In private windows, the extension only works if you allow it in
  `about:addons`.
- It works in plain Firefox as well. Pinned tabs count as Essentials there.

## Marking sleeping tabs

Zen only dims the favicon of a sleeping tab a little. The
[Ghost Tabs](https://github.com/Seismix/zen-ghost-tabs) mod turns sleeping
tabs and folders clearly gray.

If Ghost Tabs leaves some folders colored although all their tabs sleep, a
hidden placeholder tab that Zen keeps in every folder is awake. In the mod's
`chrome.css` (in your profile under `chrome/zen-themes/<mod id>/`), change
`:not([pending="true"])` in the folder rule to
`:not([pending="true"], [zen-empty-tab])`. Then turn the mod off and on again
in Zen's settings so Zen rebuilds its mod stylesheet.

## Permissions and privacy

| Permission | Used for |
|---|---|
| `tabs` | reading tab addresses for the exception list |
| `tabGroups` | telling split views apart from folders |
| `menus` | the entries in the tab context menu |
| `storage`, `alarms` | the settings and the check every minute |

The extension collects no data and sends nothing anywhere. Its content
security policy (`connect-src 'none'`) rules out any network access.

## Development

```sh
npm install
npm test          # unit tests
npm run lint      # Mozilla's add-on linter
npm run build     # package into dist/
```

The browser tests drive a real browser headless, with a throwaway profile:

```sh
python3 tests/e2e_zen.py /path/to/zen   # Zen: workspaces, folders, split views, restart
python3 tests/smoke_firefox.py          # plain Firefox
```

To get the binary out of Zen's AppImage, run
`zen-x86_64.AppImage --appimage-extract`; it ends up in `squashfs-root/zen`.

## License

[MIT](LICENSE)
