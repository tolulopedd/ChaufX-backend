import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DriveMe",
  description: "Personal driver platform for vehicle owners, drivers, and operators.",
  icons: {
    icon: "/icon.png?v=2",
    shortcut: "/icon.png?v=2",
    apple: "/icon.png?v=2"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
