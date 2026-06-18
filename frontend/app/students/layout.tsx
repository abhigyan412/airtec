import { Sidebar } from '@/components/layout/Sidebar'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="pl-64">
        <div className="p-8 max-w-[1400px]">
          {children}
        </div>
      </main>
    </div>
  )
}
