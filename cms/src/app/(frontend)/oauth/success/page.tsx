export default function OAuthSuccessPage() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Connected — P2P Payload</title>
        <style>{`
          body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #0a0a0a;
            color: #fff;
          }
          .card {
            text-align: center;
            padding: 48px 40px;
            max-width: 360px;
          }
          .icon {
            font-size: 48px;
            margin-bottom: 16px;
          }
          h1 {
            font-size: 22px;
            font-weight: 600;
            margin: 0 0 12px;
          }
          p {
            font-size: 14px;
            color: #888;
            margin: 0;
            line-height: 1.6;
          }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="icon">✓</div>
          <h1>Connected</h1>
          <p>Your Figma account has been linked to the recorder. You can close this tab and return to the app.</p>
        </div>
      </body>
    </html>
  )
}
