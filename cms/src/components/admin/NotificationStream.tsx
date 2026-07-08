'use client'

import React from 'react'
import { useNotificationStore } from '@/stores/notifications'
import type { Notification, NotificationType } from '@/stores/notifications'
import './styles/notifications.scss'

const TYPE_ICONS: Record<NotificationType, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
  loading: '◌',
  default: '•',
}

function NotificationItem({ notification }: { notification: Notification }) {
  const dismiss = useNotificationStore((s) => s.dismiss)

  return (
    <div
      className="notif-stream__item"
      data-type={notification.type}
      data-phase={notification.phase}
      role="status"
      aria-live="polite"
    >
      <span className="notif-stream__icon" data-type={notification.type}>
        {TYPE_ICONS[notification.type]}
      </span>
      <span className="notif-stream__text">
        <span className="notif-stream__message">{notification.message}</span>
        {notification.description && (
          <span className="notif-stream__desc">{notification.description}</span>
        )}
      </span>
      <button
        type="button"
        className="notif-stream__dismiss"
        onClick={() => dismiss(notification.id)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}

/**
 * Inline notification stream — sits in the page flow (not a floating overlay).
 * Mount via admin.components.header so it renders above the document area.
 */
export function NotificationStream() {
  const notifications = useNotificationStore((s) => s.notifications)

  if (notifications.length === 0) return null

  return (
    <div className="notif-stream">
      {notifications.map((n) => (
        <NotificationItem key={n.id} notification={n} />
      ))}
    </div>
  )
}
