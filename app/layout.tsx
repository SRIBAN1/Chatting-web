import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "The Lobby — Chatting Web",
  description: "A shared chat room. Choose a name, join the conversation, and come back to the saved history any time.",
  applicationName: "Chatting Web",
  icons: { icon: "/chat-mark.svg" },
  openGraph: {
    title: "The Lobby — Chatting Web",
    description: "A shared room for whatever is on your mind.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#100d1c",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
