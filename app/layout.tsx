import type { Metadata } from "next";
import ThemeRegistry from "./components/ThemeRegistry";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kaspi Magnum Price Tracker",
  description: "Ежедневный мониторинг цен на продукты Magnum в Kaspi",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
