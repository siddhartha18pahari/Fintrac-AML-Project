import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const source = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: {
    default: "FINTRAC Sentinel",
    template: "%s · FINTRAC Sentinel",
  },
  description:
    "Explainable AML monitoring for virtual currency, cash and electronic funds transfers. Synthetic data only. Not a FINTRAC filing system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${source.variable} ${fraunces.variable} font-sans antialiased`}>
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-card focus:px-3 focus:py-2">
          Skip to content
        </a>
        <div id="content">{children}</div>
      </body>
    </html>
  );
}
