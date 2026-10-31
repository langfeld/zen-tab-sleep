"use strict";

// Logic shared by the background script and the popup.

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  timeoutMinutes: 30,
  protectEssentials: true,
  protectWorkspacePins: false,
  protectAudible: true,
  exclusions: "",
});

const MIN_TIMEOUT_MINUTES = 1;
const MAX_TIMEOUT_MINUTES = 7 * 24 * 60;

const BOOLEAN_SETTINGS = [
  "enabled",
  "protectEssentials",
  "protectWorkspacePins",
  "protectAudible",
];

function normalizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") {
    return settings;
  }
  for (const key of BOOLEAN_SETTINGS) {
    if (typeof raw[key] === "boolean") {
      settings[key] = raw[key];
    }
  }
  if (isValidTimeout(raw.timeoutMinutes)) {
    settings.timeoutMinutes = raw.timeoutMinutes;
  }
  if (typeof raw.exclusions === "string") {
    settings.exclusions = raw.exclusions;
  }
  return settings;
}

function isValidTimeout(value) {
  return (
    Number.isInteger(value) &&
    value >= MIN_TIMEOUT_MINUTES &&
    value <= MAX_TIMEOUT_MINUTES
  );
}

async function loadSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return normalizeSettings(settings);
}

async function saveSettings(patch) {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await browser.storage.local.set({ settings: next });
  return next;
}

// --- Exception list ----------------------------------------------------------
//
// One rule per line, "#" starts a comment:
//   github.com                 the domain including its subdomains
//   https://example.com/app    every address that starts like this
//   *://*.example.com/*.pdf    pattern over the whole address, * = anything

function parseExclusions(text) {
  const rules = [];
  const invalid = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const rule = parseRule(line);
    if (rule) {
      rules.push(rule);
    } else {
      invalid.push(line);
    }
  }
  return { rules, invalid };
}

function parseRule(line) {
  if (/^\*\.[^/*]+$/.test(line)) {
    return hostRule(line.slice(2));
  }
  if (line.includes("*") || line.includes("/")) {
    let pattern = line.includes("://") ? line : `*://${line}`;
    if (!line.includes("*")) {
      pattern += "*";
    }
    return { type: "pattern", regex: globToRegExp(pattern) };
  }
  return hostRule(line);
}

function hostRule(text) {
  const host = normalizeHost(text);
  return host ? { type: "host", host } : null;
}

function normalizeHost(text) {
  if (!text || /[\s/@?#*]/.test(text)) {
    return null;
  }
  try {
    // URL converts internationalized domains to punycode, as found in tab.url.
    const { hostname } = new URL(`http://${text}`);
    return hostname.replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

function globToRegExp(glob) {
  const source = glob
    .split("*")
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "i");
}

function isExcluded(url, rules) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return rules.some(rule =>
    rule.type === "host"
      ? host === rule.host || host.endsWith(`.${rule.host}`)
      : rule.regex.test(url)
  );
}

// A tab's domain as the context menu adds it to the exception list.
function siteHost(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return normalizeHost(parsed.hostname);
  } catch {
    return null;
  }
}

function hasHostLine(text, host) {
  return String(text)
    .split(/\r?\n/)
    .some(line => lineHost(line) === host);
}

function toggleHostLine(text, host) {
  const lines = String(text).split(/\r?\n/);
  const kept = lines.filter(line => lineHost(line) !== host);
  if (kept.length === lines.length) {
    kept.push(host);
  }
  while (kept.length && !kept[kept.length - 1].trim()) {
    kept.pop();
  }
  while (kept.length && !kept[0].trim()) {
    kept.shift();
  }
  return kept.join("\n");
}

function lineHost(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const rule = parseRule(trimmed);
  return rule?.type === "host" ? rule.host : null;
}

// --- Evaluating a tab --------------------------------------------------------

function isSleepableUrl(url) {
  return /^(https?|file):/i.test(url || "");
}

function isSharing(tab) {
  const sharing = tab.sharingState;
  return !!(sharing && (sharing.camera || sharing.microphone || sharing.screen));
}

function hasSplitView(tab) {
  return Number.isInteger(tab.splitViewId) && tab.splitViewId !== -1;
}

/**
 * Whether a pinned tab is certainly a workspace tab and not an Essential.
 *
 * Only tabs in folders are: Zen removes a tab from the Essentials as soon as
 * it is moved into a folder, and pins every folder tab. Whether a tab is
 * visible tells nothing, because Zen keeps separate Essentials per container
 * and hides those of other containers from extensions, just like tabs of
 * other workspaces.
 *
 * @param {object} tab
 * @param {(groupId: number) => boolean} isFolder
 */
function isFolderTab(tab, isFolder) {
  const groupId = tab.groupId ?? -1;
  return groupId !== -1 && isFolder(groupId);
}

/**
 * Evaluates a single tab, ignoring groups.
 *
 * @param {object} tab Tab from the tabs API
 * @param {object} ctx { settings, rules, now, registry, isFolder,
 *   activeSplitViewIds }
 * @returns {{reason: string, sleepsAt?: number}} "due" means put it to sleep
 *   now, "waiting" means not inactive for long enough yet; anything else means
 *   protected or not possible.
 */
function evaluateTab(tab, ctx) {
  const { settings } = ctx;
  if (tab.discarded) {
    return { reason: "asleep" };
  }
  if (!isSleepableUrl(tab.url)) {
    return { reason: "unsupported" };
  }
  if (isSharing(tab)) {
    return { reason: "sharing" };
  }
  if (settings.protectAudible && tab.audible) {
    return { reason: "audible" };
  }
  const record = ctx.registry[tab.id] || {};
  if (record.manual) {
    return { reason: "manual" };
  }
  if (isExcluded(tab.url, ctx.rules)) {
    return { reason: "excluded" };
  }
  if (tab.pinned) {
    if (isFolderTab(tab, ctx.isFolder)) {
      if (settings.protectWorkspacePins) {
        return { reason: "workspacePin" };
      }
    } else if (settings.protectEssentials || settings.protectWorkspacePins) {
      // It might be an Essential, so it stays awake.
      return { reason: "essential" };
    }
  }
  if (tab.active) {
    return { reason: "active" };
  }
  if (hasSplitView(tab) && ctx.activeSplitViewIds.has(tab.splitViewId)) {
    return { reason: "splitView" };
  }
  if (!Number.isFinite(tab.lastAccessed)) {
    return { reason: "unknown" };
  }
  const sleepsAt = tab.lastAccessed + settings.timeoutMinutes * 60 * 1000;
  return { reason: sleepsAt <= ctx.now ? "due" : "waiting", sleepsAt };
}

/**
 * Picks the tabs to put to sleep now.
 *
 * Zen always unloads a split view as a whole as soon as one of its tabs is
 * unloaded. Tabs in such groups therefore only go to sleep together, once
 * every member is due.
 *
 * @param {object[]} tabs
 * @param {Map<number, object>} verdicts Result of evaluateTab per tab ID
 * @param {(groupId: number) => boolean} isUnitGroup
 * @returns {number[]} IDs of the tabs to put to sleep
 */
function selectTabsToSleep(tabs, verdicts, isUnitGroup) {
  const selected = [];
  const groups = new Map();
  for (const tab of tabs) {
    const groupId = tab.groupId ?? -1;
    if (groupId !== -1 && isUnitGroup(groupId)) {
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId).push(tab);
    } else if (verdicts.get(tab.id)?.reason === "due") {
      selected.push(tab.id);
    }
  }
  for (const members of groups.values()) {
    const reasons = members.map(tab => verdicts.get(tab.id)?.reason);
    const allReady = reasons.every(r => r === "due" || r === "asleep");
    if (allReady) {
      selected.push(
        ...members.filter((_, i) => reasons[i] === "due").map(tab => tab.id)
      );
    }
  }
  return selected;
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_SETTINGS,
    MIN_TIMEOUT_MINUTES,
    MAX_TIMEOUT_MINUTES,
    normalizeSettings,
    isValidTimeout,
    parseExclusions,
    isExcluded,
    siteHost,
    hasHostLine,
    toggleHostLine,
    evaluateTab,
    selectTabsToSleep,
  };
}
