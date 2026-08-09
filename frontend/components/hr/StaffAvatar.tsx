import { cn } from '@/lib/utils'

// Small photo-or-initials avatar for any spot in Staff & HR that names a
// staff member — same visual idiom everywhere (Staff Directory, Org
// Chart, Attendance, Leave, Payroll) so a face becomes as recognizable
// as a name across the module, not just on the profile page itself.
export function StaffAvatar({ photoUrl, fullName, className }: { photoUrl?: string | null; fullName?: string | null; className?: string }) {
  const initials = (fullName ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || '?'
  return (
    <div className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-bold text-primary', className ?? 'h-9 w-9 text-xs')}>
      {photoUrl
        ? <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        : <span>{initials}</span>}
    </div>
  )
}

// staff_profiles is embedded through a to-one FK (staff_profiles.user_id
// is UNIQUE) but PostgREST's embed shape for that isn't guaranteed
// stable across schema-cache reloads — same caveat already documented
// server-side (backend/src/modules/hrms/routes.ts, GET /staff) — so any
// nested `users:user_id(..., staff_profiles(photo_url))` embed reads
// through this instead of assuming object-vs-array.
export function staffPhotoUrl(rel: any): string | undefined {
  const profile = Array.isArray(rel) ? rel[0] : rel
  return profile?.photo_url ?? undefined
}
