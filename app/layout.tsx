import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cursor PM Dashboard",
  description: "Dashboard for PMs to find bugs from PostHog session recordings."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
