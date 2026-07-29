'use client'

import { useEffect, useState } from 'react'
import { Toaster as SonnerToaster } from 'sonner'

/**
 * One Toaster, positioned by viewport. On a phone, top-right collides with the
 * notch and lands nowhere near the thumb, so toasts come up from the bottom
 * where the tab bar already is; on desktop they stay out of the content.
 *
 * This has to be a single mounted instance — rendering two and hiding one with
 * CSS makes every `toast()` fire twice.
 */
export function Toaster() {
  const [isPhone, setIsPhone] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const sync = () => setIsPhone(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return (
    <SonnerToaster
      position={isPhone ? 'bottom-center' : 'top-right'}
      richColors
      closeButton
      // Clears the tab bar and the home indicator so a toast never sits under
      // either of them.
      offset={isPhone ? 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 0.5rem)' : undefined}
      toastOptions={{ className: 'font-sans' }}
    />
  )
}
