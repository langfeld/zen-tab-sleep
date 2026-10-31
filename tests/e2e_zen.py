#!/usr/bin/env python3
"""End-to-end test of Zen Tab Sleep in a real Zen browser.

Usage: python3 tests/e2e_zen.py <path to the zen binary>

Get the binary from the AppImage with `zen-x86_64.AppImage --appimage-extract`
(it ends up in squashfs-root/zen).
"""

import os
import shutil
import sys
import tempfile
import time

from harness import (ADDON_ID, ADDON_UUID, Marionette, build_test_xpi, check,
                     extension_errors, launch, start_http_server, stop, summary,
                     wait_for_states, write_profile)

ZEN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/zen-appimage/squashfs-root/zen"
PORT = 28290
PAGES = ["a1", "a2", "ap", "e1", "s1", "s2", "t1", "t2", "b1", "bs1", "bs2", "bf1", "bf2",
         "bc1", "bp1", "cf1", "cf2", "c1", "f1", "f2", "g1", "g2", "x1", "x2", "y1", "k1", "k2",
         "r1"]


def main():
    if not os.path.exists(ZEN):
        sys.exit(f"Zen not found: {ZEN}")
    work = tempfile.mkdtemp(prefix="zen-tab-sleep-e2e-")
    profile = os.path.join(work, "profile")
    os.makedirs(profile)
    write_profile(profile, PORT)
    xpi = os.path.join(work, "test.xpi")
    build_test_xpi(xpi)
    server, www = start_http_server(PAGES)
    port = server.server_address[1]
    host = f"http://localhost:{port}"
    ip = f"http://127.0.0.1:{port}"
    log_path = os.path.join(work, "browser.log")
    log = open(log_path, "w")
    print(f"Working directory: {work}")
    proc = launch(ZEN, profile, log)
    m = Marionette(PORT)
    try:
        m.connect()
        version = m.js("return Services.appinfo.version + ' / Gecko ' + Services.appinfo.platformVersion;")
        print(f"Zen {version}")

        installed_permanently = True
        try:
            m.send("Addon:Install", {"path": xpi, "temporary": False})
        except RuntimeError as error:
            print(f"Permanent install failed ({error}), installing temporarily.")
            m.send("Addon:Install", {"path": xpi, "temporary": True})
            installed_permanently = False
        check("Extension installed (permanently, unsigned)", installed_permanently)

        print("\n1. Workspace A with tabs, a pin, an Essential, split views and folders")
        info = m.js("""
            await gZenWorkspaces.promiseInitialized;
            const wsA = await gZenWorkspaces.createAndSaveWorkspace("E2E A");
            await waitFor(() => gZenWorkspaces.activeWorkspace === wsA.uuid, "workspace A");
            const [host, ip] = arguments;
            await openTab("A1", host + "/a1.html");
            await openTab("A2", ip + "/a2.html");
            gBrowser.pinTab(await openTab("AP", host + "/ap.html"));
            const e1 = await openTab("E1", host + "/e1.html");
            gBrowser.pinTab(e1);
            gZenPinnedTabManager.addToEssentials(e1);
            const s1 = await openTab("AS1", host + "/s1.html");
            const s2 = await openTab("AS2", host + "/s2.html");
            gZenViewSplitter.splitTabs([s1, s2], "vsep", 0);
            const t1 = await openTab("AT1", host + "/t1.html");
            const t2 = await openTab("AT2", host + "/t2.html");
            gZenViewSplitter.splitTabs([t1, t2], "vsep", 0);
            const f1 = await openTab("AF1", host + "/f1.html");
            const f2 = await openTab("AF2", host + "/f2.html");
            gZenFolders.createFolder([f1, f2], { label: "E2E folder" });
            const g1 = await openTab("AG1", host + "/g1.html");
            const g2 = await openTab("AG2", host + "/g2.html");
            gZenFolders.createFolder([g1, g2], { label: "E2E folder 2" });
            gBrowser.selectedTab = byName("A1");
            await sleep(500);
            const t = n => byName(n);
            return {
              essential: t("E1").hasAttribute("zen-essential"),
              split: !!t("AS1").group?.hasAttribute("split-view-group") &&
                     t("AS1").group === t("AS2").group,
              folder: !!t("AF1").group?.isZenFolder && t("AF1").group === t("AF2").group,
              apPinned: t("AP").pinned,
            };
        """, host, ip)
        check("Essential created", info["essential"])
        check("Split view created", info["split"])
        check("Folder created", info["folder"])
        check("Workspace pin created", info["apPinned"])
        time.sleep(8)  # one check, so the extension sees everything

        print("\n2. Switch to workspace B; tabs in A unused for 2 hours")
        premise = m.js("""
            const wsB = await gZenWorkspaces.createAndSaveWorkspace("E2E B");
            await waitFor(() => gZenWorkspaces.activeWorkspace === wsB.uuid, "workspace B");
            await openTab("B1", arguments[0] + "/b1.html", { select: true });
            // Only one tab each is old in AT and AG.
            age(["A1", "A2", "AP", "E1", "AS1", "AS2", "AT1", "AF1", "AF2", "AG1"]);
            // gBrowser.tabs is the list tabs.query() reads from.
            return {
              a1: gBrowser.tabs.includes(byName("A1")),
              ap: gBrowser.tabs.includes(byName("AP")),
              e1: gBrowser.tabs.includes(byName("E1")),
              a1Hidden: byName("A1").hidden,
            };
        """, host)
        check("Premise: tabs of workspace A are missing from gBrowser.tabs",
              not premise["a1"] and not premise["ap"], premise)
        check("Premise: the Essential is in gBrowser.tabs", premise["e1"], premise)
        check("Premise: Zen doesn't mark other workspaces' tabs as hidden",
              premise["a1Hidden"] is False, premise)
        names = ["A1", "A2", "AP", "AS1", "AS2", "AT1", "AT2", "AF1", "AF2", "AG1", "AG2",
                 "E1", "B1"]
        expected = {n: "asleep" for n in names}
        expected.update(E1="awake", B1="awake", AP="awake", AT1="awake", AT2="awake", AG2="awake")
        states = wait_for_states(m, expected)
        check("Split view with one fresh tab stays fully awake (AT1, AT2)",
              states["AT1"] == states["AT2"] == "awake", f'{states["AT1"]}/{states["AT2"]}')
        check("Folder: old tab sleeps alone, fresh one stays awake (AG1, AG2)",
              states["AG1"] == "asleep" and states["AG2"] == "awake",
              f'{states["AG1"]}/{states["AG2"]}')
        check("Tabs in workspace A sleep (A1, A2)", states["A1"] == states["A2"] == "asleep", states)
        check("Pinned tab outside a folder stays awake, it could be an Essential (AP)",
              states["AP"] == "awake", states["AP"])
        check("Background split view sleeps as a whole", states["AS1"] == states["AS2"] == "asleep",
              f'{states["AS1"]}/{states["AS2"]}')
        check("Folder tabs sleep", states["AF1"] == states["AF2"] == "asleep",
              f'{states["AF1"]}/{states["AF2"]}')
        check("Essential stays awake (E1)", states["E1"] == "awake", states["E1"])
        check("Active tab stays awake (B1)", states["B1"] == "awake", states["B1"])

        print("\n3. Active split view: the partner of the active tab must not sleep")
        m.js("""
            const host = arguments[0];
            const b1 = await openTab("BS1", host + "/bs1.html");
            const b2 = await openTab("BS2", host + "/bs2.html");
            gZenViewSplitter.splitTabs([b1, b2], "vsep", 0);
            gBrowser.selectedTab = b1;
            await sleep(300);
            age(["BS2"]);
        """, host)
        time.sleep(16)
        states = m.js("""return Object.assign(describe(["BS1", "BS2"]),
                         { selected: gBrowser.selectedTab.getAttribute("data-e2e") });""")
        check("Visible split partner stays awake (BS2)", states["BS2"] == "awake", states["BS2"])
        check("Active split tab stays awake and selected (BS1)",
              states["BS1"] == "awake" and states["selected"] == "BS1", states)

        print("\n4. Folders in the active workspace (Zen pins folder tabs)")
        m.js("""
            const host = arguments[0];
            gBrowser.selectedTab = byName("B1");
            const bf1 = await openTab("BF1", host + "/bf1.html");
            const bf2 = await openTab("BF2", host + "/bf2.html");
            gZenFolders.createFolder([bf1, bf2], { label: "E2E folder B" });
            const bc1 = await openTab("BC1", host + "/bc1.html");
            gZenFolders.createFolder([bc1], { label: "E2E collapsed" });
            bc1.group.collapsed = true;
            gBrowser.pinTab(await openTab("BP1", host + "/bp1.html"));
            gBrowser.selectedTab = byName("B1");
            await sleep(300);
            age(["BF1", "BF2", "BC1", "BP1", "E1"]);
        """, host)
        states = wait_for_states(m, {"BF1": "asleep", "BF2": "asleep", "BC1": "asleep",
                                     "BP1": "awake", "E1": "awake"}, timeout=30)
        check("Folder in the active workspace sleeps (BF1, BF2)",
              states["BF1"] == states["BF2"] == "asleep", states)
        check("Collapsed folder in the active workspace sleeps (BC1)",
              states["BC1"] == "asleep", states["BC1"])
        check("Pinned tab outside a folder stays awake (BP1)",
              states["BP1"] == "awake", states["BP1"])
        check("Essential stays awake (E1)", states["E1"] == "awake", states["E1"])

        print("\n5. Essentials of another container (Zen separates Essentials per container)")
        hidden = m.js("""
            const host = arguments[0];
            gBrowser.selectedTab = byName("B1");
            const cf1 = await openTab("CF1", host + "/cf1.html");
            const cf2 = await openTab("CF2", host + "/cf2.html");
            gZenFolders.createFolder([cf1, cf2], { label: "E2E folder C" });
            await sleep(7000);                          // one check sees CF1 as a folder tab
            gZenPinnedTabManager.addToEssentials(cf1);  // the folder tab becomes an Essential
            const c = await gZenWorkspaces.createAndSaveWorkspace("E2E C", undefined, false, 2);
            await waitFor(() => gZenWorkspaces.activeWorkspace === c.uuid, "workspace C");
            await openTab("C1", host + "/c1.html", { select: true });
            age(["E1", "CF1"]);
            return { E1: gBrowser.tabs.includes(byName("E1")),
                     CF1: gBrowser.tabs.includes(byName("CF1")),
                     separate: Services.prefs.getBoolPref("zen.workspaces.separate-essentials", false) };
        """, host)
        check("Premise: Zen hides default-container Essentials in a space with another container",
              hidden["separate"] and not hidden["E1"] and not hidden["CF1"], hidden)
        time.sleep(30)  # about five checks
        states = m.js('return describe(["E1", "CF1"]);')
        check("Essential hidden by its container stays awake (E1)", states["E1"] == "awake", states["E1"])
        check("Folder tab moved to the Essentials stays awake (CF1)", states["CF1"] == "awake", states["CF1"])
        m.js('await space("E2E B"); gBrowser.selectedTab = byName("B1");')

        print("\n6. Popup view and options page: exception 127.0.0.1")
        # Popup in a tab: "this tab" is then the popup page itself.
        popup_url = f"moz-extension://{ADDON_UUID}/popup.html"
        m.js("await openTab('POP', arguments[0], { select: true });", popup_url)
        m.context("content")
        m.switch_to_url(popup_url)
        time.sleep(1)
        popup = m.content_js("""
            return { status: document.getElementById('status').textContent,
                     stats: document.getElementById('stats').textContent,
                     siteHidden: document.getElementById('keepSiteRow').hidden,
                     heading: document.querySelector('h1').textContent };""")
        m.context("chrome")
        check("Popup shows the extension name", popup["heading"] == "Zen Tab Sleep", popup["heading"])
        check("Popup shows the tab's status", popup["status"] == "This page is never put to sleep.",
              popup["status"])
        check("Popup shows the statistics", "tabs known" in popup["stats"], popup["stats"])
        check("Popup hides the website option for internal pages", popup["siteHidden"] is True)

        options_url = f"moz-extension://{ADDON_UUID}/popup.html?options"
        m.js("await openTab('OPT', arguments[0], { select: true });", options_url)
        m.context("content")
        m.switch_to_url(options_url)
        area = m.find("#exclusions")
        m.send("WebDriver:ElementClear", {"id": area})
        m.send("WebDriver:ElementSendKeys", {"id": area, "text": "127.0.0.1\nnot valid"})
        time.sleep(1)
        error_text = m.send("WebDriver:GetElementText", {"id": m.find("#exclusionsError")})["value"]
        current_tab_hidden = m.content_js("return document.getElementById('current').hidden;")
        m.context("chrome")
        check("Options page reports a line it can't parse", "not valid" in error_text, error_text)
        check("Options page hides the tab section", current_tab_hidden is True)
        m.js("""
            gBrowser.selectedTab = byName("B1");
            const [host, ip] = arguments;
            await openTab("X1", ip + "/x1.html");
            await openTab("X2", host + "/x2.html");
            age(["X1", "X2"]);
        """, host, ip)
        states = wait_for_states(m, {"X1": "awake", "X2": "asleep"}, timeout=20)
        check("Tab on the exception list stays awake (X1)", states["X1"] == "awake", states["X1"])
        check("Other tab sleeps (X2)", states["X2"] == "asleep", states["X2"])

        print("\n7. Turning it off on the options page")
        m.js('gBrowser.selectedTab = byName("OPT");')
        m.context("content")
        m.send("WebDriver:ElementClick", {"id": m.find("#enabled")})
        time.sleep(1)
        m.context("chrome")
        m.js("""
            gBrowser.selectedTab = byName("B1");
            await openTab("Y1", arguments[0] + "/y1.html");
            age(["Y1"]);
        """, host)
        time.sleep(16)
        state = m.js('return describe(["Y1"]).Y1;')
        check("Turned off: nothing is put to sleep (Y1)", state == "awake", state)
        m.js('gBrowser.selectedTab = byName("OPT");')
        m.context("content")
        m.send("WebDriver:ElementClick", {"id": m.find("#enabled")})
        time.sleep(1)
        m.context("chrome")
        m.js('gBrowser.selectedTab = byName("B1");')
        state = wait_for_states(m, {"Y1": "asleep"}, timeout=20)["Y1"]
        check("Turned on again: Y1 sleeps", state == "asleep", state)

        print("\n8. Tab context menu")
        menu = m.js("""
            const [host, ip] = arguments;
            await openTab("K1", host + "/k1.html");
            await openTab("K2", ip + "/k2.html");
            const popup = document.getElementById("tabContextMenu");
            const ours = () => [...popup.querySelectorAll("menuitem")]
              .filter(i => / awake$/.test(i.label));
            async function useMenu(name, host, pick) {
              const tab = byName(name);
              const shown = new Promise(r => popup.addEventListener("popupshown", r, { once: true }));
              tab.dispatchEvent(new MouseEvent("contextmenu",
                { bubbles: true, cancelable: true, button: 2 }));
              await shown;
              const snapshot = () => ours().map(i =>
                ({ label: i.label, checked: i.getAttribute("checked") === "true" }));
              const initial = snapshot();
              // menus.onShown wakes the event page and updates titles and checkmarks.
              await waitFor(() => ours().some(i => i.label.includes("“" + host + "”")), "menu title");
              const items = snapshot();
              const item = ours().find(i => pick.test(i.label));
              if (!item) {
                throw new Error(name + ": no item for " + pick + " in " + JSON.stringify(items));
              }
              // Headless, menu items count as hidden and activateItem() fails;
              // doCommand() fires the same "command" event.
              const hidden = new Promise(r => popup.addEventListener("popuphidden", r, { once: true }));
              item.doCommand();
              popup.hidePopup();
              await hidden;
              return { items, initial };
            }
            const k1 = await useMenu("K1", "localhost", /this tab/);
            await sleep(1500);
            const k2 = await useMenu("K2", "127.0.0.1", /“127\\.0\\.0\\.1”/);
            await sleep(1000);
            age(["K1", "K2", "X1"]);
            return { k1Items: k1.items, k2Items: k2.items, k2Initial: k2.initial };
        """, host, ip)
        stale = [i for i in menu["k2Initial"] if i["checked"] or "“" in i["label"]]
        check("Menu doesn't show the previous tab's state when opening", not stale,
              menu["k2Initial"])
        k1_site = next((i for i in menu["k1Items"] if "“" in i["label"]), {})
        k2_site = next((i for i in menu["k2Items"] if "“" in i["label"]), {})
        check("Menu shows the tab's domain", k1_site.get("label") == "Always keep “localhost” awake",
              k1_site.get("label"))
        check("Menu checks a domain that is on the exception list", k2_site.get("checked") is True, k2_site)
        states = wait_for_states(m, {"K1": "awake", "K2": "asleep", "X1": "asleep"}, timeout=25)
        check("“Keep this tab awake” works (K1)", states["K1"] == "awake", states["K1"])
        check("Domain removed via menu: K2 and X1 sleep",
              states["K2"] == states["X1"] == "asleep", states)
        m.js('gBrowser.selectedTab = byName("OPT");')
        m.context("content")
        text = m.content_js("return document.getElementById('exclusions').value;")
        m.context("chrome")
        m.js('gBrowser.selectedTab = byName("B1");')
        check("Open options page shows the changed list", text.strip() == "not valid", repr(text))

        if not installed_permanently:
            print("\nRestart test skipped (only installed temporarily).")
        else:
            print("\n9. Restart: does the extension keep working without any action?")
            m.js('Services.prefs.setIntPref("browser.startup.page", 3);')
            m.send("Marionette:Quit", {"flags": ["eRestart"]})
            m.close()
            time.sleep(3)
            m.connect()
            info = m.js(f"""
                await gZenWorkspaces.promiseInitialized;
                const {{ AddonManager }} = ChromeUtils.importESModule(
                  "resource://gre/modules/AddonManager.sys.mjs");
                const addon = await AddonManager.getAddonByID("{ADDON_ID}");
                await space("E2E A");
                const a1 = byTitle("a1");
                a1.setAttribute("data-e2e", "A1");
                gBrowser.selectedTab = a1;
                await waitFor(() => !asleep(a1) && !a1.hasAttribute("busy"), "loading A1");
                await space("E2E B");
                await openTab("R1", arguments[0] + "/r1.html", {{ select: true }});
                age(["A1"]);
                return {{ active: !!addon?.isActive, tabs: allTabs().length }};
            """, host)
            check("Extension active after restart", info["active"], info)
            state = wait_for_states(m, {"A1": "asleep"}, timeout=30)["A1"]
            check("After restart: tab in another workspace sleeps (A1)", state == "asleep", state)

        m.send("Marionette:Quit", {"flags": ["eForceQuit"]})
    finally:
        m.close()
        stop(proc, profile)
        server.shutdown()
        log.close()

    errors = extension_errors(log_path)
    check("No extension errors in the browser log", not errors, "; ".join(errors[:5]))
    shutil.rmtree(www, ignore_errors=True)
    ok = summary()
    print(f"Browser log: {log_path}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
