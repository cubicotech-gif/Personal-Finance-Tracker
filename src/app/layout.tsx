import type { Metadata, Viewport } from "next";
import { AppProvider } from "@/lib/sync/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance",
  description: "Float and cash command centre",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black", title: "Finance" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0b0f19",
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
