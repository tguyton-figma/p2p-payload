import React from 'react'

export const metadata = {
  robots: 'noindex',
}

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`body { margin: 0; padding: 0; background: #000; overflow: hidden; }`}</style>
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
