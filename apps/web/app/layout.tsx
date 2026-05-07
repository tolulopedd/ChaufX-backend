import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChaufX Canada",
  description: "Personal driver platform for vehicle owners, drivers, and operators.",
  icons: {
    icon: "/icon.png?v=4",
    shortcut: "/icon.png?v=4",
    apple: "/icon.png?v=4"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
