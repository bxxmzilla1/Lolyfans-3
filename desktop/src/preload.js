// Bridge between the account rail (renderer) and the main process. The rail
// never touches Node directly — only these few, explicit calls.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lolyfans", {
  /** Full account list + active id, pushed whenever anything changes. */
  onAccounts: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("accounts:update", handler);
    return () => ipcRenderer.removeListener("accounts:update", handler);
  },
  /** Main asks the rail to start an inline rename for this account. */
  onRenameRequest: (cb) => {
    ipcRenderer.on("accounts:rename-request", (_e, id) => cb(id));
  },
  /** Main asks the rail to paint the taskbar badge for this unread total. */
  onBadge: (cb) => {
    ipcRenderer.on("badge:total", (_e, total) => cb(total));
  },
  badgeImage: (dataUrl) => ipcRenderer.send("badge:image", dataUrl),

  ready: () => ipcRenderer.send("rail:ready"),
  select: (id) => ipcRenderer.send("accounts:select", id),
  add: () => ipcRenderer.send("accounts:add"),
  menu: (id) => ipcRenderer.send("accounts:menu", id),
  rename: (id, label) => ipcRenderer.send("accounts:rename", { id, label }),
});
