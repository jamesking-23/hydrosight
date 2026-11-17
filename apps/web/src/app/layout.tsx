import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "HydroSight",
  description: "Flood risk intelligence and early warning (prototype)",
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/brand/hydrosight-logo.png` },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
