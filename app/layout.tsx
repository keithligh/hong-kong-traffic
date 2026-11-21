import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/noto-sans-tc/chinese-traditional-400.css";
import "@fontsource/noto-sans-tc/chinese-traditional-700.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "../src/style.css";

export const metadata: Metadata = {
  title: "香港交通地圖",
  description: "查看香港港鐵即將到站的班次，以及運輸署主要道路的最新交通快拍。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
