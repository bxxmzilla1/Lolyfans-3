import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";
import MetaPixelRouteTracker from "@/components/MetaPixel";
import { META_PIXEL_ID, META_PIXEL_SNIPPET } from "@/lib/metaPixel";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LolyFans",
  description: "Private chat with media, vault and invite links",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LolyFans",
  },
  icons: {
    // ?v= busts stale favicon caches (browsers + old service workers)
    icon: [
      { url: "/icons/favicon-16.png?v=5", type: "image/png", sizes: "16x16" },
      { url: "/icons/favicon-32.png?v=5", type: "image/png", sizes: "32x32" },
      { url: "/icons/favicon-48.png?v=5", type: "image/png", sizes: "48x48" },
      { url: "/icons/logo-192.png?v=5", type: "image/png", sizes: "192x192" },
      { url: "/favicon.ico?v=5", sizes: "16x16 24x24 32x32 64x64" },
    ],
    apple: "/icons/logo-180.png?v=5",
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f8fb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Fans get light mode baked into the markup; owner pages swap the class
    // to dark before first paint, so hydration must not "fix" it back.
    <html
      lang="en"
      className={`light ${geistSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Meta Pixel base code — inlined so PageView fires on first paint. */}
        <script dangerouslySetInnerHTML={{ __html: META_PIXEL_SNIPPET }} />
      </head>
      <body className="min-h-full flex flex-col">
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            alt=""
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          />
        </noscript>
        <RegisterSW />
        <MetaPixelRouteTracker />
        {children}
      </body>
    </html>
  );
}
