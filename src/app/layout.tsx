import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { DATA_MODE } from "@/services/data-mode";
import { verifySession } from "@/lib/auth/dal";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Market Intelligence AI — Transparent Market Scanning",
  description:
    "Explainable market intelligence combining fundamentals, sentiment, positioning, seasonality and technicals into one transparent scoring system. For informational purposes only — not investment advice.",
};

const themeInitScript = `
try {
  var stored = localStorage.getItem('mi-theme');
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  }
} catch (e) {}
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Cheap (cookie read + one indexed query, memoized via React's cache for
  // this render pass) and safe to run unconditionally, including on public
  // marketing pages — e.g. so the landing nav can show "Dashboard" instead
  // of "Sign In" for an already-logged-in visitor. Only a plain-data
  // subset ever crosses into the client-side AppShell — never passwordHash.
  const sessionUser = await verifySession();
  const user = sessionUser ? { id: sessionUser.id, email: sessionUser.email, name: sessionUser.name } : null;

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AppShell dataMode={DATA_MODE} user={user}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
