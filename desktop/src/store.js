// Tiny JSON store in the app's userData folder: the list of accounts (each
// one is just an id + optional label; the login itself lives in that
// account's Chromium session partition) and the last window bounds.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const FILE = () => path.join(app.getPath("userData"), "lolyfans-desktop.json");

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8"));
  } catch {
    return {};
  }
}

function write(patch) {
  const next = { ...read(), ...patch };
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(next, null, 2));
  return next;
}

/** @returns {{ id: string, label: string | null }[]} */
function loadAccounts() {
  const list = read().accounts;
  return Array.isArray(list) ? list : [];
}

function saveAccounts(accounts) {
  write({ accounts });
}

function loadWindowBounds() {
  const b = read().window;
  return b && typeof b.width === "number" ? b : null;
}

function saveWindowBounds(bounds) {
  write({ window: bounds });
}

function loadActiveId() {
  return read().activeId || null;
}

function saveActiveId(activeId) {
  write({ activeId });
}

module.exports = {
  loadAccounts,
  saveAccounts,
  loadWindowBounds,
  saveWindowBounds,
  loadActiveId,
  saveActiveId,
};
