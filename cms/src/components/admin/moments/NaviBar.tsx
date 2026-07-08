'use client'

import React, { useEffect } from 'react'
import { useFormFields, useDocumentInfo } from '@payloadcms/ui'
import { useNaviStore } from '@/stores/navi'

function formatTimeRelative(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) return ''
  const now = Date.now()
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  if (isNaN(startMs) || isNaN(endMs)) return ''

  if (now >= startMs && now <= endMs) return 'Active now'

  const diffMs = startMs - now
  if (diffMs > 0) {
    const mins = Math.floor(diffMs / 60000)
    if (mins < 60) return `Starting in ${mins} min`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `Starting in ${hrs}h`
    return `Starting in ${Math.floor(hrs / 24)}d`
  }

  const agoMs = now - endMs
  const agoMin = Math.floor(agoMs / 60000)
  if (agoMin < 60) return `Ended ${agoMin}m ago`
  const agoHr = Math.floor(agoMin / 60)
  if (agoHr < 24) return `Ended ${agoHr}h ago`
  return `Ended ${Math.floor(agoHr / 24)}d ago`
}

export function NaviBar() {
  const { id } = useDocumentInfo()
  const isCreate = !id

  const dialogue = useNaviStore((s) => s.dialogue)
  const symbols = useNaviStore((s) => s.symbols)
  const setDialogue = useNaviStore((s) => s.setDialogue)

  const { status, start, end, mediaCount } = useFormFields(([fields]) => ({
    status: fields.status?.value as string | null | undefined,
    start: fields.start?.value as string | null | undefined,
    end: fields.end?.value as string | null | undefined,
    mediaCount: Array.isArray(fields.media?.value) ? (fields.media.value as unknown[]).length : 0,
  }))

  // Derive dialogue text from form state
  useEffect(() => {
    if (isCreate) {
      setDialogue('New moment')
      return
    }

    const timeRel = formatTimeRelative(start, end)
    const parts: string[] = []

    if (status) parts.push(status.charAt(0).toUpperCase() + status.slice(1))

    if (start && end) {
      const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
      if (mins > 0) parts.push(`${mins} min`)
    }

    if (mediaCount > 0) parts.push(`${mediaCount} media`)
    if (timeRel) parts.push(timeRel)

    setDialogue(parts.length > 0 ? parts.join(' \u00b7 ') : 'I like when things are quiet..')
  }, [isCreate, status, start, end, mediaCount, setDialogue])

  return (
    <>
      <span data-navi-dialogue="">{dialogue}</span>
      {symbols.length > 0 && (
        <div data-navi-tools="">
          {symbols.map((sym) => (
            <div
              key={sym.id}
              data-navi-symbol=""
              data-symbol-state={sym.state}
              style={{ background: sym.gradient }}
              title={sym.label}
              aria-label={sym.label}
            />
          ))}
        </div>
      )}
    </>
  )
}
