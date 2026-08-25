'use client'
import { useQuery } from '@tanstack/react-query'
import { admissionApi } from './api'

/**
 * The school's chosen class-numbering style (numeric "Class 11" vs Roman
 * "Class XI") — single source of truth, GET /admission/class-display-style.
 * Cached for the session (staleTime) since it changes rarely and is read
 * on almost every page that lists classes.
 */
export function useClassDisplayStyle(): 'numeric' | 'roman' {
  const { data } = useQuery({
    queryKey: ['class-display-style'],
    queryFn: () => admissionApi.classDisplayStyle.get().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
  return data?.style ?? 'numeric'
}
