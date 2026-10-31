"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../extension/core.js");

const NOW = 1_800_000_000_000;
const MINUTE = 60 * 1000;

function makeCtx(overrides = {}) {
  const settings = core.normalizeSettings(overrides.settings);
  return {
    settings,
    rules: core.parseExclusions(settings.exclusions).rules,
    now: NOW,
    registry: overrides.registry || {},
    isFolder: overrides.isFolder || (() => false),
    activeSplitViewIds: overrides.activeSplitViewIds || new Set(),
  };
}

function makeTab(overrides = {}) {
  return {
    id: 1,
    url: "https://example.org/",
    active: false,
    pinned: false,
    discarded: false,
    audible: false,
    lastAccessed: NOW - 60 * MINUTE,
    groupId: -1,
    splitViewId: -1,
    ...overrides,
  };
}

test("normalizeSettings: defaults and invalid input", () => {
  assert.deepEqual(core.normalizeSettings(undefined), core.DEFAULT_SETTINGS);
  for (const bad of [0, -5, 0.5, 30.5, NaN, "30", null, 10081]) {
    assert.equal(
      core.normalizeSettings({ timeoutMinutes: bad }).timeoutMinutes,
      30,
      `timeoutMinutes ${bad} must be rejected`
    );
  }
  assert.equal(core.normalizeSettings({ timeoutMinutes: 1 }).timeoutMinutes, 1);
  assert.equal(core.normalizeSettings({ enabled: "no" }).enabled, true);
  assert.equal(core.normalizeSettings({ enabled: false }).enabled, false);
});

test("exceptions: domains include their subdomains", () => {
  const { rules, invalid } = core.parseExclusions(
    "# comment\ngithub.com\n\n*.slack.com\nWWW.Spiegel.DE\nmüller.de"
  );
  assert.deepEqual(invalid, []);
  const ex = url => core.isExcluded(url, rules);
  assert.ok(ex("https://github.com/"));
  assert.ok(ex("https://gist.github.com/x"));
  assert.ok(!ex("https://notgithub.com/"));
  assert.ok(!ex("https://github.com.evil.org/"));
  assert.ok(ex("https://app.slack.com/client"));
  assert.ok(ex("https://slack.com/"));
  assert.ok(ex("https://www.spiegel.de/"));
  assert.ok(ex("https://spiegel.de/"));
  assert.ok(ex("https://xn--mller-kva.de/"));
});

test("exceptions: address prefixes and patterns", () => {
  const { rules, invalid } = core.parseExclusions(
    "https://example.com/app\ngithub.com/mozilla\n*://*.example.net/*.pdf"
  );
  assert.deepEqual(invalid, []);
  const ex = url => core.isExcluded(url, rules);
  assert.ok(ex("https://example.com/app"));
  assert.ok(ex("https://example.com/app/inbox?x=1"));
  assert.ok(!ex("https://example.com/other"));
  assert.ok(ex("https://github.com/mozilla/gecko-dev"));
  assert.ok(!ex("https://github.com/other"));
  assert.ok(ex("https://docs.example.net/files/a.PDF"));
  assert.ok(!ex("https://docs.example.net/files/a.html"));
});

test("exceptions: lines that can't be parsed are reported", () => {
  const { rules, invalid } = core.parseExclusions("not valid\nfoo@bar\n[");
  assert.equal(rules.length, 0);
  assert.deepEqual(invalid, ["not valid", "foo@bar", "["]);
});

test("context menu: toggling a domain line", () => {
  assert.equal(core.siteHost("https://www.github.com/a"), "github.com");
  assert.equal(core.siteHost("about:config"), null);
  assert.equal(core.siteHost("file:///home/x.html"), null);

  let text = "# my list\nexample.com";
  text = core.toggleHostLine(text, "github.com");
  assert.equal(text, "# my list\nexample.com\ngithub.com");
  assert.ok(core.hasHostLine(text, "github.com"));
  text = core.toggleHostLine(text, "github.com");
  assert.equal(text, "# my list\nexample.com");
  assert.ok(!core.hasHostLine(text, "github.com"));
  assert.equal(core.toggleHostLine("", "a.de"), "a.de");
  // "www.github.com" in the list is the same domain.
  assert.ok(core.hasHostLine("www.github.com", "github.com"));
});

test("evaluateTab: regular tabs sleep once the time is up", () => {
  const ctx = makeCtx();
  assert.equal(core.evaluateTab(makeTab(), ctx).reason, "due");
  const fresh = makeTab({ lastAccessed: NOW - 5 * MINUTE });
  const verdict = core.evaluateTab(fresh, ctx);
  assert.equal(verdict.reason, "waiting");
  assert.equal(verdict.sleepsAt, NOW + 25 * MINUTE);
});

test("evaluateTab: protection rules", () => {
  const ctx = makeCtx({
    settings: { exclusions: "protected.de" },
    registry: { 7: { manual: true } },
  });
  const reason = tab => core.evaluateTab(makeTab(tab), ctx).reason;
  assert.equal(reason({ discarded: true }), "asleep");
  assert.equal(reason({ url: "about:preferences" }), "unsupported");
  assert.equal(reason({ url: "moz-extension://x/popup.html" }), "unsupported");
  assert.equal(reason({ active: true }), "active");
  assert.equal(reason({ audible: true }), "audible");
  assert.equal(reason({ sharingState: { camera: true, microphone: false } }), "sharing");
  assert.equal(reason({ sharingState: { camera: false, microphone: false, screen: "Screen" } }), "sharing");
  assert.equal(reason({ sharingState: { camera: false, microphone: false } }), "due");
  assert.equal(reason({ id: 7 }), "manual");
  assert.equal(reason({ url: "https://www.protected.de/x" }), "excluded");
  assert.equal(reason({ lastAccessed: undefined }), "unknown");
});

test("evaluateTab: audio only protects when enabled", () => {
  const ctx = makeCtx({ settings: { protectAudible: false } });
  assert.equal(core.evaluateTab(makeTab({ audible: true }), ctx).reason, "due");
});

test("evaluateTab: pinned tabs outside folders could be Essentials", () => {
  const isFolder = groupId => groupId === 10;
  const pinned = makeTab({ id: 1, pinned: true });
  const folderTab = makeTab({ id: 2, pinned: true, groupId: 10 });
  const splitTab = makeTab({ id: 3, pinned: true, groupId: 20 });
  const reason = (tab, settings) =>
    core.evaluateTab(tab, makeCtx({ settings, isFolder })).reason;

  // Default: Essentials (any pinned tab outside a folder) stay awake, folder
  // tabs sleep.
  assert.equal(reason(pinned, {}), "essential");
  assert.equal(reason(splitTab, {}), "essential");
  assert.equal(reason(folderTab, {}), "due");
  // Protect folder tabs as well.
  assert.equal(reason(folderTab, { protectWorkspacePins: true }), "workspacePin");
  // Protect nothing.
  const none = { protectEssentials: false, protectWorkspacePins: false };
  assert.equal(reason(pinned, none), "due");
  assert.equal(reason(folderTab, none), "due");
  // Only workspace tabs protected: unclear ones stay awake to be safe.
  const onlyPins = { protectEssentials: false, protectWorkspacePins: true };
  assert.equal(reason(pinned, onlyPins), "essential");
});

test("evaluateTab: Essentials Zen hides from extensions stay awake", () => {
  // Zen hides the Essentials of other containers like tabs of other
  // workspaces; the extension then only reaches them by their ID. Whether a
  // tab was ever seen must not matter.
  const hiddenEssential = makeTab({ id: 4, pinned: true, lastAccessed: NOW - 600 * MINUTE });
  const ctx = makeCtx({ registry: { 4: {} } });
  assert.equal(core.evaluateTab(hiddenEssential, ctx).reason, "essential");
  // A former folder tab that became an Essential is judged by where it is now.
  const movedOut = makeTab({ id: 5, pinned: true, groupId: -1 });
  assert.equal(core.evaluateTab(movedOut, makeCtx({ isFolder: () => true })).reason, "essential");
});

test("evaluateTab: a Firefox split view next to the active tab stays awake", () => {
  const ctx = makeCtx({ activeSplitViewIds: new Set([5]) });
  assert.equal(core.evaluateTab(makeTab({ splitViewId: 5 }), ctx).reason, "splitView");
  assert.equal(core.evaluateTab(makeTab({ splitViewId: 6 }), ctx).reason, "due");
});

test("selectTabsToSleep: a Zen split view only sleeps as a whole", () => {
  const ctx = makeCtx();
  const tabs = [
    makeTab({ id: 1 }),
    makeTab({ id: 2, groupId: 10 }),
    makeTab({ id: 3, groupId: 10, active: true }),
    makeTab({ id: 4, groupId: 20 }),
    makeTab({ id: 5, groupId: 20 }),
    makeTab({ id: 6, groupId: 30 }),
    makeTab({ id: 7, groupId: 30, audible: true }),
    makeTab({ id: 8, groupId: 40 }),
    makeTab({ id: 9, groupId: 40, discarded: true }),
    makeTab({ id: 11, groupId: 50 }),
    makeTab({ id: 12, groupId: 50, active: true }),
  ];
  const verdicts = new Map(tabs.map(t => [t.id, core.evaluateTab(t, ctx)]));
  // Group 50 is a folder (it has a title); the other groups are split views
  // or unknown.
  const isUnitGroup = groupId => groupId !== 50;
  const ids = core.selectTabsToSleep(tabs, verdicts, isUnitGroup).sort((a, b) => a - b);
  // 1: on its own; 2: partner active -> no; 4+5: both due; 6: partner plays
  // audio -> no; 8: partner already asleep; 11: folder, evaluated alone.
  assert.deepEqual(ids, [1, 4, 5, 8, 11]);
});
