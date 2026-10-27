# Zen Tab Sleep

*[English version](README.md)*

Legt inaktive Tabs in **allen** Workspaces des
[Zen-Browsers](https://zen-browser.app) schlafen. Essentials, Ausnahmen und
Tabs mit Ton oder Kamera bleiben wach.

„Schlafen“ ist dasselbe wie Zens „Unload“: Der Tab bleibt in der Seitenleiste,
gibt seinen Speicher frei und lädt beim nächsten Klick neu.

## Warum noch ein Tab-Entlader?

Zen gibt Erweiterungen nur die Tabs des **aktiven** Workspace heraus. Übliche
Tab-Entlader sehen deshalb nie die Tabs in deinen anderen Workspaces, also
genau die, die du gerade nicht benutzt. Zen Tab Sleep merkt sich jeden Tab,
den es einmal gesehen hat, und erreicht ihn später in jedem Workspace. Nach
einem Neustart sind Tabs ohnehin entladen, bis du sie öffnest. Damit ist jeder
Tab abgedeckt, der Speicher belegt.

## Was wach bleibt

- Essentials (abschaltbar)
- angepinnte Workspace-Tabs und Ordner, wenn du es einschaltest
- Tabs mit Ton (abschaltbar) und Tabs mit Kamera-, Mikrofon- oder
  Bildschirmfreigabe (immer)
- Tabs auf deiner Ausnahmeliste
- Tabs, die du über das Tab-Kontextmenü oder das Popup wach hältst (bis zum
  Neustart)
- der aktive Tab und eine geteilte Ansicht, solange einer ihrer Tabs aktiv ist
- Seiten, die beim Verlassen nachfragen würden (das entscheidet Firefox)

## Ausnahmen

Eine Regel pro Zeile im Popup; `#` leitet einen Kommentar ein.

| Regel | Trifft auf |
|---|---|
| `github.com` | die Domain samt allen Subdomains |
| `https://example.com/app` | jede Adresse, die so beginnt |
| `*://*.example.com/*.pdf` | ein Muster über die ganze Adresse, `*` = beliebig |

Per Rechtsklick auf einen Tab → **„example.com“ immer wach halten** nimmst du
seine Domain auf die Liste oder wieder herunter.

## Installation

- **Firefox Add-ons:** folgt in Kürze.
- **Aus dem Quellcode:** `about:debugging` öffnen, *Dieser Firefox* →
  *Temporäres Add-on laden…* und `extension/manifest.json` wählen. Es bleibt
  bis zum nächsten Neustart installiert.

## Wie es funktioniert und wo die Grenzen sind

- Jede Minute und bei jedem Tab-Wechsel sucht die Erweiterung nach Tabs, die
  länger als die eingestellte Zeit nicht benutzt wurden, und entlädt sie mit
  `tabs.discard()`.
- Essentials erkennt sie daran, dass sie in jedem Workspace sichtbar sind.
  Tabs in Ordnern sind nie Essentials (Zen nimmt einen Tab aus den
  Essentials, sobald er in einen Ordner kommt) und gelten sofort als
  Workspace-Tabs. Jeder andere angepinnte Tab gilt erst als Workspace-Tab,
  wenn er bei zwei Prüfungen hintereinander gefehlt hat, du seinen Workspace
  also etwa zwei Minuten verlassen hast. Bis dahin bleibt er wach.
- Mit container-spezifischen Essentials sehen Essentials anderer Container wie
  Workspace-Tabs aus. Schalte dann *Angepinnte Workspace-Tabs und Ordner wach
  halten* ein oder setze sie auf die Ausnahmeliste.
- Eine geteilte Ansicht schläft nur als Ganzes, weil Zen die ganze Ansicht
  entlädt, sobald einer ihrer Tabs entladen wird.
- In privaten Fenstern arbeitet die Erweiterung nur, wenn du das in
  `about:addons` erlaubst.
- Sie funktioniert auch in normalem Firefox. Dort zählen angepinnte Tabs als
  Essentials.

## Schlafende Tabs markieren

Zen blendet das Favicon eines schlafenden Tabs nur leicht ab. Die Mod
[Ghost Tabs](https://github.com/Seismix/zen-ghost-tabs) graut schlafende Tabs
und Ordner deutlich aus.

Bleiben mit Ghost Tabs manche Ordner farbig, obwohl alle ihre Tabs schlafen,
ist ein unsichtbarer Platzhalter-Tab wach, den Zen in jeden Ordner legt. Ändere
in der `chrome.css` der Mod (im Profil unter `chrome/zen-themes/<Mod-ID>/`) in
der Ordner-Regel `:not([pending="true"])` zu
`:not([pending="true"], [zen-empty-tab])`. Schalte die Mod danach in Zens
Einstellungen einmal aus und wieder ein, damit Zen sein Mod-Stylesheet neu
baut.

## Berechtigungen und Datenschutz

| Berechtigung | Wofür |
|---|---|
| `tabs` | Adressen der Tabs für die Ausnahmeliste lesen |
| `tabGroups` | geteilte Ansichten von Ordnern unterscheiden |
| `menus` | die Einträge im Tab-Kontextmenü |
| `storage`, `alarms` | die Einstellungen und die minütliche Prüfung |

Die Erweiterung sammelt keine Daten und schickt nichts irgendwohin. Ihre
Content Security Policy (`connect-src 'none'`) schließt jeden Netzwerkzugriff
aus.

## Entwicklung

```sh
npm install
npm test          # Unit-Tests
npm run lint      # Mozillas Add-on-Linter
npm run build     # Paket nach dist/
```

Die Browser-Tests steuern einen echten Browser headless mit einem
Wegwerf-Profil:

```sh
python3 tests/e2e_zen.py /pfad/zu/zen   # Zen: Workspaces, Ordner, Split View, Neustart
python3 tests/smoke_firefox.py          # normales Firefox
```

Die Binary steckt in Zens AppImage; `zen-x86_64.AppImage --appimage-extract`
legt sie unter `squashfs-root/zen` ab.

## Lizenz

[MIT](LICENSE)
