import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import { CommandPaletteHost } from "@/components/CommandPaletteHost";
import { Shortcuts } from "@/components/Shortcuts";
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
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var t=localStorage.getItem("sentinel-theme");var dark=t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}else{document.documentElement.style.colorScheme="light"}}catch(e){}})();',
          }}
        />
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Shortcuts />
        <CommandPaletteHost />
        <div id="content">{children}</div>
      </body>
    </html>
  );
}
