// Lolyfans desktop: one window, a slim account rail on the left, and one
// isolated browser view per creator account on the right. Every account has
// its own Chromium session partition, so all of them stay logged in at the
// same time and switching is just showing a different view.
const {
  app,
  BaseWindow,
  WebContentsView,
  session,
  ipcMain,
  Menu,
  Notification,
  shell,
  nativeImage,
  dialog,
} = require("electron");
const path = require("path");
const crypto = require("crypto");
const store = require("./store");

const BASE_URL = (process.env.LOLYFANS_URL || "https://www.lolyfans.com").replace(/\/$/, "");
const BASE_HOST = new URL(BASE_URL).host;
const RAIL_WIDTH = 72;
const POLL_MS = 20_000;
// Creator sign-in lives at /creator (/login is the fan login page).
const LOGIN_URL = `${BASE_URL}/creator`;
const LOGIN_PATHS = new Set(["/login", "/creator"]);
const ICON = path.join(__dirname, "..", "build", "icon.png");

// Windows needs this for toast notifications and the taskbar overlay.
app.setAppUserModelId("com.lolyfans.desktop");
Menu.setApplicationMenu(null);

/** @type {BaseWindow | null} */
let win = null;
/** @type {WebContentsView | null} */
let rail = null;
let railReady = false;

/** @type {{ id: string, label: string | null }[]} */
let accounts = store.loadAccounts();
let activeId = store.loadActiveId();

/** accountId → WebContentsView */
const views = new Map();
/**
 * accountId → live status from /api/desktop/status
 * { name, avatarUrl, unread, loggedIn, lastSeenAt, chats }
 */
const status = new Map();
let pollTimer = null;

// ---------------------------------------------------------------------------
// Window + layout
// ---------------------------------------------------------------------------

function createWindow() {
  const saved = store.loadWindowBounds();
  win = new BaseWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 820,
    x: saved?.x,
    y: saved?.y,
    minWidth: 900,
    minHeight: 600,
    title: "Lolyfans",
    backgroundColor: "#0b0f14",
    icon: ICON,
    show: false,
  });

  rail = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  rail.setBackgroundColor("#0b0f14");
  win.contentView.addChildView(rail);
  rail.webContents.loadFile(path.join(__dirname, "rail", "index.html"));
  wireShortcuts(rail.webContents);

  win.on("resize", layout);
  win.on("move", persistBounds);
  win.on("resize", persistBounds);
  win.on("closed", () => {
    win = null;
    rail = null;
  });

  for (const account of accounts) createView(account);
  if (!accounts.length) addAccount();
  else showAccount(views.has(activeId) ? activeId : accounts[0].id);

  layout();
  // BaseWindow has no ready-to-show; show once the rail painted instead.
  rail.webContents.once("did-finish-load", () => win?.show());

  startPolling();
}

let boundsTimer = null;
function persistBounds() {
  if (!win) return;
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (win && !win.isMinimized()) store.saveWindowBounds(win.getBounds());
  }, 400);
}

function layout() {
  if (!win || !rail) return;
  const { width, height } = win.getContentBounds();
  rail.setBounds({ x: 0, y: 0, width: RAIL_WIDTH, height });
  for (const view of views.values()) {
    view.setBounds({ x: RAIL_WIDTH, y: 0, width: Math.max(0, width - RAIL_WIDTH), height });
  }
}

// ---------------------------------------------------------------------------
// Accounts + views
// ---------------------------------------------------------------------------

function partitionFor(id) {
  return `persist:account-${id}`;
}

function createView(account) {
  const ses = session.fromPartition(partitionFor(account.id));
  // The site may ask for notification / media permission; allow it — the
  // page is ours.
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(["notifications", "media", "clipboard-read", "clipboard-sanitized-write"].includes(permission));
  });

  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(account.id),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Accounts you're not looking at are hidden views. Chromium would
      // throttle their timers to ~1/min, stalling the inbox's 1-second
      // online check and realtime presence. Keep them ticking like the
      // web app does, so every account's green dots stay accurate.
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor("#0b0f14");
  view.setVisible(false);
  win.contentView.addChildView(view);
  views.set(account.id, view);
  status.set(account.id, {
    name: account.label || "Account",
    avatarUrl: null,
    unread: 0,
    loggedIn: null, // unknown until the first navigation / poll
    lastSeenAt: null,
    chats: [],
  });

  const wc = view.webContents;
  wireShortcuts(wc);

  // Links that open a new window: same site → this view; anything else →
  // the default browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (sameSite(url)) wc.loadURL(url);
    else shell.openExternal(url);
    return { action: "deny" };
  });

  wc.on("did-navigate", (_e, url) => onNavigated(account.id, url));
  wc.on("did-navigate-in-page", (_e, url) => onNavigated(account.id, url));
  wc.on("page-title-updated", (e) => e.preventDefault());

  wc.loadURL(`${BASE_URL}/inbox`);
  layout();
  return view;
}

function sameSite(url) {
  try {
    return new URL(url).host === BASE_HOST;
  } catch {
    return false;
  }
}

function onNavigated(id, url) {
  const s = status.get(id);
  if (!s) return;
  try {
    const { pathname } = new URL(url);
    if (LOGIN_PATHS.has(pathname)) {
      if (s.loggedIn !== false) {
        s.loggedIn = false;
        s.unread = 0;
        pushAccounts();
      }
    } else if (s.loggedIn === false) {
      // Left the login page → probably signed in; the next poll confirms.
      s.loggedIn = null;
      pushAccounts();
      void pollAccount(id);
    }
  } catch {
    // ignore
  }
}

function showAccount(id) {
  if (!views.has(id)) return;
  activeId = id;
  store.saveActiveId(id);
  for (const [accountId, view] of views) view.setVisible(accountId === id);
  const active = views.get(id);
  active?.webContents.focus();
  updateTitle();
  pushAccounts();
}

function addAccount() {
  const account = { id: crypto.randomUUID(), label: null };
  accounts.push(account);
  store.saveAccounts(accounts);
  createView(account);
  const view = views.get(account.id);
  view.webContents.loadURL(LOGIN_URL);
  showAccount(account.id);
}

async function removeAccount(id) {
  const view = views.get(id);
  if (!view) return;
  const s = status.get(id);
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Remove", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Remove account",
    message: `Remove ${s?.name || "this account"} from the app?`,
    detail: "This only signs the account out of the desktop app. Nothing on Lolyfans is changed.",
  });
  if (response !== 0) return;

  win.contentView.removeChildView(view);
  views.delete(id);
  status.delete(id);
  accounts = accounts.filter((a) => a.id !== id);
  store.saveAccounts(accounts);
  await view.webContents.session.clearStorageData().catch(() => {});
  view.webContents.close();

  if (!accounts.length) addAccount();
  else if (activeId === id) showAccount(accounts[0].id);
  else pushAccounts();
}

async function signOut(id) {
  const view = views.get(id);
  if (!view) return;
  await view.webContents.session.clearStorageData().catch(() => {});
  const s = status.get(id);
  if (s) {
    s.loggedIn = false;
    s.unread = 0;
    s.chats = [];
  }
  view.webContents.loadURL(LOGIN_URL);
  pushAccounts();
}

function renameAccount(id, label) {
  const account = accounts.find((a) => a.id === id);
  if (!account) return;
  account.label = (label || "").trim() || null;
  store.saveAccounts(accounts);
  pushAccounts();
}

function openChat(id, chatId) {
  const view = views.get(id);
  if (!view) return;
  showAccount(id);
  view.webContents.loadURL(`${BASE_URL}/inbox/${chatId}`);
}

// ---------------------------------------------------------------------------
// Status polling: unread badges + desktop notifications
// ---------------------------------------------------------------------------

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    for (const account of accounts) void pollAccount(account.id);
  }, POLL_MS);
  // First pass right away (after the pages had a moment to send cookies).
  setTimeout(() => {
    for (const account of accounts) void pollAccount(account.id);
  }, 2500);
}

async function pollAccount(id) {
  const view = views.get(id);
  const s = status.get(id);
  if (!view || !s) return;
  let data;
  try {
    // session.fetch sends this account's own cookies — no API key needed.
    const res = await view.webContents.session.fetch(`${BASE_URL}/api/desktop/status`, {
      headers: { accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });
    if (res.status === 401) {
      if (s.loggedIn !== false) {
        s.loggedIn = false;
        s.unread = 0;
        s.chats = [];
        pushAccounts();
      }
      return;
    }
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return; // offline / server hiccup — keep the last known state
  }

  const account = accounts.find((a) => a.id === id);
  const wasLoggedIn = s.loggedIn;
  s.loggedIn = true;
  s.name = account?.label || data.name || "Account";
  s.siteName = data.name || null;
  s.avatarUrl = data.avatarUrl || null;
  s.unread = Number(data.unread) || 0;
  s.chats = Array.isArray(data.chats) ? data.chats : [];

  // Notify for fan messages newer than what we've already seen. The first
  // successful poll only records the watermark so a fresh launch doesn't
  // replay the whole backlog.
  const newest = s.chats.reduce((max, c) => (c.at && c.at > max ? c.at : max), "");
  if (s.lastSeenAt !== null && wasLoggedIn) {
    const fresh = s.chats.filter((c) => c.fromFan && c.at && c.at > s.lastSeenAt);
    const activeAndFocused = id === activeId && win?.isFocused();
    if (fresh.length && !activeAndFocused) notify(id, s, fresh);
  }
  if (newest) s.lastSeenAt = newest;
  else if (s.lastSeenAt === null) s.lastSeenAt = new Date().toISOString();

  pushAccounts();
}

function notify(id, s, fresh) {
  if (!Notification.isSupported()) return;
  const [first] = fresh;
  const more = fresh.length - 1;
  const n = new Notification({
    title: `${s.siteName || s.name} · ${first.fanName}`,
    body: more > 0 ? `${first.preview}\n+${more} more ${more === 1 ? "chat" : "chats"}` : first.preview,
    icon: ICON,
    silent: false,
  });
  n.on("click", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    openChat(id, first.chatId);
  });
  n.show();
  if (win && !win.isFocused()) win.flashFrame(true);
}

function totalUnread() {
  let total = 0;
  for (const s of status.values()) total += s.loggedIn ? s.unread : 0;
  return total;
}

function updateTitle() {
  if (!win) return;
  const total = totalUnread();
  const s = status.get(activeId);
  const who = s?.siteName || s?.name;
  win.setTitle(`${total ? `(${total}) ` : ""}${who ? `${who} — ` : ""}Lolyfans`);
}

// ---------------------------------------------------------------------------
// Rail IPC
// ---------------------------------------------------------------------------

function pushAccounts() {
  updateTitle();
  if (!rail || !railReady) return;
  const payload = {
    activeId,
    accounts: accounts.map((a, i) => {
      const s = status.get(a.id) || {};
      return {
        id: a.id,
        index: i + 1,
        label: a.label,
        name: a.label || s.siteName || s.name || "Account",
        siteName: s.siteName || null,
        avatarUrl: s.avatarUrl || null,
        unread: s.loggedIn ? s.unread || 0 : 0,
        loggedIn: s.loggedIn,
      };
    }),
  };
  rail.webContents.send("accounts:update", payload);
  rail.webContents.send("badge:total", totalUnread());
}

ipcMain.on("rail:ready", () => {
  railReady = true;
  pushAccounts();
});
ipcMain.on("accounts:select", (_e, id) => showAccount(id));
ipcMain.on("accounts:add", () => addAccount());
ipcMain.on("accounts:rename", (_e, { id, label }) => renameAccount(id, label));
ipcMain.on("accounts:menu", (_e, id) => {
  const s = status.get(id);
  const view = views.get(id);
  if (!s || !view) return;
  const menu = Menu.buildFromTemplate([
    { label: s.siteName || s.name, enabled: false },
    { type: "separator" },
    { label: "Open inbox", click: () => { showAccount(id); view.webContents.loadURL(`${BASE_URL}/inbox`); } },
    { label: "Reload", click: () => view.webContents.reload() },
    { label: "Rename label…", click: () => rail?.webContents.send("accounts:rename-request", id) },
    { type: "separator" },
    { label: "Sign out", click: () => void signOut(id) },
    { label: "Remove account", click: () => void removeAccount(id) },
  ]);
  menu.popup({ window: win });
});
ipcMain.on("badge:image", (_e, dataUrl) => {
  if (!win) return;
  if (!dataUrl) {
    win.setOverlayIcon(null, "");
    return;
  }
  const total = totalUnread();
  win.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), `${total} unread`);
});

// ---------------------------------------------------------------------------
// Keyboard: Ctrl+1…9 switch accounts, Ctrl+Tab cycles, F5 / Ctrl+R reloads
// ---------------------------------------------------------------------------

function wireShortcuts(wc) {
  wc.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta;
    if (ctrl && /^[1-9]$/.test(input.key)) {
      const target = accounts[Number(input.key) - 1];
      if (target) showAccount(target.id);
      e.preventDefault();
    } else if (ctrl && input.key === "Tab") {
      const idx = accounts.findIndex((a) => a.id === activeId);
      const next = accounts[(idx + (input.shift ? -1 : 1) + accounts.length) % accounts.length];
      if (next) showAccount(next.id);
      e.preventDefault();
    } else if (input.key === "F5" || (ctrl && input.key.toLowerCase() === "r")) {
      views.get(activeId)?.webContents.reload();
      e.preventDefault();
    } else if (ctrl && input.key.toLowerCase() === "n") {
      addAccount();
      e.preventDefault();
    }
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(createWindow);

  app.on("window-all-closed", () => app.quit());
}
