import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Montserrat } from 'next/font/google'
import { MetaPixel } from '@/components/meta-pixel'
import { DEFAULT_CONFIG, STATE_NAMES } from '@/lib/company-config'
import './globals.css'

const montserrat = Montserrat({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})
const montserratHeading = Montserrat({
  variable: '--font-heading-sans',
  subsets: ['latin'],
  weight: ['600', '700', '800', '900'],
})

export const metadata: Metadata = {
  title: `${DEFAULT_CONFIG.companyName} — Instant Gutter Quote`,
  description: `Get an instant, no-obligation gutter installation estimate in ${STATE_NAMES[DEFAULT_CONFIG.state] ?? DEFAULT_CONFIG.state}. Enter your address and see local pricing.`,
  generator: 'GutterQuote Template',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: DEFAULT_CONFIG.primaryColor,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${montserratHeading.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        <MetaPixel />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
