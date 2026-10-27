# addons.mozilla.org listing

Texts to paste when submitting the add-on. AMO descriptions allow a few HTML
tags (`<b>`, `<ul>`, `<li>`, `<code>`, `<a>`); line breaks are kept.

## Basics

- **Name:** Zen Tab Sleep
- **Add-on URL:** `zen-tab-sleep`
- **Categories:** Tabs
- **Tags:** zen, tabs, workspaces, memory, unload, suspend
- **License:** MIT
- **Homepage:** https://github.com/langfeld/zen-tab-sleep
- **Support site:** https://github.com/langfeld/zen-tab-sleep/issues
- **Privacy policy:** none needed, the add-on collects no data
- **Source code:** not needed, the package contains the unmodified source

## Summary (English)

Puts inactive tabs to sleep across all Zen workspaces, not just the active
one. Essentials, exceptions and tabs playing audio or using the camera stay
awake.

## Summary (Deutsch)

Legt inaktive Tabs in allen Zen-Workspaces schlafen, nicht nur im aktiven.
Essentials, Ausnahmen und Tabs mit Ton oder Kamera bleiben wach.

## Description (English)

```html
Frees memory by putting tabs to sleep that you haven't used for a while (30 minutes by default). Sleeping works like Zen's own Unload: the tab stays in the sidebar and reloads when you click it.

<b>Made for Zen workspaces</b>
Zen only gives extensions the tabs of the active workspace, so typical tab unloaders never reach your other workspaces. Zen Tab Sleep remembers every tab it has seen and puts it to sleep in any workspace.

<b>What stays awake</b>
<ul>
<li>Essentials (optional)</li>
<li>pinned workspace tabs and folders, if you want</li>
<li>tabs playing audio, and tabs using the camera, microphone or screen sharing</li>
<li>sites on your exception list, e.g. <code>github.com</code> or <code>https://example.com/app</code></li>
<li>tabs you keep awake from the tab context menu</li>
<li>the active tab, and split views while one of their tabs is active</li>
</ul>
<b>Privacy</b>
No data is collected or sent anywhere; the extension can't access the network at all.

Also works in plain Firefox, where pinned tabs count as Essentials.

Source code, details and limitations: https://github.com/langfeld/zen-tab-sleep
```

## Description (Deutsch)

```html
Spart Speicher, indem es Tabs schlafen legt, die du eine Weile nicht benutzt hast (standardmäßig 30 Minuten). Schlafen funktioniert wie Zens eigenes „Unload“: Der Tab bleibt in der Seitenleiste und lädt beim nächsten Klick neu.

<b>Gemacht für Zen-Workspaces</b>
Zen gibt Erweiterungen nur die Tabs des aktiven Workspace heraus, deshalb erreichen übliche Tab-Entlader deine anderen Workspaces nie. Zen Tab Sleep merkt sich jeden Tab, den es gesehen hat, und legt ihn in jedem Workspace schlafen.

<b>Was wach bleibt</b>
<ul>
<li>Essentials (abschaltbar)</li>
<li>angepinnte Workspace-Tabs und Ordner, wenn du willst</li>
<li>Tabs mit Ton sowie Tabs mit Kamera-, Mikrofon- oder Bildschirmfreigabe</li>
<li>Websites auf deiner Ausnahmeliste, z. B. <code>github.com</code> oder <code>https://example.com/app</code></li>
<li>Tabs, die du per Kontextmenü wach hältst</li>
<li>der aktive Tab und geteilte Ansichten, solange einer ihrer Tabs aktiv ist</li>
</ul>
<b>Datenschutz</b>
Es werden keine Daten gesammelt oder verschickt; die Erweiterung hat überhaupt keinen Netzwerkzugriff.

Funktioniert auch in normalem Firefox; dort zählen angepinnte Tabs als Essentials.

Quellcode, Details und Grenzen: https://github.com/langfeld/zen-tab-sleep
```

## Notes for reviewers

```text
Plain JavaScript without a build step, bundler or third-party code; the package is the unmodified source from https://github.com/langfeld/zen-tab-sleep.

Permissions:
- tabs: read tab URLs to match the user's exception list (domains/patterns).
- tabGroups: tell Zen split views (untitled groups) apart from folders (titled groups).
- menus: two checkbox entries in the tab context menu.
- storage, alarms: settings, session state, and a check every minute.

No network access: the extension pages' CSP sets connect-src 'none'. No data collection (data_collection_permissions: none).

Testing: set "Sleep after" to 1 minute in the popup, open a few tabs, switch to another tab and wait two minutes; the inactive tabs get discarded. In the Zen browser this also covers tabs in other workspaces.
```
