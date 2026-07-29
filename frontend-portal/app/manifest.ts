import type { MetadataRoute } from 'next'

// Web App Manifest, served at /manifest.webmanifest by Next's metadata route.
//
// Installed separately from the staff app: distinct id/name/short_name so a
// parent who installs this doesn't collide with (or overwrite) an AIRTEC
// admin install on the same device.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AIRTEC — Family Portal',
    short_name: 'AIRTEC Family',
    description: 'Attendance, fees, homework, timetable, and exam results for your child.',
    id: '/?app=family',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f9fafb',
    theme_color: '#5B5BD6',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
