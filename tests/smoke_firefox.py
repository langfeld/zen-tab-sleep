#!/usr/bin/env python3
"""Smoke test of Zen Tab Sleep in plain Firefox (no workspaces).

Usage: python3 tests/smoke_firefox.py [path to the firefox binary]
"""

import os
import shutil
import sys
import tempfile
import time

from harness import (ADDON_UUID, Marionette, build_test_xpi, check, extension_errors,
                     launch, start_http_server, stop, summary, wait_for_states,
                     write_profile)

FIREFOX = sys.argv[1] if len(sys.argv) > 1 else shutil.which("firefox") or "firefox"
PORT = 28296
PAGES = ["n1", "n2", "p1", "g1", "g2", "u1", "u2"]


def main():
    work = tempfile.mkdtemp(prefix="zen-tab-sleep-firefox-")
    profile = os.path.join(work, "profile")
    os.makedirs(profile)
    write_profile(profile, PORT)
    xpi = os.path.join(work, "test.xpi")
    build_test_xpi(xpi)
    server, www = start_http_server(PAGES)
    host = f"http://localhost:{server.server_address[1]}"
    log_path = os.path.join(work, "browser.log")
    log = open(log_path, "w")
    proc = launch(FIREFOX, profile, log)
    m = Marionette(PORT)
    try:
        m.connect()
        print("Firefox " + m.js("return Services.appinfo.version;"))
        m.send("Addon:Install", {"path": xpi, "temporary": True})

        print("\n1. Regular, pinned and grouped tabs, most unused for 2 hours")
        m.js("""
            const host = arguments[0];
            await openTab("N1", host + "/n1.html", { select: true });
            await openTab("N2", host + "/n2.html");
            gBrowser.pinTab(await openTab("P1", host + "/p1.html"));
            const g1 = await openTab("G1", host + "/g1.html");
            const g2 = await openTab("G2", host + "/g2.html");
            gBrowser.addTabGroup([g1, g2], { label: "Named", insertBefore: g1 });
            const u1 = await openTab("U1", host + "/u1.html");
            const u2 = await openTab("U2", host + "/u2.html");
            gBrowser.addTabGroup([u1, u2], { label: "", insertBefore: u1 });
            gBrowser.selectedTab = byName("N1");
            await sleep(300);
            age(["N2", "P1", "G1", "U1"]);
        """, host)
        expected = {"N1": "awake", "N2": "asleep", "P1": "awake", "G1": "asleep",
                    "G2": "awake", "U1": "asleep", "U2": "awake"}
        states = wait_for_states(m, expected, timeout=30)
        check("Inactive tab sleeps (N2)", states["N2"] == "asleep", states["N2"])
        check("Active tab stays awake (N1)", states["N1"] == "awake", states["N1"])
        check("Pinned tab stays awake, counts as an Essential (P1)", states["P1"] == "awake", states["P1"])
        check("Named group: old tab sleeps, fresh one stays awake (G1, G2)",
              states["G1"] == "asleep" and states["G2"] == "awake", f'{states["G1"]}/{states["G2"]}')
        check("Unnamed group: tabs sleep on their own, not only together (U1, U2)",
              states["U1"] == "asleep" and states["U2"] == "awake", f'{states["U1"]}/{states["U2"]}')

        print("\n2. Popup view")
        popup_url = f"moz-extension://{ADDON_UUID}/popup.html"
        m.js("await openTab('POP', arguments[0], { select: true });", popup_url)
        m.context("content")
        m.switch_to_url(popup_url)
        time.sleep(1)
        popup = m.content_js("""
            return { heading: document.querySelector('h1').textContent,
                     status: document.getElementById('status').textContent };""")
        m.context("chrome")
        check("Popup renders", popup["heading"] == "Zen Tab Sleep" and
              popup["status"] == "This page is never put to sleep.", popup)

        m.send("Marionette:Quit", {"flags": ["eForceQuit"]})
    finally:
        m.close()
        stop(proc, profile)
        server.shutdown()
        log.close()

    errors = extension_errors(log_path)
    check("No extension errors in the browser log", not errors, "; ".join(errors[:5]))
    shutil.rmtree(www, ignore_errors=True)
    sys.exit(0 if summary() else 1)


if __name__ == "__main__":
    main()
