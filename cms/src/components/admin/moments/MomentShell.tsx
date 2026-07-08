'use client'

import React, { useState, useEffect } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'
import type { UIFieldClientComponent } from 'payload'
import { MetadataStrip } from './MetadataStrip'
import { MediaPanel } from './MediaPanel'
import { MemoriesPanel } from './MemoriesPanel'
import { NaviBar } from './NaviBar'
import './styles/moment-edit.scss'

/**
 * MomentShell — Custom 4-zone layout shell for the Moments edit view.
 *
 * Registered as the `momentHero` UI field component. It renders the Main zone
 * (metadata, media, memories placeholders) and the Navi bar. CSS overrides in
 * `moment-edit.scss` reshape the parent Payload edit view into a full-viewport
 * grid where this component occupies the left column and the sidebar fields
 * become the Aside zone.
 */
export const MomentShell: UIFieldClientComponent = () => {
  const { id } = useDocumentInfo()
  const mode = id ? 'edit' : 'create'
  const [asideOpen, setAsideOpen] = useState(true)

  // Cmd+B toggles the aside (capture phase so Lexical doesn't swallow it)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === 'b') {
        e.preventDefault()
        e.stopPropagation()
        setAsideOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <>
      {/* Main zone — 3 sub-rows: metadata, media, memories */}
      <div data-moment-shell="" data-mode={mode} data-aside={asideOpen ? 'open' : 'closed'}>
        <div data-moment-metadata="">
          <MetadataStrip />
        </div>
        <div data-moment-media="">
          <MediaPanel />
        </div>
        <div data-moment-memories="">
          <MemoriesPanel />
        </div>
      </div>

      {/* Navi zone — bottom bar, full width */}
      <div data-moment-navi="">
        <NaviBar />
      </div>
    </>
  )
}
