import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Your Next.js config here
  serverExternalPackages: [
    '@ffmpeg-installer/ffmpeg',
    '@ffmpeg-installer/darwin-arm64',
    '@ffmpeg-installer/linux-arm64',
  ],
  outputFileTracingIncludes: {
    '/**': [
      './node_modules/@ffmpeg-installer/linux-arm64/**/*',
      './node_modules/sharp/**/*',
      './node_modules/@img/sharp-linux-arm64/**/*',
      './node_modules/@img/sharp-libvips-linux-arm64/**/*',
    ],
  },
  // The Lambda runs linux-arm64 (glibc) only. Exclude the macOS and musl
  // native binaries that get installed locally — otherwise the deployment
  // package exceeds the ~250MB Lambda limit and the upload is rejected (400).
  outputFileTracingExcludes: {
    '/**': [
      './node_modules/@ffmpeg-installer/darwin-arm64/**/*',
      './node_modules/@img/sharp-darwin-arm64/**/*',
      './node_modules/@img/sharp-libvips-darwin-arm64/**/*',
      './node_modules/@img/sharp-linuxmusl-arm64/**/*',
      './node_modules/@img/sharp-libvips-linuxmusl-arm64/**/*',
    ],
  },
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  output: 'standalone'
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
