import { Urbanist } from "next/font/google";
import SwRegister from "./sw-register";
import "./globals.css";

const font = Urbanist({ subsets: ["latin"], variable: "--font-main" });

export const metadata = {
  title: "Catatan Keuangan",
  description: "Dashboard keuangan pribadi: pemasukan, pengeluaran, anggaran, target tabungan, dan riwayat.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Keuangan", statusBarStyle: "default" },
};

export const viewport = { themeColor: "#0b2470", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return (
    <html lang="id" className={font.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('catatan-keuangan-theme');if(t&&t!=='auto')document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />
      </head>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
