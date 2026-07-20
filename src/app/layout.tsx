import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lolyfans",
  description: "Private chat with media, vault and invite links",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Lolyfans",
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
    // The whole app is light-mode only — the class is baked into the markup
    // so there's never a flash of dark colors.
    <html lang="en" className={`light ${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
