import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MELIASTAGE · 客户管理工作台",
  description: "美利雅与美欣皮革业务客户、跟进、寄样与报价管理。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
