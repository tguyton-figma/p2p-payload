'use client'

import type { Moment } from '@/payload-types'
import { Time as TimeBase } from '@/components/time/Time'
import { useTimeStore } from '@/stores/time'
import { MomentCell } from './MomentCell'

interface BookTimeProps {
  moments: Moment[]
  initialFocusIndex: number
}

export function Time({ moments, initialFocusIndex }: BookTimeProps) {
  return (
    <TimeBase
      items={moments}
      renderCell={(moment, position, onSelect) => (
        <MomentCell
          key={moment.id}
          moment={moment}
          position={position}
          onSelect={onSelect}
        />
      )}
      keyExtractor={(moment) => moment.id}
      store={useTimeStore}
      initialFocusIndex={initialFocusIndex}
      useTokens
    />
  )
}
