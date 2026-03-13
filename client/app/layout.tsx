import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://mirogd.vercel.app';

export const metadata: Metadata = {
  title: '미로 속 경찰과 도둑',
  description: '친구와 함께하는 실시간 미로 추격 게임',
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: '미로 속 경찰과 도둑',
    description: '랜덤 미로에서 친구와 경찰 vs 도둑 추격전!',
    url: '/',
    siteName: '미로 속 경찰과 도둑',
    images: [
      {
        url: '/og-thumbnail.png',
        width: 1200,
        height: 630,
        alt: '미로 속 경찰과 도둑 게임 썸네일',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '미로 속 경찰과 도둑',
    description: '랜덤 미로에서 친구와 경찰 vs 도둑 추격전!',
    images: ['/og-thumbnail.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f0f14',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>{children}</body>
    </html>
  );
}
