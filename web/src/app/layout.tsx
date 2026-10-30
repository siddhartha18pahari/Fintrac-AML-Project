import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { CommandPaletteHost } from "@/components/CommandPaletteHost";
import { Shortcuts } from "@/components/Shortcuts";
import { Spotlight } from "@/components/Spotlight";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
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
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} ${display.variable} font-sans antialiased`}>
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var t=localStorage.getItem("sentinel-theme");var dark=t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}else{document.documentElement.style.colorScheme="light"}}catch(e){}})();',
          }}
        />
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Spotlight>
          <Shortcuts />
          <CommandPaletteHost />
          <div id="content">{children}</div>
        </Spotlight>
      </body>
    </html>
  );
}
