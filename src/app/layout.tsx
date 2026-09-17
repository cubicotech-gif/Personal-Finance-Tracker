import type { Metadata, Viewport } from "next";
import { AppProvider } from "@/lib/sync/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance",
  description: "Personal double-entry ledger and budget envelopes",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Finance" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#16161a",
  width: "device-width",
  initialScale: 1,
  // Installed apps should not rubber-band-zoom when the keypad opens.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
