import type { Metadata, Viewport } from "next";
import { Inter, Orbitron } from "next/font/google";
import { Space } from "@/components/Space";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const orbitron = Orbitron({ subsets: ["latin"], weight: ["500", "700", "900"], variable: "--font-orbitron", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ARCS League: Blighted Reach Chronicle", template: "%s · ARCS League" },
  description: "Campaign games of ARCS: The Blighted Reach, logged act by act.",
};

export const viewport: Viewport = { themeColor: "#05060f", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${orbitron.variable} ${inter.variable}`}>
      <body>
        <Space />
        <SiteHeader />
        <main className="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
