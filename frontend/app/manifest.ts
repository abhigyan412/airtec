import type { MetadataRoute } from 'next'

// Web App Manifest, served at /manifest.webmanifest by Next's metadata route.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AIRTEC — School ERP',
    short_name: 'AIRTEC',
    description: 'Modern School Management Platform',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#fafafe',
    theme_color: '#4f46e5',
    categories: ['education', 'business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
