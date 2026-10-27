"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const EXTENSION = path.join(__dirname, "..", "extension");
const LOCALES = path.join(EXTENSION, "_locales");

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const locales = fs.readdirSync(LOCALES);
const messages = Object.fromEntries(
  locales.map(locale => [locale, readJson(path.join(LOCALES, locale, "messages.json"))])
);

// Every message key the extension asks for, from data-i18n attributes,
// t("…") calls and __MSG_…__ references.
function usedKeys() {
  const keys = new Set();
  for (const file of fs.readdirSync(EXTENSION)) {
    if (!/\.(html|js|json)$/.test(file)) {
      continue;
    }
    const source = fs.readFileSync(path.join(EXTENSION, file), "utf8");
    for (const match of source.matchAll(/data-i18n="([^"]+)"/g)) keys.add(match[1]);
    for (const match of source.matchAll(/\bt\("([^"]+)"/g)) keys.add(match[1]);
    for (const match of source.matchAll(/__MSG_(\w+)__/g)) keys.add(match[1]);
  }
  // Built from a lookup table in popup.js.
  for (const match of fs
    .readFileSync(path.join(EXTENSION, "popup.js"), "utf8")
    .matchAll(/: "(status\w+)"/g)) {
    keys.add(match[1]);
  }
  return keys;
}

test("default locale exists", () => {
  const manifest = readJson(path.join(EXTENSION, "manifest.json"));
  assert.ok(locales.includes(manifest.default_locale));
});

test("all locales have the same keys and placeholders", () => {
  const [reference, ...others] = locales;
  for (const locale of others) {
    assert.deepEqual(
      Object.keys(messages[locale]).sort(),
      Object.keys(messages[reference]).sort(),
      `${locale} and ${reference} differ in keys`
    );
    for (const [key, entry] of Object.entries(messages[reference])) {
      assert.deepEqual(
        Object.keys(messages[locale][key].placeholders || {}).sort(),
        Object.keys(entry.placeholders || {}).sort(),
        `${locale}: placeholders of "${key}" differ`
      );
    }
  }
});

test("placeholders used in a message are defined, and vice versa", () => {
  for (const [locale, entries] of Object.entries(messages)) {
    for (const [key, entry] of Object.entries(entries)) {
      const used = [...entry.message.matchAll(/\$(\w+)\$/g)].map(m => m[1].toLowerCase());
      const defined = Object.keys(entry.placeholders || {});
      assert.deepEqual(used.sort(), defined.sort(), `${locale}: "${key}"`);
    }
  }
});

test("every key the code uses exists, and every existing key is used", () => {
  const used = usedKeys();
  for (const locale of locales) {
    const defined = new Set(Object.keys(messages[locale]));
    for (const key of used) {
      assert.ok(defined.has(key), `${locale} is missing "${key}"`);
    }
    for (const key of defined) {
      assert.ok(used.has(key), `${locale}: "${key}" is never used`);
    }
  }
});
