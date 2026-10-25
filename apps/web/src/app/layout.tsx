import type { Metadata } from "next";
import { Karla, Playfair_Display_SC } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// The design system's pairing: Playfair Display SC for headings, Karla for everything else.
const playfair = Playfair_Display_SC({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-playfair",
  display: "swap",
});
const karla = Karla({ subsets: ["latin"], variable: "--font-karla", display: "swap" });

export const metadata: Metadata = {
  title: "Casa Fiorella — Front Desk",
  description: "Book a table at Casa Fiorella by chatting with our receptionist.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${karla.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
