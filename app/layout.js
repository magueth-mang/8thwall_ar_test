export const metadata = {
  title: 'YSL Beauty · La Chasse aux Trésors',
  description: 'Expérience WebAR — pop-up store cosmétique de luxe',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          background:
            'radial-gradient(120% 80% at 50% -10%, #1a1710 0%, #0a0a0a 45%, #000 100%)',
          color: '#EFE9DC',
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          WebkitFontSmoothing: 'antialiased',
          overflowX: 'hidden',
        }}
      >
        {children}
      </body>
    </html>
  )
}
