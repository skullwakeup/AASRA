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

const title = "AASRA — AI-Assisted Relief Area Identification";
const description =
  "Computer-vision decision support for aerial flood imagery: detected water, candidate land, probable storage zones and probable drop zones, measured in image pixels.";

// Icons and the social image come from the app/ file conventions
// (favicon.ico, icon.png, apple-icon.png, opengraph-image.png).
export const metadata: Metadata = {
  // Absolute base for the social image: the Vercel production domain when
  // built on Vercel, localhost otherwise (Next's own default, made explicit).
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000",
  ),
  title,
  description,
  openGraph: { title, description, type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#050607",
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
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
      </body>
    </html>
  );
}
