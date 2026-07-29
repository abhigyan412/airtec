/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Same-origin API, mirroring the staff app: the browser only ever talks
  // to this origin and Next proxies /api/* onward, so there is no CORS
  // handshake to configure per domain. This app used to call the backend
  // directly cross-origin, which meant every new hostname needed adding
  // to the backend's allowlist or it failed with an opaque CORS error.
  //
  // BACKEND_URL is read at runtime (standalone server start), so it can
  // point at an internal host in prod (e.g. http://backend:4000 on the
  // Docker network) and defaults to the local backend in dev.
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
