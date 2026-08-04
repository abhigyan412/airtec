'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, PieChart, Users } from 'lucide-react'
import { studentsApi } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StudentPerformanceChart } from '@/components/students/StudentPerformanceChart'

export default function StudentPerformancePage() {
  const { id } = useParams<{ id: string }>()
  const [examId, setExamId] = useState<string | undefined>(undefined)

  const { data: student, isLoading } = useQuery({
    queryKey: ['student', id],
    queryFn: () => studentsApi.get(id).then(r => r.data),
  })

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    )
  }

  if (!student) {
    return (
      <EmptyState
        icon={Users}
        title="Student not found"
        action={<Button asChild><Link href="/students">Back to students</Link></Button>}
      />
    )
  }

  const subtitle = [
    student.classes?.name ? `${student.classes.name}${student.sections?.name ? ` · ${student.sections.name}` : ''}` : null,
    student.admission_number ? `#${student.admission_number}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="mt-1 shrink-0" aria-label="Back to student">
          <Link href={`/students/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <PageHeader
          className="mb-0 flex-1"
          title={`${student.first_name} ${student.last_name} — Performance`}
          description={subtitle || undefined}
          icon={PieChart}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <StudentPerformanceChart studentId={id} examId={examId} onExamChange={setExamId} />
        </CardContent>
      </Card>
    </div>
  )
}
