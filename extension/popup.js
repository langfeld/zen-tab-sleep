"use strict";

/* global loadSettings, saveSettings, parseExclusions, isValidTimeout */

const $ = id => document.getElementById(id);
const t = (key, ...substitutions) =>
  browser.i18n.getMessage(key, substitutions.map(String));

const isOptionsPage = new URLSearchParams(location.search).has("options");
const CHECKBOX_SETTINGS = [
  "enabled",
  "protectEssentials",
  "protectWorkspacePins",
  "protectAudible",
];

const REASON_MESSAGES = {
  asleep: "statusAsleep",
  unsupported: "statusUnsupported",
  sharing: "statusSharing",
  audible: "statusAudible",
  manual: "statusManual",
  excluded: "statusExcluded",
  essential: "statusEssential",
  workspacePin: "statusWorkspacePin",
};

let currentTabId = null;

function localize() {
  document.documentElement.lang = browser.i18n.getUILanguage();
  document.title = t("extensionName");
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  $("exclusions").placeholder = t("exclusionsPlaceholder");
}

// Save one change after another, so quick edits don't overwrite each other.
let saving = Promise.resolve();
function save(patch) {
  saving = saving
    .then(() => saveSettings(patch))
    .then(() => flash(t("saved")))
    .catch(error => flash(t("error", error.message)));
  return saving;
}

let flashTimer;
function flash(text) {
  $("feedback").textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ($("feedback").textContent = ""), 2000);
}

function send(command, data = {}) {
  return browser.runtime.sendMessage({ command, ...data });
}

// Don't overwrite a field someone is typing in. activeElement stays set while
// the page is in the background, hence hasFocus().
function isEditing(field) {
  return document.hasFocus() && document.activeElement === field;
}

function fillSettings(settings) {
  for (const key of CHECKBOX_SETTINGS) {
    $(key).checked = settings[key];
  }
  if (!isEditing($("timeout"))) {
    $("timeout").value = settings.timeoutMinutes;
  }
  if (!isEditing($("exclusions"))) {
    $("exclusions").value = settings.exclusions;
    showInvalidExclusions(settings.exclusions);
  }
}

function showInvalidExclusions(text) {
  const { invalid } = parseExclusions(text);
  $("exclusionsError").hidden = !invalid.length;
  $("exclusionsError").textContent = invalid.length
    ? t("exclusionsInvalid", invalid.join(", "))
    : "";
}

function bindSettings() {
  for (const key of CHECKBOX_SETTINGS) {
    $(key).addEventListener("change", () => save({ [key]: $(key).checked }));
  }
  $("timeout").addEventListener("change", () => {
    const value = Number($("timeout").value);
    const valid = isValidTimeout(value);
    $("timeoutError").hidden = valid;
    if (valid) {
      save({ timeoutMinutes: value });
    }
  });
  // Save on every keystroke: a popup can close before a "change" event fires.
  $("exclusions").addEventListener("input", () => {
    showInvalidExclusions($("exclusions").value);
    save({ exclusions: $("exclusions").value });
  });
  $("checkNow").addEventListener("click", checkNow);
  $("keepTab").addEventListener("change", async () => {
    await send("setKeepTab", { tabId: currentTabId, keep: $("keepTab").checked });
    await refreshStatus();
  });
  $("keepSite").addEventListener("change", async () => {
    await send("setKeepSite", {
      host: $("keepSite").dataset.host,
      keep: $("keepSite").checked,
    });
    fillSettings(await loadSettings());
    await refreshStatus();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      loadSettings().then(fillSettings);
    }
  });
}

async function checkNow() {
  $("checkNow").disabled = true;
  try {
    const slept = await send("checkNow");
    flash(slept === 1 ? t("sleptOne") : t("sleptMany", slept));
    await refreshStatus();
  } catch (error) {
    flash(t("error", error.message));
  } finally {
    $("checkNow").disabled = false;
  }
}

function describeStatus(status) {
  const { verdict, settings } = status;
  if (!settings.enabled) {
    return t("statusDisabled");
  }
  const key = REASON_MESSAGES[verdict.reason];
  return key ? t(key) : t("statusSleepsAfter", settings.timeoutMinutes);
}

function describeStats(stats, knownTabs) {
  const parts = [t("statsTotal", stats.totalSlept)];
  if (stats.lastCheck) {
    const minutes = Math.round((Date.now() - stats.lastCheck) / 60000);
    parts.push(minutes < 1 ? t("statsCheckedNow") : t("statsCheckedAgo", minutes));
  }
  parts.push(t("statsKnown", knownTabs));
  return parts.join(" · ");
}

async function refreshStatus() {
  if (currentTabId === null) {
    return;
  }
  try {
    const status = await send("getStatus", { tabId: currentTabId });
    $("status").textContent = describeStatus(status);
    $("keepTab").checked = status.keepTab;
    $("keepSiteRow").hidden = !status.host;
    $("keepSite").checked = status.keepSite;
    $("keepSite").dataset.host = status.host || "";
    $("keepSiteLabel").textContent = status.host
      ? t("keepSite", status.host)
      : t("keepSiteGeneric");
    $("stats").textContent = describeStats(status.stats, status.knownTabs);
  } catch (error) {
    $("status").textContent = t("statusUnavailable");
    $("keepTab").disabled = true;
    $("keepSiteRow").hidden = true;
  }
}

async function init() {
  localize();
  document.body.classList.toggle("options", isOptionsPage);
  fillSettings(await loadSettings());
  bindSettings();
  if (isOptionsPage) {
    $("current").hidden = true;
    return;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab ? tab.id : null;
  await refreshStatus();
}

init().catch(error => flash(t("error", error.message)));
