'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

// Setup is now Structures.
//
// Kept as a redirect rather than deleted: the sidebar, the fee nav and anyone's
// bookmark all pointed here. A 404 on a route that worked yesterday is a worse
// answer than landing on the screen that replaced it — and what people came to
// this route to do (decide what a class pays) is exactly what Structures does,
// as a versioned plan rather than a grid of amounts.
//
// Client-side rather than the server `redirect()` helper: this route sits under a
// client-component layout, where the server redirect did not fire — the page
// returned 200 and simply rendered. A router.replace in an effect is unambiguous,
// and replace (not push) keeps Back from bouncing between the two.
export default function SetupRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/fees/structures')
  }, [router])

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Setup now lives under{' '}
        <Link href="/fees/structures" className="font-medium text-primary underline">
          Fee structures
        </Link>
        — taking you there.
      </p>
    </div>
  )
}
