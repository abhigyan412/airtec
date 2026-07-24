import { AppShell } from '@/components/layout/AppShell'

// Single shared shell for every authenticated route (route group — adds no URL
// segment). AppShell is a client component holding the responsive sidebar +
// header + mobile-drawer state; this server layout just mounts it once so
// nested routes don't stack duplicate shells.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
