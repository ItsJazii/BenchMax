import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { isClerkConfigured } from "@/lib/auth/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const metadataOrigin = (() => {
  try {
    const value = process.env.NEXT_PUBLIC_APP_URL;
    if (!value) return new URL("https://benchmax.invalid");
    const url = new URL(value);
    return url.protocol === "https:"
      ? new URL(url.origin)
      : new URL("https://benchmax.invalid");
  } catch {
    return new URL("https://benchmax.invalid");
  }
})();

export const metadata: Metadata = {
  metadataBase: metadataOrigin,
  title: {
    default: "Benchmax — See what models actually built",
    template: "%s · Benchmax",
  },
  description:
    "Browse public AI Tests with their prompts, contributor-declared setup, and inspectable output evidence.",
  applicationName: "Benchmax",
  category: "technology",
  keywords: [
    "AI tests",
    "AI outputs",
    "coding models",
    "community model tests",
    "AI leaderboard",
    "coding agents",
  ],
  openGraph: {
    type: "website",
    siteName: "Benchmax",
    title: "Benchmax — See what models actually built",
    description:
      "Public AI Tests with their prompts, declared setup, contributor, and output evidence.",
    images: [
      {
        url: "/og.png",
        width: 1616,
        height: 969,
        alt: "An evidence-first AI model test workbench with code, media, settings, and a locked ranking grid.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Benchmax — See what models actually built",
    description:
      "Browse public AI Tests and inspect exactly what contributors submitted.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Providers
          clerkPublishableKey={
            isClerkConfigured()
              ? (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null)
              : null
          }
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
