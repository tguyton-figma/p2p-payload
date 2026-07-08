'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useDocumentInfo, useForm, useFormFields } from '@payloadcms/ui'
import { useProcessingStore } from '@/stores/processing'
import './styles/hero.scss'

/**
 * Thin React shell over the Zustand processing store.
 * The store owns polling and job state transitions outside React.
 * This component reads state, renders UI, and applies field hydration
 * into Payload's form when the store signals updates.
 */
export const ProcessingStatus: React.FC = () => {
  const { id } = useDocumentInfo()
  const { dispatchFields } = useForm()

  const mimeType = useFormFields(([fields]) => fields.mimeType?.value as string | null | undefined)
  const thumbnailURL = useFormFields(([fields]) => fields.thumbnailURL?.value)
  const dominantColor = useFormFields(([fields]) => fields.dominantColor?.value)
  const waveform = useFormFields(([fields]) => fields.waveform?.value)

  const tracked = useProcessingStore((s) => s.tracked)
  const startTracking = useProcessingStore((s) => s.startTracking)
  const stopTracking = useProcessingStore((s) => s.stopTracking)
  const consumeFieldUpdates = useProcessingStore((s) => s.consumeFieldUpdates)

  const [allResolved, setAllResolved] = useState(false)
  const [hidBar, setHidBar] = useState(false)
  const startedRef = useRef(false)

  // Start tracking when the document loads with pending jobs
  useEffect(() => {
    if (!id || !mimeType || startedRef.current) return
    startedRef.current = true

    startTracking(String(id), mimeType, {
      thumbnailURL,
      dominantColor,
      waveform,
    })

    return () => {
      stopTracking()
      startedRef.current = false
    }
  }, [id, mimeType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply field updates from the store to Payload's form
  useEffect(() => {
    if (!tracked) return

    const updates = consumeFieldUpdates()
    for (const u of updates) {
      dispatchFields({
        type: 'UPDATE',
        path: u.path,
        value: u.value,
      } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }, [tracked?.jobs, tracked?.fieldUpdates.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Collapse animation when all done
  const jobs = tracked?.jobs ?? []
  const hasPending = jobs.some((j) => j.state === 'pending')
  const hasErrors = jobs.some((j) => j.state === 'error')
  const hasDone = jobs.some((j) => j.state === 'done')

  useEffect(() => {
    if (!hasPending && !hasErrors && hasDone && jobs.length > 0) {
      setAllResolved(true)
      const timer = setTimeout(() => setHidBar(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [hasPending, hasErrors, hasDone, jobs.length])

  // Don't render if no jobs, on create form, or not tracking
  if (!id || !tracked || jobs.length === 0) return null
  if (!hasPending && !hasErrors && !hasDone) return null
  if (hidBar) return null

  const statusClass = [
    'processing-status',
    allResolved && 'processing-status--resolved',
    hasErrors && 'processing-status--has-errors',
  ].filter(Boolean).join(' ')

  return (
    <div className={statusClass}>
      <div className="processing-status__jobs">
        {jobs.map((job) => (
          <div key={job.field} className="processing-status__job" data-state={job.state}>
            {job.state === 'done' && <span className="processing-status__check">✓</span>}
            {job.state === 'pending' && <span className="processing-status__spinner" />}
            {job.state === 'error' && <span className="processing-status__error-icon">✕</span>}
            <span>
              {job.state === 'done' && job.label}
              {job.state === 'pending' && `${job.label}…`}
              {job.state === 'error' && `${job.label} failed`}
            </span>
            {job.errorMessage && (
              <span className="processing-status__error-msg" title={job.errorMessage}>
                {job.errorMessage}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
