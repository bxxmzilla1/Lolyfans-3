import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Keeps the Supabase auth session fresh on every request. */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Guest-facing pages never carry an owner session — skip the auth work
  // entirely so invite links respond as fast as possible.
  if (
    pathname.startsWith("/i/") ||
    pathname.startsWith("/chat") ||
    pathname.startsWith("/p/") ||
    pathname === "/home" ||
    pathname === "/chats" ||
    pathname === "/profile" ||
    pathname === "/login"
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Verifies locally and refreshes the session cookie only when it expired.
  const { data } = await supabase.auth.getClaims();

  // Signed-in owners opening "/" (the PWA start URL) go straight to the inbox
  // without rendering the sign-in page first — one less server round trip.
  if (data?.claims && pathname === "/") {
    const redirect = NextResponse.redirect(new URL("/inbox", request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

export const config = {
  // Only page routes: API routes validate the JWT themselves, and static
  // assets never need a session, so skipping them removes per-request work.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|sw.js).*)",
  ],
};
