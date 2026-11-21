import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meridian",
  description:
    "Alerting from data sources to incidents: primarily alert webhook payloads; Slack as a secondary option.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border">
          <nav className="mx-auto flex w-full max-w-3xl items-center gap-6 px-6 py-4 text-sm">
            <Link href="/" className="font-semibold">
              Meridian
            </Link>
            <Link href="/connections" className="text-muted-foreground hover:text-foreground">
              Connections
            </Link>
            <Link href="/jobs" className="text-muted-foreground hover:text-foreground">
              Jobs
            </Link>
            <Link href="/monitors" className="text-muted-foreground hover:text-foreground">
              Monitors
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
