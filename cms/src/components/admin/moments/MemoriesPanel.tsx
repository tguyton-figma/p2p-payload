'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDocumentInfo, useDocumentDrawer } from '@payloadcms/ui'
import type { Memory } from '@/payload-types'
import { Time } from '@/components/time/Time'
import { createTimeStore } from '@/stores/time'
import '@/components/time/time.css'
import { MemoryCell } from './MemoryCell'

export function MemoriesPanel() {
  const { id } = useDocumentInfo()
  const isCreate = !id

  const memoriesTimeStore = useMemo(() => createTimeStore(), [])
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(false)

  // Document drawer for creating new memories
  const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
    collectionSlug: 'memories',
  })

  const fetchMemories = useCallback(() => {
    if (!id) {
      setMemories([])
      return
    }
    setLoading(true)
    fetch(`/api/memories?where[moment][equals]=${id}&sort=createdAt&depth=1&limit=1000`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.docs) setMemories(data.docs)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  // Fetch memories on mount and when moment ID changes
  useEffect(() => {
    fetchMemories()
  }, [fetchMemories])

  const handleMemoryCreated = useCallback(() => {
    fetchMemories()
  }, [fetchMemories])

  if (isCreate) {
    return (
      <div
        data-moment-zone-placeholder=""
        style={{
          background: 'oklch(0.08 0 0)',
          color: 'oklch(0.3 0 0)',
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          borderRadius: 'var(--zone-radius, 0.4vmin)',
          fontSize: '0.75rem',
        }}
      >
        Memories appear after saving
      </div>
    )
  }

  if (memories.length === 0 && !loading) {
    return (
      <>
        <button
          type="button"
          data-moment-zone-placeholder=""
          data-add-memory=""
          onClick={openDrawer}
        >
          + Add memory
        </button>
        <DocumentDrawer
          initialData={{ moment: id }}
          onSave={handleMemoryCreated}
        />
      </>
    )
  }

  // Focus on the most recent memory (last in chronological order)
  const initialFocus = memories.length - 1

  return (
    <>
      <div data-memories-panel="">
        <Time
          items={memories}
          renderCell={(memory, position, onSelect) => (
            <MemoryCell
              key={memory.id}
              item={memory}
              position={position}
              onSelect={onSelect}
            />
          )}
          keyExtractor={(memory) => memory.id}
          store={memoriesTimeStore}
          direction="y"
          initialFocusIndex={initialFocus}
        />
        <button
          type="button"
          data-add-memory-btn=""
          onClick={openDrawer}
          aria-label="Add memory"
          title="Add memory"
        >
          +
        </button>
      </div>
      <DocumentDrawer
        initialData={{ moment: id }}
        onSave={handleMemoryCreated}
      />
    </>
  )
}
