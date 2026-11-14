import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mini-ERP",
  description: "Gestion commerciale, RH, finance et absences",
};

export default function MiseEnPageRacine({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
