"""Shared helpers for the browser tests.

Starts Zen or Firefox headless with a fresh throwaway profile, installs the
extension (test build: checks every 6 instead of 60 seconds) and drives the
browser through Marionette. Your own browser profile is never touched.
"""

import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTENSION = os.path.join(ROOT, "extension")
ADDON_ID = "{1ddaa81f-d9db-4f5b-9a9f-128fe813b686}"
ADDON_UUID = "5e1f0c4a-7d1b-4c55-9a0e-2b8f6c3d9e10"
ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"

results = []


def check(name, condition, detail=""):
    results.append((name, bool(condition)))
    mark = "OK  " if condition else "FAIL"
    print(f"  [{mark}] {name}" + (f"  ({detail})" if detail else ""), flush=True)


def summary():
    failed = [name for name, ok in results if not ok]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed.")
    return not failed


class Marionette:
    def __init__(self, port):
        self.port = port
        self.sock = None
        self.msgid = 0

    def connect(self, timeout=90):
        deadline = time.time() + timeout
        while True:
            try:
                self.sock = socket.create_connection(("127.0.0.1", self.port), timeout=5)
                break
            except OSError:
                if time.time() > deadline:
                    raise
                time.sleep(0.5)
        self.sock.settimeout(300)
        hello = self._read()
        assert hello.get("marionetteProtocol") == 3, hello
        self.send("WebDriver:NewSession", {"capabilities": {}})
        self.send("WebDriver:SetTimeouts", {"script": 180000})
        self.context("chrome")

    def _read(self):
        head = b""
        while not head.endswith(b":"):
            chunk = self.sock.recv(1)
            if not chunk:
                raise ConnectionError("Marionette connection closed")
            head += chunk
        length = int(head[:-1])
        data = b""
        while len(data) < length:
            chunk = self.sock.recv(length - len(data))
            if not chunk:
                raise ConnectionError("Marionette connection closed")
            data += chunk
        return json.loads(data)

    def send(self, command, params=None):
        self.msgid += 1
        payload = json.dumps([0, self.msgid, command, params or {}]).encode()
        self.sock.sendall(str(len(payload)).encode() + b":" + payload)
        while True:
            msg = self._read()
            if msg[0] == 1 and msg[1] == self.msgid:
                if msg[2]:
                    raise RuntimeError(f"{command}: {msg[2]}")
                return msg[3]

    def context(self, name):
        self.send("Marionette:SetContext", {"value": name})

    def js(self, body, *args):
        """Runs async chrome JS together with the helpers from PRELUDE."""
        script = PRELUDE + "return (async () => {\n" + body + "\n})();"
        return self.send("WebDriver:ExecuteScript", {"script": script, "args": list(args)})["value"]

    def content_js(self, body):
        return self.send("WebDriver:ExecuteScript", {"script": body, "args": []})["value"]

    def find(self, css):
        return self.send("WebDriver:FindElement", {"using": "css selector", "value": css})["value"][ELEMENT_KEY]

    def switch_to_url(self, url):
        """Switches the content context to the tab showing url."""
        for handle in self.send("WebDriver:GetWindowHandles"):
            self.send("WebDriver:SwitchToWindow", {"handle": handle})
            if self.send("WebDriver:GetCurrentURL")["value"] == url:
                return
        raise RuntimeError(f"Tab not found: {url}")

    def close(self):
        if self.sock:
            self.sock.close()
            self.sock = None


PRELUDE = r"""
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, what, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch (e) {}
    await sleep(200);
  }
  throw new Error("Timed out: " + what);
}
const allTabs = () => window.gZenWorkspaces ? gZenWorkspaces.allStoredTabs : gBrowser.tabs;
const byName = name => allTabs().find(t => t.getAttribute("data-e2e") === name);
// Test pages use their name as title, which restored tabs keep before loading.
const byTitle = title => allTabs().find(t => t.label === title);
const asleep = tab => tab.hasAttribute("pending") || !tab.linkedPanel;
const describe = names => Object.fromEntries(names.map(n => {
  const t = byName(n);
  return [n, t ? (asleep(t) ? "asleep" : "awake") : "missing"];
}));
const age = (names, hours = 2) => {
  for (const n of names) byName(n).updateLastAccessed(Date.now() - hours * 3600 * 1000);
};
async function openTab(name, url, { select = false } = {}) {
  const tab = gBrowser.addTab(url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  tab.setAttribute("data-e2e", name);
  if (select) gBrowser.selectedTab = tab;
  await waitFor(() => tab.linkedBrowser.currentURI.spec === url &&
    !tab.hasAttribute("busy"), "loading " + name);
  return tab;
}
async function space(name) {
  const ws = gZenWorkspaces.getWorkspaces().find(w => w.name === name);
  await gZenWorkspaces.changeWorkspace(ws);
  await waitFor(() => gZenWorkspaces.activeWorkspace === ws.uuid, "switching to " + name);
  return ws;
}
"""


def build_test_xpi(path):
    """Packs the extension with a check every 6 seconds instead of every minute."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, _, files in os.walk(EXTENSION):
            for file in files:
                full = os.path.join(base, file)
                rel = os.path.relpath(full, EXTENSION)
                data = open(full, "rb").read()
                if rel == "background.js":
                    text = data.decode()
                    patched = text.replace(
                        "const CHECK_PERIOD_MINUTES = 1;",
                        "const CHECK_PERIOD_MINUTES = 0.1;",
                    )
                    assert patched != text, "check period not found"
                    data = patched.encode()
                zf.writestr(rel, data)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_http_server(names):
    """Serves one test page per name, titled with that name."""
    root = tempfile.mkdtemp(prefix="zen-tab-sleep-www-")
    for name in names:
        with open(os.path.join(root, f"{name}.html"), "w") as fh:
            fh.write(f"<!DOCTYPE html><title>{name}</title><p>{name}</p>")
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=root))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, root


def write_profile(profile, marionette_port):
    prefs = {
        "marionette.port": marionette_port,
        "intl.locale.requested": "en-US",
        "zen.welcome-screen.seen": True,
        "browser.aboutwelcome.enabled": False,
        "browser.shell.checkDefaultBrowser": False,
        "browser.warnOnQuit": False,
        "browser.tabs.warnOnClose": False,
        "datareporting.policy.dataSubmissionEnabled": False,
        "toolkit.telemetry.reportingpolicy.firstRun": False,
        "xpinstall.signatures.required": False,
        "extensions.webextensions.uuids": json.dumps({ADDON_ID: ADDON_UUID}),
        # Suspend the event page after 2 s of idle time: tests waking it up.
        "extensions.background.idle.timeout": 2000,
        "devtools.console.stdout.content": True,
    }
    with open(os.path.join(profile, "user.js"), "w") as fh:
        for key, value in prefs.items():
            fh.write(f"user_pref({json.dumps(key)}, {json.dumps(value)});\n")


def launch(binary, profile, log):
    env = dict(os.environ, MOZ_HEADLESS="1", MOZ_MARIONETTE="1", MOZ_LEGACY_PROFILES="1")
    return subprocess.Popen(
        [binary, "-profile", profile, "-no-remote", "--headless", "--marionette",
         "-remote-allow-system-access"],
        stdout=log, stderr=subprocess.STDOUT, env=env)


def stop(proc, profile):
    time.sleep(2)
    if proc.poll() is None:
        proc.kill()
    subprocess.run(["pkill", "-f", profile], check=False)


def extension_errors(log_path):
    """Log lines that come from the extension (the test build logs nothing else)."""
    with open(log_path, errors="replace") as fh:
        return [line.strip() for line in fh
                if ADDON_UUID in line or "[Zen Tab Sleep]" in line]


def wait_for_states(m, expected, timeout=45):
    """Waits until the tabs reach the expected states (or time runs out)."""
    deadline = time.time() + timeout
    names = list(expected)
    while True:
        states = m.js("return describe(arguments[0]);", names)
        if states == expected or time.time() > deadline:
            return states
        time.sleep(1)
