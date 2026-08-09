import Link from 'next/link'
import { Briefcase } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type HrSection = 'staff' | 'attendance' | 'leave' | 'payroll' | 'recruitment' | 'reports' | 'org-chart' | 'permissions'

const SECTIONS: { key: HrSection; label: string; href: string }[] = [
  { key: 'staff', label: 'Staff', href: '/hr/staff' },
  { key: 'attendance', label: 'Attendance', href: '/hr/attendance' },
  { key: 'leave', label: 'Leave', href: '/hr/leave' },
  { key: 'payroll', label: 'Payroll', href: '/hr/payroll' },
  { key: 'reports', label: 'Reports', href: '/hr/reports' },
  { key: 'org-chart', label: 'Org Chart', href: '/hr/org-chart' },
  { key: 'permissions', label: 'Permissions', href: '/hr/permissions' },
]

/**
 * Cross-navigation button row shown on every Staff & HR admin page —
 * originally only on the Staff Directory, now consistent everywhere so
 * jumping between HR sections doesn't mean going back to Staff first.
 * The current page's own section is left out of its own row.
 */
export function HrQuickNav({ current }: { current: HrSection }) {
  return (
    <>
      {SECTIONS.filter(s => s.key !== current).map(s => (
        <Button key={s.key} variant="outline" size="sm" asChild>
          <Link href={s.href}>{s.label}</Link>
        </Button>
      ))}
      {current !== 'recruitment' && (
        <Button size="sm" asChild>
          <Link href="/hr/recruitment"><Briefcase className="h-4 w-4" /> Recruitment</Link>
        </Button>
      )}
    </>
  )
}
