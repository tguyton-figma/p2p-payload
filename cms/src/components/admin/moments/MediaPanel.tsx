'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFormFields, useDocumentInfo, useForm, useListDrawer } from '@payloadcms/ui'
import { Time } from '@/components/time/Time'
import { createTimeStore } from '@/stores/time'
import '@/components/time/time.css'
import { MediaCell } from './MediaCell'
import type { Media } from '@/payload-types'

interface MediaEntry {
  id?: string | null
  media: string
}

/** Resolved entry with the full media doc (not just an ID string). */
interface ResolvedMediaEntry {
  id?: string | null
  media: Media
}

export function MediaPanel() {
  const { id } = useDocumentInfo()
  const isCreate = !id
  const { addFieldRow, getDataByPath } = useForm()

  // Create a scoped store for this Time instance
  const mediaTimeStore = useMemo(() => createTimeStore(), [])

  // List drawer for selecting existing media docs
  const [ListDrawer, , { openDrawer }] = useListDrawer({
    collectionSlugs: ['media'],
    selectedCollection: 'media',
  })

  // Read paint values + use media row count as a change signal
  // Payload stores array rows as individual fields (media.0.media, media.1.media, etc.)
  // The array field's own value is the row count, not the data.
  const { mediaRowCount, paintL, paintC, paintH } = useFormFields(([fields]) => ({
    mediaRowCount: fields.media?.value as number | undefined,
    paintL: fields.paintL?.value as number | null | undefined,
    paintC: fields.paintC?.value as number | null | undefined,
    paintH: fields.paintH?.value as number | null | undefined,
  }))

  // Read structured media array via getDataByPath (re-derive when row count changes)
  const items = useMemo(() => {
    const data = getDataByPath('media') as MediaEntry[] | undefined
    return Array.isArray(data) ? data : []
  }, [getDataByPath, mediaRowCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolve media IDs to full docs ────────────────────────────────────
  const [mediaCache, setMediaCache] = useState<Record<string, Media>>({})
  const fetchingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const idsToFetch: string[] = []
    for (const entry of items) {
      const mediaId = typeof entry.media === 'string' ? entry.media : null
      if (mediaId && !mediaCache[mediaId] && !fetchingRef.current.has(mediaId)) {
        idsToFetch.push(mediaId)
      }
    }
    if (idsToFetch.length === 0) return

    for (const fetchId of idsToFetch) fetchingRef.current.add(fetchId)

    Promise.all(
      idsToFetch.map((fetchId) =>
        fetch(`/api/media/${fetchId}?depth=0`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((docs) => {
      const newCache: Record<string, Media> = {}
      for (const doc of docs) {
        if (doc?.id) newCache[doc.id] = doc as Media
      }
      setMediaCache((prev) => ({ ...prev, ...newCache }))
      for (const fetchId of idsToFetch) fetchingRef.current.delete(fetchId)
    })
  }, [items, mediaCache])

  // Build resolved items with full media docs
  const resolvedItems = useMemo(() => {
    const result: ResolvedMediaEntry[] = []
    for (const entry of items) {
      const mediaId = typeof entry.media === 'string' ? entry.media : null
      if (!mediaId) continue
      const cached = mediaCache[mediaId]
      if (cached) result.push({ id: entry.id, media: cached })
    }
    return result
  }, [items, mediaCache])

  const handleSelect = useCallback(
    ({ doc }: { doc: Record<string, unknown> }) => {
      const mediaDoc = doc as unknown as Media
      // Cache the doc immediately so it renders without a fetch round-trip
      setMediaCache((prev) => ({ ...prev, [mediaDoc.id]: mediaDoc }))
      // Use Payload's addFieldRow to properly register the new array row
      addFieldRow({
        path: 'media',
        schemaPath: 'moments.media',
        subFieldState: {
          media: {
            initialValue: mediaDoc.id,
            valid: true,
            value: mediaDoc.id,
          },
        },
      })
    },
    [addFieldRow],
  )

  if (resolvedItems.length === 0 && items.length === 0) {
    return (
      <>
        <button
          type="button"
          data-moment-zone-placeholder=""
          data-add-media=""
          onClick={() => {
            if (!isCreate) openDrawer()
          }}
          disabled={isCreate}
        >
          {isCreate ? 'Add media after saving' : '+ Add media'}
        </button>
        <ListDrawer onSelect={handleSelect} />
      </>
    )
  }

  // Focus on the last item (most recent = primary)
  const initialFocus = resolvedItems.length - 1

  return (
    <>
      <div data-media-panel="">
        <Time
          items={resolvedItems}
          renderCell={(item, position, onSelect) => (
            <MediaCell
              key={item.id ?? item.media.id}
              item={item}
              position={position}
              onSelect={onSelect}
              paintL={paintL}
              paintC={paintC}
              paintH={paintH}
            />
          )}
      keyExtractor={(item, index) => item.id ?? item.media.id ?? `media-${index}`}
          store={mediaTimeStore}
          direction="x"
          initialFocusIndex={initialFocus}
        />
        <button
          type="button"
          data-add-media-btn=""
          onClick={openDrawer}
          aria-label="Add media"
          title="Add media"
        >
          +
        </button>
      </div>
      <ListDrawer onSelect={handleSelect} />
    </>
  )
}
