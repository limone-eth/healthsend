import type { Metadata } from "next";
import { Figtree, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Switzer ships no self-hostable distribution in this repo, so the CSS stack
 * (`app/globals.css` --font-ui) names it first and falls through to a real
 * face rather than silently landing on the platform default. Figtree is that
 * face — it is also the exact stand-in `healthsend.pen` renders in, because
 * the canvas only serves its own font catalogue (see DESIGN.md Typography).
 */
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HealthSend",
  description: "Share health data that expires on its own.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
