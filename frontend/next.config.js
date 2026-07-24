/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Proxy /api/* to the backend so the browser only ever talks to this
  // origin. BACKEND_URL is read at runtime (standalone server start), so
  // it can point at an internal host in prod (e.g. http://backend:4000
  // on the Docker network) and defaults to the local backend in dev.
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? 'http://localhost:4000'
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }]
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig