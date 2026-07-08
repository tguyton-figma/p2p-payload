import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const FIGMA_SITE_ORIGIN = /^https:\/\/[^.]+\.figma\.site$/

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'PUT, PATCH, POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, Content-Encoding, x-apollo-tracing, X-Payload-HTTP-Method-Override',
  'Access-Control-Allow-Credentials': 'true',
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Embed routes: allow framing from any origin
  if (pathname.startsWith('/embed/')) {
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', 'frame-ancestors *')
    response.headers.delete('X-Frame-Options')
    return response
  }

  // API CORS for Figma site origins
  const origin = request.headers.get('origin')

  if (!origin || !FIGMA_SITE_ORIGIN.test(origin)) {
    return NextResponse.next()
  }

  // Short-circuit preflight — Payload doesn't handle OPTIONS for dynamic origins
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin },
    })
  }

  const response = NextResponse.next()
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

export const config = {
  matcher: ['/api/:path*', '/embed/:path*'],
}
