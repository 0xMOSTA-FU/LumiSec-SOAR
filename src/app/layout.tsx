import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LumiSec SOAR — Security Orchestration, Automation & Response",
  description: "Enterprise-grade SOAR platform for security orchestration, automation, and incident response. Visual workflow builder, case management, and playbook automation.",
  keywords: ["SOAR", "Security", "Automation", "Orchestration", "Incident Response", "SIEM", "LumiSec"],
  icons: {
    icon: [{ url: "/favicon.ico" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground h-full overflow-hidden`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
