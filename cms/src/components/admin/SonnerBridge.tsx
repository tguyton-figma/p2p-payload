'use client'

import { useEffect, useRef } from 'react'
import { useSonner } from 'sonner'
import { useNotificationStore } from '@/stores/notifications'
import type { NotificationType } from '@/stores/notifications'

/**
 * Headless bridge that reads Sonner's live toast array via useSonner()
 * and pushes each toast into our Zustand notification store.
 *
 * Renders nothing — mount this anywhere in the admin component tree.
 */
export function SonnerBridge() {
  const { toasts } = useSonner()
  const push = useNotificationStore((s) => s.push)
  const seenIds = useRef(new Set<string | number>())

  useEffect(() => {
    for (const toast of toasts) {
      // Only push each toast once
      if (seenIds.current.has(toast.id)) continue
      seenIds.current.add(toast.id)

      const type: NotificationType =
        (toast.type as NotificationType) ?? 'default'

      const message =
        typeof toast.title === 'string'
          ? toast.title
          : toast.title != null
            ? String(toast.title)
            : ''

      const description =
        typeof toast.description === 'string'
          ? toast.description
          : toast.description != null
            ? String(toast.description)
            : undefined

      if (!message && !description) continue

      push({
        id: String(toast.id),
        type,
        message: message || description || '',
        description: message ? description : undefined,
      })
    }
  }, [toasts, push])

  return null
}
