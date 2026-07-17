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
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0a11",
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
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <head>
        <script
          // Applies the saved theme before first paint so there's no flash of
          // the wrong colors. Guest-facing pages (invite links and the guest
          // chat) default to light so they never flash a black screen.
          dangerouslySetInnerHTML={{
            __html: `(function(){var g=location.pathname.slice(0,3)==='/i/'||location.pathname.slice(0,5)==='/chat';var t=null;try{t=localStorage.getItem('theme');}catch(e){}if(t==='light'||(g&&t!=='dark')){document.documentElement.classList.add('light');}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
