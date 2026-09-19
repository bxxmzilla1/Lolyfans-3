# Lolyfans Desktop

Windows app that runs several Lolyfans creator accounts side by side. Each
account lives in its own isolated browser session, so all of them stay logged
in at once and switching is instant.

- Left rail: one avatar per account, unread badge, `!` when signed out.
- `Ctrl+1…9` jump to an account, `Ctrl+Tab` cycles, `Ctrl+N` adds one, `F5` reloads.
- Right-click an avatar: open inbox, reload, rename label, sign out, remove.
- Desktop notifications for new fan messages (click → opens that chat), unread
  total in the title bar and as a taskbar badge.

## Run from source

```bash
cd desktop
npm install
npm start
```

## Build the installer

```bash
npm run dist        # → desktop/dist/Lolyfans-Setup-<version>.exe
```

Point the app at another deployment with `LOLYFANS_URL=https://staging.example.com npm start`.

The app polls `/api/desktop/status` on the site with each account's own login
cookie for badges and notifications — no API key needed.
