# Lolyfans

A private chat PWA with an Instagram-style UI. Creators sign up with email + password; other people join instantly through invite links — no registration.

## Features

- **Sign in / sign up** with email + password (Supabase Auth) — every account gets its own inbox, vault and invite links
- **Realtime chat** with text, images and videos (Supabase Realtime + Storage)
- **Reply to a specific message** — hover/tap the reply arrow next to any bubble
- **Clickable links** in messages open in an in-app popup that loads the page (with an "Open" fallback for sites that block embedding)
- **Vault** — private media library with albums for your images and videos
- **Invite links** — share `/i/<code>` and anyone can chat with you immediately, no sign-up
- **Country restrictions** — limit any invite link to a custom set of countries (uses Vercel geo headers)
- **PWA** — installable, with manifest, icons and a service worker

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql). This creates all tables, enables RLS, and creates the public `media` storage bucket.
   (If you already ran the older schema without accounts, run [`supabase/migration-add-auth.sql`](supabase/migration-add-auth.sql) instead.)
3. Go to **Settings → API** and copy the project URL, anon key and service role key.
4. Optional: in **Authentication → Sign In / Providers → Email**, turn off "Confirm email" if you want accounts to work instantly without a confirmation email. If you keep it on, also set your deployed URL in **Authentication → URL Configuration** so confirmation links point to your site.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (auth, realtime, signed uploads) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `AUTH_SECRET` | Long random string used to sign guest session cookies |

### 3. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000, create an account (or sign in), create an invite link in the **Links** tab, and open it in a private window to chat as a guest.

> Country restrictions rely on the `x-vercel-ip-country` header, which only exists on Vercel. On localhost the check is skipped.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in [vercel.com/new](https://vercel.com/new).
3. Add the four environment variables from above in the Vercel project settings.
4. Deploy. Done — invite links, geo-restrictions and the PWA all work out of the box.

## How access control works

- All data access goes through Next.js API routes using the Supabase **service role** key; RLS is enabled with no public policies, so the anon key can't read or write anything directly.
- Accounts use Supabase Auth (cookie-based sessions via `@supabase/ssr`); every API route scopes queries to the signed-in user's `owner_id`.
- Guest sessions are signed HTTP-only cookies (`AUTH_SECRET`); guests can only read/write messages in their own chat.
- Media uploads use short-lived signed upload URLs so large files go straight to Supabase Storage instead of through Vercel.
