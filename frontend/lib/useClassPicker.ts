import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { admissionApi, academicsApi } from '@/lib/api'

// Shared between the Homework Assign page and the Syllabus page — both
// need "which class/section is the user looking at", scoped the same way:
// senior management (syllabus.plan — the one permission that stays
// exclusive to School Admin/Principal/Vice Principal, so it's the real
// "senior management" signal; homework.create is NOT safe for this since
// Teacher/Class Teacher hold it too) sees every class in the school, a
// Teacher/Class Teacher sees only their own timetabled classes+sections.
export function useClassPicker(isSeniorManagement: boolean) {
  const [selectedClass, setSelectedClassRaw] = useState('')
  const [selectedSection, setSelectedSection] = useState('')

  const { data: allClasses } = useQuery({
    queryKey: ['classes'],
    queryFn: () => admissionApi.classes().then(r => r.data),
    enabled: isSeniorManagement,
  })

  const { data: myClasses } = useQuery({
    queryKey: ['my-classes'],
    queryFn: () => academicsApi.myClasses().then(r => r.data),
    enabled: !isSeniorManagement,
  })

  // Normalize both sources into the same { id, name, sections: [{id,name}] } shape.
  const classesData = useMemo(() => {
    if (isSeniorManagement) return allClasses ?? []
    const byClass = new Map<string, any>()
    for (const row of myClasses ?? []) {
      if (!byClass.has(row.class_id)) byClass.set(row.class_id, { id: row.class_id, name: row.class_name, sections: [] })
      if (row.section_id) byClass.get(row.class_id).sections.push({ id: row.section_id, name: row.section_name })
    }
    return Array.from(byClass.values())
  }, [isSeniorManagement, allClasses, myClasses])

  const selectedClassObj = classesData.find((c: any) => c.id === selectedClass)
  const sections = selectedClassObj?.sections ?? []

  // Subjects the CURRENT user is actually timetabled for in the selected
  // class(+section) — undefined (no restriction) for senior management,
  // who can post/plan for any subject. With no section picked yet (a
  // teacher assigning/planning for the whole class, every section at
  // once — a real, common choice, not just an in-between state), this
  // must union across every section of the class the teacher teaches,
  // not require an exact section match against nothing: a teacher's own
  // timetable rows always carry a real section_id, so requiring an exact
  // match against an empty selectedSection previously matched zero rows —
  // an empty (but truthy) array that silently hid every subject option
  // and every already-assigned whole-class homework item.
  const myAllowedSubjects = isSeniorManagement ? undefined : Array.from(new Set<string>(
    (myClasses ?? [])
      .filter((c: any) => c.class_id === selectedClass && (!selectedSection || c.section_id === selectedSection))
      .map((c: any) => c.subject_name as string)
  ))

  const setSelectedClass = (v: string) => { setSelectedClassRaw(v); setSelectedSection('') }

  return { selectedClass, setSelectedClass, selectedSection, setSelectedSection, classesData, sections, myClasses, myAllowedSubjects }
}
