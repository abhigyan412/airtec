export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Decorative per-subject color coding for timetable cells. These are
// categorical — they identify a subject, not a state — so they deliberately sit
// outside the semantic token scale and must stay distinguishable from each
// other. Every entry uses the `bg-<hue>-500/10 + text-<hue>-600
// dark:text-<hue>-400 + inset ring` form, which reads in both themes; the old
// `bg-<hue>-50 + text-<hue>-800` form vanished on a near-black page.
// Break / Lunch / Assembly are not subjects — they're gaps in the day — so they
// take the neutral surface token instead of a hue.
export const SUBJECT_COLORS: Record<string, string> = {
  'Mathematics':       'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-inset ring-indigo-500/20',
  'English':           'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20',
  'Science':           'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20',
  'Hindi':             'bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-1 ring-inset ring-orange-500/20',
  'Social Studies':    'bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20',
  'Computer':          'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 ring-1 ring-inset ring-cyan-500/20',
  'Art':               'bg-pink-500/10 text-pink-600 dark:text-pink-400 ring-1 ring-inset ring-pink-500/20',
  'Physical Ed':       'bg-lime-500/10 text-lime-600 dark:text-lime-400 ring-1 ring-inset ring-lime-500/20',
  'Sanskrit':          'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 ring-1 ring-inset ring-yellow-500/20',
  'Drawing':           'bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-inset ring-rose-500/20',
  'Sports':            'bg-teal-500/10 text-teal-600 dark:text-teal-400 ring-1 ring-inset ring-teal-500/20',
  'Activity':          'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-1 ring-inset ring-violet-500/20',
  'Moral Science':     'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20',
  'General Knowledge': 'bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-inset ring-sky-500/20',
  'Break':             'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
  'Lunch':             'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
  'Assembly':          'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
}
export const SUBJECT_FALLBACK = 'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-1 ring-inset ring-violet-500/20'
export const getColor = (s: string) => SUBJECT_COLORS[s] ?? SUBJECT_FALLBACK
