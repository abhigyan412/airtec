import { Sidebar } from '@/components/layout/Sidebar'

// Single shared layout for every authenticated route (route group —
// adds no URL segment). Previously every feature folder declared its
// own copy of this Sidebar+main wrapper, and nested routes (e.g.
// students/[id]/fees) inherited layouts from every ancestor folder
// that also had one — stacking 2-3 real <Sidebar/> instances and
// compounding the left padding 2-3x, which is what produced the huge
// gap between the sidebar and content on deeper pages.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="pl-[220px]">
        <div className="p-8 max-w-[1400px]">
          {children}
        </div>
      </main>
    </div>
  )
}
