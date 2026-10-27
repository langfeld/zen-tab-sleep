"use strict";

/* global loadSettings, saveSettings, parseExclusions, classifyPinnedTabs,
   evaluateTab, selectTabsToSleep, siteHost, normalizeHost, hasHostLine,
   toggleHostLine */

const ALARM_NAME = "tab-sleep-check";
const CHECK_PERIOD_MINUTES = 1;

const MENU_KEEP_TAB = "keep-tab";
const MENU_KEEP_SITE = "keep-site";

const t = (key, ...substitutions) =>
  browser.i18n.getMessage(key, substitutions.map(String));

// Zen reports itself as Firefox, but adds a "zen" field.
const isZen = browser.runtime
  .getBrowserInfo()
  .then(info => !!info.zen, () => false);

// --- Session state -----------------------------------------------------------
//
// Zen only hands the tabs of the active workspace to extensions. Tabs in other
// workspaces can only be reached by their ID, so the extension remembers every
// tab it has seen once. Tab IDs are only valid until the browser restarts,
// which is why all of this lives in storage.session.

async function loadState() {
  const { state } = await browser.storage.session.get("state");
  return {
    registry: {},
    stats: { lastCheck: 0, lastSlept: 0, totalSlept: 0 },
    menusReady: false,
    ...state,
  };
}

function saveState(state) {
  return browser.storage.session.set({ state });
}

// Events and checks change the same state, so they run one after another.
let queue = Promise.resolve();
function serialized(task) {
  const run = queue.then(task);
  queue = run.catch(error => console.error("[Zen Tab Sleep]", error));
  return run;
}

// --- Startup -----------------------------------------------------------------

// Without this listener Firefox doesn't load the script at browser startup, and
// the alarm would be missing: Firefox forgets alarms when it quits.
browser.runtime.onStartup.addListener(() => {});

serialized(async () => {
  if (!(await browser.alarms.get(ALARM_NAME))) {
    await browser.alarms.create(ALARM_NAME, {
      periodInMinutes: CHECK_PERIOD_MINUTES,
    });
  }
  const state = await loadState();
  if (!state.menusReady) {
    await browser.menus.removeAll();
    browser.menus.create({
      id: MENU_KEEP_TAB,
      type: "checkbox",
      contexts: ["tab"],
      title: t("keepTab"),
    });
    browser.menus.create({
      id: MENU_KEEP_SITE,
      type: "checkbox",
      contexts: ["tab"],
      title: t("keepSiteGeneric"),
    });
    state.menusReady = true;
    await saveState(state);
  }
});

// --- Tracking tabs -----------------------------------------------------------

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    return serialized(runCheck);
  }
  return undefined;
});

browser.tabs.onCreated.addListener(tab =>
  serialized(() => rememberTabs([tab.id]))
);

// Catches tabs that were opened briefly in another workspace and never seen
// by a check.
browser.tabs.onActivated.addListener(({ tabId, previousTabId }) =>
  serialized(() => rememberTabs([tabId, previousTabId]))
);

browser.tabs.onRemoved.addListener(tabId =>
  serialized(async () => {
    const state = await loadState();
    if (state.registry[tabId]) {
      delete state.registry[tabId];
      await saveState(state);
    }
  })
);

// Moving a pinned tab (to the Essentials, for example) and pinning or
// unpinning it invalidate how it was classified.
browser.tabs.onMoved.addListener(tabId =>
  serialized(() => resetPinState(tabId))
);
browser.tabs.onUpdated.addListener(
  tabId => serialized(() => resetPinState(tabId)),
  { properties: ["pinned"] }
);

async function rememberTabs(tabIds) {
  const state = await loadState();
  let changed = false;
  for (const id of tabIds) {
    if (Number.isInteger(id) && id >= 0 && !state.registry[id]) {
      state.registry[id] = {};
      changed = true;
    }
  }
  if (changed) {
    await saveState(state);
  }
}

async function resetPinState(tabId) {
  const state = await loadState();
  const record = state.registry[tabId];
  if (record && (record.absentChecks || record.workspacePin)) {
    delete record.absentChecks;
    delete record.workspacePin;
    await saveState(state);
  }
}

// --- Checking and putting tabs to sleep --------------------------------------

// Every tab that currently exists and is known to the extension, plus the IDs
// of the visible ones (active workspace and Essentials of every window).
async function collectTabs(state) {
  const visible = await browser.tabs.query({});
  const visibleIds = new Set();
  for (const tab of visible) {
    visibleIds.add(tab.id);
    state.registry[tab.id] ??= {};
  }
  const hiddenIds = Object.keys(state.registry)
    .map(Number)
    .filter(id => !visibleIds.has(id));
  const results = await Promise.allSettled(
    hiddenIds.map(id => browser.tabs.get(id))
  );
  const tabs = [...visible];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      tabs.push(result.value);
    } else {
      // Closed without us noticing.
      delete state.registry[hiddenIds[i]];
    }
  });
  return { tabs, visibleIds };
}

// Zen creates a split view as a tab group without a title, while folders have
// a name. In Zen, groups that can't be looked up count as split views, to be
// safe.
async function loadGroupTitles() {
  const titles = new Map();
  if (!browser.tabGroups) {
    return titles;
  }
  try {
    for (const group of await browser.tabGroups.query({})) {
      titles.set(group.id, group.title || "");
    }
  } catch (error) {
    console.warn("[Zen Tab Sleep] Can't read tab groups:", error);
  }
  return titles;
}

function buildContext(settings, state, tabs) {
  return {
    settings,
    rules: parseExclusions(settings.exclusions).rules,
    now: Date.now(),
    registry: state.registry,
    activeSplitViewIds: new Set(
      tabs
        .filter(tab => tab.active && tab.splitViewId > -1)
        .map(tab => tab.splitViewId)
    ),
  };
}

async function runCheck() {
  const settings = await loadSettings();
  const state = await loadState();
  const { tabs, visibleIds } = await collectTabs(state);
  const groupTitles = await loadGroupTitles();
  const isFolder = groupId => !!groupTitles.get(groupId);
  classifyPinnedTabs(tabs, visibleIds, state.registry, isFolder);
  state.stats.lastCheck = Date.now();

  let slept = 0;
  if (settings.enabled) {
    const ctx = buildContext(settings, state, tabs);
    const verdicts = new Map(tabs.map(tab => [tab.id, evaluateTab(tab, ctx)]));
    // Only Zen unloads a whole split view when one of its tabs is unloaded.
    const zen = await isZen;
    const ids = selectTabsToSleep(
      tabs,
      verdicts,
      groupId => zen && !isFolder(groupId)
    );
    slept = await sleepTabs(ids);
    state.stats.lastSlept = slept;
    state.stats.totalSlept += slept;
  }
  await saveState(state);
  return slept;
}

async function sleepTabs(ids) {
  if (!ids.length) {
    return 0;
  }
  await Promise.allSettled(ids.map(id => browser.tabs.discard(id)));
  // Firefox keeps pages awake that would ask before being left.
  const after = await Promise.allSettled(ids.map(id => browser.tabs.get(id)));
  return after.filter(r => r.status === "fulfilled" && r.value.discarded)
    .length;
}

// --- Popup and context menu --------------------------------------------------

async function getStatus(tabId) {
  const settings = await loadSettings();
  const state = await loadState();
  const tab = await browser.tabs.get(tabId);
  const record = state.registry[tab.id] || {};
  // Classify on a copy, so a tab just dragged into a folder shows correctly
  // before the next check.
  const groupTitles = await loadGroupTitles();
  const registry = { [tab.id]: { ...record } };
  classifyPinnedTabs([tab], new Set([tab.id]), registry, groupId =>
    !!groupTitles.get(groupId)
  );
  const verdict = evaluateTab(
    tab,
    buildContext(settings, { ...state, registry }, [tab])
  );
  const host = siteHost(tab.url);
  return {
    verdict,
    settings,
    stats: state.stats,
    knownTabs: Object.keys(state.registry).length,
    keepTab: !!record.manual,
    host,
    keepSite: !!host && hasHostLine(settings.exclusions, host),
  };
}

async function setKeepTab(tabId, keep) {
  const state = await loadState();
  const record = (state.registry[tabId] ??= {});
  if (keep) {
    record.manual = true;
  } else {
    delete record.manual;
  }
  await saveState(state);
}

async function setKeepSite(host, keep) {
  // Only accept a single, already normalized domain.
  if (typeof host !== "string" || normalizeHost(host) !== host) {
    return;
  }
  const settings = await loadSettings();
  if (hasHostLine(settings.exclusions, host) !== keep) {
    await saveSettings({
      exclusions: toggleHostLine(settings.exclusions, host),
    });
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id) {
    return undefined;
  }
  switch (message?.command) {
    case "getStatus":
      return serialized(() => getStatus(message.tabId));
    case "setKeepTab":
      return serialized(() => setKeepTab(message.tabId, !!message.keep));
    case "setKeepSite":
      return serialized(() => setKeepSite(message.host, !!message.keep));
    case "checkNow":
      return serialized(runCheck);
    default:
      return undefined;
  }
});

browser.menus.onShown.addListener(async (info, tab) => {
  if (!info.contexts.includes("tab") || !(tab?.id >= 0)) {
    return;
  }
  let status;
  try {
    status = await serialized(() => getStatus(tab.id));
  } catch {
    return; // The tab was closed in the meantime.
  }
  await browser.menus.update(MENU_KEEP_TAB, { checked: status.keepTab });
  await browser.menus.update(MENU_KEEP_SITE, {
    checked: status.keepSite,
    enabled: !!status.host,
    title: status.host ? t("keepSite", status.host) : t("keepSiteGeneric"),
  });
  browser.menus.refresh();
});

// The next time the menu opens, Firefox first shows the old state until
// onShown is done. Reset to neutral, so checkmarks of another tab never show.
browser.menus.onHidden.addListener(async () => {
  await browser.menus.update(MENU_KEEP_TAB, { checked: false });
  await browser.menus.update(MENU_KEEP_SITE, {
    checked: false,
    enabled: true,
    title: t("keepSiteGeneric"),
  });
});

browser.menus.onClicked.addListener((info, tab) => {
  if (!tab) {
    return undefined;
  }
  if (info.menuItemId === MENU_KEEP_TAB) {
    return serialized(() => setKeepTab(tab.id, info.checked));
  }
  if (info.menuItemId === MENU_KEEP_SITE) {
    const host = siteHost(tab.url);
    if (host) {
      return serialized(() => setKeepSite(host, info.checked));
    }
  }
  return undefined;
});
