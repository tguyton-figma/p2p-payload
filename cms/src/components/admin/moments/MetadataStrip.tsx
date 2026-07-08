'use client'

import React from 'react'
import { useFormFields, useDocumentInfo } from '@payloadcms/ui'

const STATUS_COLORS: Record<string, string> = {
  staged: 'oklch(0.65 0.05 60)',
  confirmed: 'oklch(0.65 0.15 200)',
  active: 'oklch(0.7 0.2 145)',
  completed: 'oklch(0.6 0.1 270)',
  cancelled: 'oklch(0.5 0.05 15)',
}

const ACCESS_COLORS: Record<string, string> = {
  public: 'oklch(0.7 0.15 145)',
  internal: 'oklch(0.65 0.12 220)',
  private: 'oklch(0.6 0.08 30)',
}

function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return ''
  const s = new Date(start)
  const e = new Date(end)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return ''
  const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
  const dateStr = s.toLocaleDateString('en-US', dateOpts)
  const startTime = s.toLocaleTimeString('en-US', timeOpts)
  const endTime = e.toLocaleTimeString('en-US', timeOpts)
  const mins = Math.round((e.getTime() - s.getTime()) / 60000)
  return `${dateStr}, ${startTime} → ${endTime} · ${mins} min`
}

export function MetadataStrip() {
  const { id } = useDocumentInfo()
  const isCreate = !id

  const { name, start, end, status, access, paintL, paintC, paintH } = useFormFields(
    ([fields]) => ({
      name: fields.name?.value as string | null | undefined,
      start: fields.start?.value as string | null | undefined,
      end: fields.end?.value as string | null | undefined,
      status: fields.status?.value as string | null | undefined,
      access: fields.access?.value as string | null | undefined,
      paintL: fields.paintL?.value as number | null | undefined,
      paintC: fields.paintC?.value as number | null | undefined,
      paintH: fields.paintH?.value as number | null | undefined,
    }),
  )

  const timeStr = formatTimeRange(start, end)
  const l = paintL ?? 0.15
  const c = paintC ?? 0
  const h = paintH ?? 0
  const paintColor = `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`

  return (
    <div data-metadata-strip="">
      <span data-metadata-name="">{name || (isCreate ? 'New moment' : 'Untitled')}</span>
      {timeStr && <span data-metadata-time="">{timeStr}</span>}
      <div data-metadata-badges="">
        {status && (
          <span data-metadata-badge="" style={{ color: STATUS_COLORS[status] }}>
            {status}
          </span>
        )}
        {access && (
          <span data-metadata-badge="" style={{ color: ACCESS_COLORS[access] }}>
            {access}
          </span>
        )}
        {isCreate && (
          <span data-metadata-badge="" style={{ color: 'oklch(0.6 0.12 80)' }}>
            new
          </span>
        )}
      </div>
      <div
        data-metadata-paint=""
        style={{ background: paintColor }}
        title={`oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`}
      />
    </div>
  )
}
