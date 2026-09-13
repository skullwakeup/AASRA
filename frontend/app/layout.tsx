import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "AASRA — AI-Assisted Relief Area Identification",
  description:
    "Computer-vision decision-support prototype for aerial flood imagery: flood coverage, potentially isolated land regions and ranked candidate supply-drop zones.",
};

export const viewport: Viewport = {
  themeColor: "#070a0e",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="aasra-grid min-h-full flex flex-col bg-ground text-ink">
        {children}
      </body>
    </html>
  );
}
