// Account rail: renders the list pushed from main, handles clicks, right-
// click menus, inline label renames, and paints the taskbar badge image.
const list = document.getElementById("accounts");
const addBtn = document.getElementById("add");
const badgeCanvas = document.getElementById("badge");

let state = { accounts: [], activeId: null };
let renamingId = null;

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function render() {
  list.textContent = "";
  for (const a of state.accounts) {
    const li = document.createElement("li");
    li.className = "account";
    if (a.id === state.activeId) li.classList.add("active");
    if (a.loggedIn === false) li.classList.add("signed-out");

    const btn = document.createElement("button");
    const tip = [
      a.name,
      a.label && a.siteName && a.label !== a.siteName ? `(${a.siteName})` : null,
      a.loggedIn === false ? "— signed out" : a.unread ? `— ${a.unread} unread` : null,
      `Ctrl+${a.index}`,
    ]
      .filter(Boolean)
      .join(" ");
    btn.title = tip;
    btn.setAttribute("aria-label", tip);

    if (a.avatarUrl) {
      const img = document.createElement("img");
      img.src = a.avatarUrl;
      img.alt = "";
      img.draggable = false;
      img.onerror = () => {
        img.remove();
        btn.textContent = initials(a.name);
      };
      btn.appendChild(img);
    } else {
      btn.textContent = initials(a.name);
    }

    btn.addEventListener("click", () => window.lolyfans.select(a.id));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      window.lolyfans.menu(a.id);
    });
    btn.addEventListener("dblclick", () => startRename(a.id));
    li.appendChild(btn);

    if (a.loggedIn === false) {
      const warn = document.createElement("span");
      warn.className = "badge warn";
      warn.textContent = "!";
      li.appendChild(warn);
    } else if (a.unread > 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = a.unread > 99 ? "99+" : String(a.unread);
      li.appendChild(badge);
    }

    // Shortcut number stays in the tooltip only (Ctrl+N) — no visible index.
    if (renamingId === a.id) li.appendChild(renameBox(a));
    list.appendChild(li);
  }
}

function renameBox(a) {
  const wrap = document.createElement("div");
  wrap.className = "rename";
  const input = document.createElement("input");
  input.value = a.label || "";
  input.placeholder = a.siteName || "Label";
  input.maxLength = 24;
  const finish = (save) => {
    if (renamingId !== a.id) return;
    renamingId = null;
    if (save) window.lolyfans.rename(a.id, input.value);
    else render();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  wrap.appendChild(input);
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return wrap;
}

function startRename(id) {
  renamingId = id;
  render();
}

// Taskbar overlay: a red circle with the unread total, drawn on a canvas and
// handed to main as a PNG data URL (Windows overlay icons are 16×16 shown
// bottom-right of the taskbar button; we draw at 32 for sharpness).
function paintBadge(total) {
  if (!total) {
    window.lolyfans.badgeImage(null);
    return;
  }
  const ctx = badgeCanvas.getContext("2d");
  const size = badgeCanvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  const text = total > 99 ? "99+" : String(total);
  ctx.font = `bold ${text.length > 2 ? 13 : 18}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2 + 1);
  window.lolyfans.badgeImage(badgeCanvas.toDataURL("image/png"));
}

addBtn.addEventListener("click", () => window.lolyfans.add());

window.lolyfans.onAccounts((payload) => {
  state = payload;
  if (renamingId && !state.accounts.some((a) => a.id === renamingId)) renamingId = null;
  render();
});
window.lolyfans.onRenameRequest((id) => startRename(id));
window.lolyfans.onBadge(paintBadge);
window.lolyfans.ready();
