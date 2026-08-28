'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, GraduationCap, Settings } from 'lucide-react'
import { usePermissions } from '@/lib/usePermissions'
import { cn } from '@/lib/utils'

// Mirrors app/(app)/admission/layout.tsx and app/(app)/fees/layout.tsx —
// same tab-bar-above-{children} pattern. Kept in step with the
// 'Homework' group's children in components/layout/Sidebar.tsx, for the
// same reason those two files' comments warn about: the two drifting is
// how a page ends up reachable from one nav and not the other.
//
// Was one page carrying Settings, the school-wide syllabus grid, a
// homework/syllabus tab switch, and 4 modals all at once — the user's own
// complaint that things were "hidden under UI." Split into the actual
// distinct jobs, same as Fees was split for the same reason: assign
// homework, grade what came back, configure the rules. Syllabus itself
// moved one step further, 2026-08-27 — out of Homework entirely into its
// own top-level module (app/(app)/syllabus/page.tsx) since curriculum
// pacing isn't really a homework concern, it just happened to share a
// file historically.
const TABS = [
  { href: '/homework', label: 'Assign', icon: BookOpen, exact: true, anyOf: ['homework.view'] },
  { href: '/homework/assigned', label: 'Grading', icon: GraduationCap, anyOf: ['homework.create'] },
  { href: '/homework/settings', label: 'Settings', icon: Settings, anyOf: ['homework.create'] },
]

export default function HomeworkLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { canAny } = usePermissions()

  const visible = TABS.filter(t => canAny(...t.anyOf))
  // A read-only viewer (homework.view only — see the note on MyHomeworkView
  // in page.tsx: no built-in role actually lands here, only a custom RBAC
  // grant) gets none of these tabs. No bar to show instead of an empty one.
  if (visible.length <= 1) return <div className="animate-fade-in">{children}</div>

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1">
        {visible.map(t => {
          const active = t.exact ? pathname === t.href : pathname?.startsWith(t.href)
          const Icon = t.icon
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                active ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          )
        })}
      </div>
      {children}
    </div>
  )
}
