'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap, LayoutDashboard, CalendarCheck, Wallet, NotebookPen, Clock, BookOpen, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { studentsApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { NotificationBell } from '@/components/layout/NotificationBell'

// fees is parent-only — a student doesn't need to see "your parents
// owe ₹X," that's a household/billing concern, not the student's.
// Everything else (attendance, homework, timetable, exams) is
// identical for both roles, so there's nothing else to gate yet.
const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, parentOnly: false },
  { href: '/attendance', label: 'Attendance', icon: CalendarCheck, parentOnly: false },
  { href: '/fees', label: 'Fees', icon: Wallet, parentOnly: true },
  { href: '/homework', label: 'Homework', icon: NotebookPen, parentOnly: false },
  { href: '/timetable', label: 'Timetable', icon: Clock, parentOnly: false },
  { href: '/exams', label: 'Exams', icon: BookOpen, parentOnly: false },
]

// The one authenticated shell in this app — everything under here
// requires a parent/student login (staff logins are already rejected
// at /auth/login, before they ever reach this layout).
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!isLoading && !user) router.replace('/auth/login')
  }, [isLoading, user, router])

  const { data: me } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => studentsApi.me().then(r => r.data),
    enabled: !!user,
  })

  if (isLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400">Loading...</div>
  }

  const initials = `${me?.first_name?.[0] ?? ''}${me?.last_name?.[0] ?? ''}`.toUpperCase() || 'S'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-[1000px] mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[9px] bg-gradient-to-br from-[#7C6FF0] to-[#5B5BD6] flex items-center justify-center flex-shrink-0">
              <GraduationCap className="w-[18px] h-[18px] text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 text-sm leading-tight">AIRTEC</p>
              <p className="text-[11px] text-gray-400 truncate leading-tight">{(user as any)?.schools?.name ?? 'Family Portal'}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <NotificationBell variant="light" />
            <div className="flex items-center gap-2.5 pl-3 border-l border-gray-200">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#9D8FFF] to-[#5B5BD6] flex items-center justify-center flex-shrink-0">
                <span className="text-white text-[11px] font-semibold">{initials}</span>
              </div>
              <div className="hidden sm:block min-w-0">
                <p className="text-xs font-medium text-gray-900 truncate leading-tight">
                  {me ? `${me.first_name} ${me.last_name}` : user.full_name}
                </p>
                <p className="text-[11px] text-gray-400 leading-tight">
                  {me?.classes?.name ? `${me.classes.name}${me.sections?.name ? ' - ' + me.sections.name : ''}` : user.role}
                </p>
              </div>
              <button onClick={logout} className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Sign out">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <nav className="max-w-[1000px] mx-auto px-5 flex items-center gap-1 overflow-x-auto">
          {NAV.filter(item => !item.parentOnly || user.role === 'parent').map(item => {
            const active = pathname === item.href
            return (
              <Link key={item.href} href={item.href}
                className={cn('flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  active ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-800')}>
                <item.icon className="w-4 h-4" /> {item.label}
              </Link>
            )
          })}
        </nav>
      </header>

      <main className="max-w-[1000px] mx-auto px-5 py-6">
        {children}
      </main>
    </div>
  )
}
