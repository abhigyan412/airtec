'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Search, Plus, Users, Edit3 } from 'lucide-react'
import Link from 'next/link'
import { studentsApi } from '@/lib/api'
import { cn, STATUS_COLORS, formatDate } from '@/lib/utils'

export default function StudentsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['students', { search, status, page }],
    queryFn: () => studentsApi.list({ search: search || undefined, status: status || undefined, page, limit: 25 }),
    placeholderData: (prev: any) => prev,
  })

  const students = data?.data ?? []
  const meta = data?.meta ?? { total: 0, page: 1, limit: 25 }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Students</h1>
          <p className="text-gray-400 text-sm mt-0.5">{meta.total} total students</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/students/bulk-edit"
            className="flex items-center gap-2 border border-gray-200 text-gray-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all">
            <Edit3 className="w-4 h-4" /> Bulk Edit
          </Link>
          <Link href="/students/new"
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-200">
            <Plus className="w-4 h-4" /> Add Student
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search name or admission number..."
            value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-gray-50 focus:bg-white transition-all" />
        </div>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-gray-50 focus:bg-white transition-all min-w-[140px]">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="transferred">Transferred</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : students.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-gray-300" />
            </div>
            <p className="font-semibold text-gray-700">No students found</p>
            <p className="text-sm text-gray-400 mt-1 mb-5">Add your first student to get started</p>
            <Link href="/students/new"
              className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all">
              <Plus className="w-4 h-4" /> Add Student
            </Link>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Student</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Admission No.</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Class</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">House</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Joined</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {students.map((s: any) => (
                  <tr key={s.id} onClick={() => router.push(`/students/${s.id}`)}
                    className="hover:bg-gray-50/80 transition-colors group cursor-pointer">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center flex-shrink-0">
                          {s.photo_url
                            ? <img src={s.photo_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                            : <span className="text-indigo-700 text-xs font-bold">{s.first_name[0]}{s.last_name[0]}</span>
                          }
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">{s.first_name} {s.last_name}</p>
                          <p className="text-xs text-gray-400 capitalize">{s.gender ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg">{s.admission_number ?? '—'}</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">
                      {s.classes?.name ?? '—'}
                      {s.sections?.name && <span className="text-gray-400"> · Sec {s.sections.name}</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      {s.houses
                        ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white" style={{ backgroundColor: s.houses.color ?? '#6366f1' }}>
                            <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
                            {s.houses.name}
                          </span>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', STATUS_COLORS[s.status])}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs">{formatDate(s.created_at)}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs text-indigo-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                        View →
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {meta.total > meta.limit && (
              <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500 bg-gray-50/50">
                <p className="text-xs">Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs disabled:opacity-40 hover:bg-white transition-colors">← Prev</button>
                  <button onClick={() => setPage(p => p + 1)} disabled={page * meta.limit >= meta.total}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs disabled:opacity-40 hover:bg-white transition-colors">Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}