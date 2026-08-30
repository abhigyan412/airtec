import { classLabel } from '@/lib/utils'

// Shared between the Term Templates apply flow and the Exam Structure
// row builder — both need "pick several classes at once" as checkbox
// chips rather than a single-select Select, so this stays one
// implementation instead of drifting into two.
export function ClassCheckboxPicker({ classes, selected, onToggle, displayStyle }: {
  classes: any[]; selected: Set<string>; onToggle: (id: string) => void; displayStyle: 'numeric' | 'roman'
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {classes.map((c: any) => (
        <label key={c.id} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} />
          {classLabel(c.name, c.numeric_level, displayStyle)}
        </label>
      ))}
    </div>
  )
}
