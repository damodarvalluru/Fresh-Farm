/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_INTERNAL_URL || 'http://localhost:4000'

const nextConfig = {
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [{ source: '/api/backend/:path*', destination: `${apiOrigin}/api/:path*` }]
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }]
  },
}

export default nextConfig
