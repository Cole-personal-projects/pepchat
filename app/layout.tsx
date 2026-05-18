import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'

const appFont = localFont({
  src: [
    {
      path: './fonts/GeistVF.woff',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'SideBar',
  description: 'Your crew, your channels',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#e6543a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={appFont.variable}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
