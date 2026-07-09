'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, Track } from 'livekit-client'
import type { Participant, RemoteTrack } from 'livekit-client'
import type { ParticipantFlowNode } from './ParticipantNode'

/**
 * useCanvasRecorder — records the session canvas in the host's browser.
 *
 * We don't screen-grab. Every animation frame we redraw all tiles onto an
 * off-screen canvas at the same fit-to-view layout the live canvas shows
 * (mirroring the bounding-box → scale math of React Flow's fitView), and mix
 * every audio track (remote participants + the host's own mic) into a single
 * track via WebAudio. `canvas.captureStream()` + those mixed samples feed one
 * MediaRecorder, producing a single video that matches what the host sees.
 *
 * On stop the recording uploads straight to storage through the presigned
 * pipeline and a SessionRecordings document is created. Capture runs only while
 * the host's tab is open and foregrounded (backgrounded tabs throttle the draw
 * loop) — an accepted trade for keeping this off any recording server.
 *
 * The hook owns the whole capture→save lifecycle; the caller supplies a live ref
 * to the current React Flow nodes (positions + track refs) and the room name.
 */

// Output canvas size — 720p 16:9. Bitrate kept modest so files stay uploadable.
const OUT_W = 1280
const OUT_H = 720
const FPS = 30
const VIDEO_BITRATE = 2_500_000
const FIT_PADDING = 0.08 // fraction of the canvas kept as margin around the tiles

// Tile sizes must match canvas.css so the recorded layout matches the live one.
const CAMERA_W = 320
const CAMERA_H = 240
const SCREEN_W = 480
const SCREEN_H = 270

type XY = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }

export interface RecorderState {
  isRecording: boolean
  isSaving: boolean
  error: string | null
  savedId: string | null
}

/** Pick a webm codec the browser actually supports, most-preferred first. */
function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
  }
  return 'video/webm'
}

function tileSize(node: ParticipantFlowNode): { w: number; h: number } {
  const isScreen = node.data.trackRef.source === Track.Source.ScreenShare
  const w = node.measured?.width ?? (isScreen ? SCREEN_W : CAMERA_W)
  const h = node.measured?.height ?? (isScreen ? SCREEN_H : CAMERA_H)
  return { w, h }
}

function displayName(p: Participant): string {
  return (p.name && p.name.trim()) || p.identity
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const chars = parts.map((s) => s[0]?.toUpperCase() ?? '').join('')
  return chars || '?'
}

export function useCanvasRecorder(
  nodesRef: RefObject<ParticipantFlowNode[]>,
  room: string,
): RecorderState & { start: () => void; stop: () => Promise<void> } {
  const lkRoom = useRoomContext()

  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    isSaving: false,
    error: null,
    savedId: null,
  })

  // All mutable capture machinery lives in refs — it must not drive renders.
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  // nodeId -> attached <video> playing that tile's track (+ the track's sid so we
  // know when to re-attach because the underlying track changed).
  const videosRef = useRef<Map<string, { el: HTMLMediaElement; sid: string }>>(new Map())
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const audioTrackIdsRef = useRef<Set<string>>(new Set())
  const startedAtRef = useRef<string | null>(null)

  // --- audio mixing -------------------------------------------------------

  const addAudioTrack = useCallback((msTrack: MediaStreamTrack | undefined | null) => {
    const ctx = audioCtxRef.current
    const dest = audioDestRef.current
    if (!ctx || !dest || !msTrack) return
    if (audioTrackIdsRef.current.has(msTrack.id)) return
    audioTrackIdsRef.current.add(msTrack.id)
    // One source node per track (a MediaStreamAudioSourceNode only reads the
    // first audio track of its stream, so each track gets its own).
    const src = ctx.createMediaStreamSource(new MediaStream([msTrack]))
    src.connect(dest)
  }, [])

  const collectAudio = useCallback(() => {
    if (!lkRoom) return
    // Remote participants' microphones.
    for (const p of lkRoom.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.kind === Track.Kind.Audio && pub.track) {
          addAudioTrack(pub.track.mediaStreamTrack)
        }
      }
    }
    // The host's own mic.
    const mic = lkRoom.localParticipant.getTrackPublication(Track.Source.Microphone)
    addAudioTrack(mic?.track?.mediaStreamTrack)
  }, [lkRoom, addAudioTrack])

  // Pick up microphones that subscribe mid-recording.
  const onTrackSubscribed = useCallback(
    (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) addAudioTrack(track.mediaStreamTrack)
    },
    [addAudioTrack],
  )

  // --- draw loop ----------------------------------------------------------

  const syncVideos = useCallback((nodes: ParticipantFlowNode[]) => {
    const map = videosRef.current
    const seen = new Set<string>()
    for (const node of nodes) {
      const t = node.data.trackRef
      const pub = 'publication' in t ? t.publication : undefined
      const track = pub?.track
      // A live, unmuted video track with real media backing it.
      if (track && !pub?.isMuted && track.mediaStreamTrack) {
        seen.add(node.id)
        const sid = pub!.trackSid
        const existing = map.get(node.id)
        if (!existing || existing.sid !== sid) {
          // Track changed (or first attach) — release the old element and attach
          // the current track to a fresh hidden <video> we draw each frame.
          if (existing) existing.el.srcObject = null
          const el = track.attach()
          el.muted = true
          map.set(node.id, { el, sid })
        }
      }
    }
    // Drop videos whose node/track is gone.
    for (const [id, entry] of map) {
      if (!seen.has(id)) {
        entry.el.srcObject = null
        map.delete(id)
      }
    }
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const nodes = nodesRef.current ?? []
    syncVideos(nodes)

    ctx.fillStyle = '#0b0b0c'
    ctx.fillRect(0, 0, OUT_W, OUT_H)

    if (nodes.length > 0) {
      // Bounding box over every tile, then fit it into the canvas (same idea as
      // React Flow's fitView: scale to fit with padding, never zoom past 1:1).
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      const rects: { node: ParticipantFlowNode; local: Rect }[] = []
      for (const node of nodes) {
        const pos = node.position as XY
        const { w, h } = tileSize(node)
        const local = { x: pos.x, y: pos.y, w, h }
        rects.push({ node, local })
        minX = Math.min(minX, pos.x)
        minY = Math.min(minY, pos.y)
        maxX = Math.max(maxX, pos.x + w)
        maxY = Math.max(maxY, pos.y + h)
      }
      const bboxW = Math.max(1, maxX - minX)
      const bboxH = Math.max(1, maxY - minY)
      const usableW = OUT_W * (1 - FIT_PADDING * 2)
      const usableH = OUT_H * (1 - FIT_PADDING * 2)
      const scale = Math.min(usableW / bboxW, usableH / bboxH, 1)
      const offX = (OUT_W - bboxW * scale) / 2 - minX * scale
      const offY = (OUT_H - bboxH * scale) / 2 - minY * scale

      for (const { node, local } of rects) {
        const dx = local.x * scale + offX
        const dy = local.y * scale + offY
        const dw = local.w * scale
        const dh = local.h * scale
        const entry = videosRef.current.get(node.id)
        const el = entry?.el as HTMLVideoElement | undefined
        drawRoundedRect(ctx, dx, dy, dw, dh, 8 * scale)
        if (el && el.readyState >= 2 && el.videoWidth > 0) {
          ctx.save()
          ctx.clip()
          drawCover(ctx, el, dx, dy, dw, dh)
          ctx.restore()
        } else {
          // Camera off / not yet playing — placeholder with initials.
          ctx.fillStyle = '#1b1b1f'
          ctx.fill()
          const name = displayName(node.data.trackRef.participant)
          ctx.fillStyle = '#8a8a93'
          ctx.font = `${Math.round(Math.min(dw, dh) * 0.28)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(initials(name), dx + dw / 2, dy + dh / 2)
        }
        // Name label.
        const name = displayName(node.data.trackRef.participant)
        const fs = Math.max(10, Math.round(13 * scale))
        ctx.font = `${fs}px sans-serif`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        const tw = ctx.measureText(name).width
        ctx.fillRect(dx + 6, dy + dh - fs - 8, tw + 10, fs + 6)
        ctx.fillStyle = '#fff'
        ctx.fillText(name, dx + 11, dy + dh - 6)
      }
    }

    rafRef.current = requestAnimationFrame(draw)
  }, [nodesRef, syncVideos])

  // --- lifecycle ----------------------------------------------------------

  const cleanup = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    lkRoom?.off(RoomEvent.TrackSubscribed, onTrackSubscribed)
    for (const [, entry] of videosRef.current) entry.el.srcObject = null
    videosRef.current.clear()
    audioTrackIdsRef.current.clear()
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    audioDestRef.current = null
    canvasRef.current = null
    recorderRef.current = null
  }, [lkRoom, onTrackSubscribed])

  const start = useCallback(() => {
    if (recorderRef.current || !lkRoom) return
    setState({ isRecording: true, isSaving: false, error: null, savedId: null })
    chunksRef.current = []
    startedAtRef.current = new Date().toISOString()

    const canvas = document.createElement('canvas')
    canvas.width = OUT_W
    canvas.height = OUT_H
    canvasRef.current = canvas

    // Audio graph.
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    audioCtxRef.current = ctx
    // start() runs inside the host's click, so resuming here is allowed —
    // without it the context can stay suspended and record silent audio.
    void ctx.resume().catch(() => {})
    audioDestRef.current = ctx.createMediaStreamDestination()
    collectAudio()
    lkRoom.on(RoomEvent.TrackSubscribed, onTrackSubscribed)

    // Prime one frame, then loop.
    draw()

    const videoTrack = canvas.captureStream(FPS).getVideoTracks()[0]
    const combined = new MediaStream([videoTrack, ...audioDestRef.current.stream.getAudioTracks()])
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: VIDEO_BITRATE })
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorderRef.current = recorder
    recorder.start(1000) // gather in 1s chunks so nothing is lost if the tab hiccups
  }, [lkRoom, collectAudio, onTrackSubscribed, draw])

  const upload = useCallback(
    async (blob: Blob, mimeType: string, durationMs: number) => {
      const startedAt = startedAtRef.current ?? new Date().toISOString()
      const stamp = startedAt.replace(/[:.]/g, '-')
      const filename = `session-${room}-${stamp}.webm`

      // Snapshot who was present.
      const participants: { identity: string; name: string }[] = []
      if (lkRoom) {
        const local = lkRoom.localParticipant
        participants.push({ identity: local.identity, name: displayName(local) })
        for (const p of lkRoom.remoteParticipants.values()) {
          participants.push({ identity: p.identity, name: displayName(p) })
        }
      }

      const urlRes = await fetch('/api/session-recording/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ filename, mimeType }),
      })
      if (!urlRes.ok) throw new Error((await urlRes.json().catch(() => ({}))).error || 'Could not get upload URL')
      const { uploadUrl, filename: safeFilename } = (await urlRes.json()) as {
        uploadUrl: string
        filename: string
      }

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      })
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`)

      const finRes = await fetch('/api/session-recording/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          room,
          filename: safeFilename,
          mimeType,
          filesize: blob.size,
          startedAt,
          durationMs,
          participants,
        }),
      })
      if (!finRes.ok) throw new Error((await finRes.json().catch(() => ({}))).error || 'Could not save recording')
      return (await finRes.json()) as { id: string }
    },
    [room, lkRoom],
  )

  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    const mimeType = recorder.mimeType || 'video/webm'
    const startedMs = startedAtRef.current ? Date.parse(startedAtRef.current) : Date.now()

    const blob: Blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: mimeType }))
      recorder.stop()
    })
    const durationMs = Date.now() - startedMs
    cleanup()
    setState((s) => ({ ...s, isRecording: false, isSaving: true }))

    try {
      const doc = await upload(blob, mimeType, durationMs)
      setState({ isRecording: false, isSaving: false, error: null, savedId: doc.id })
    } catch (err) {
      setState({
        isRecording: false,
        isSaving: false,
        error: err instanceof Error ? err.message : 'Failed to save recording',
        savedId: null,
      })
    }
  }, [cleanup, upload])

  // Safety: tear everything down if the component unmounts mid-recording.
  useEffect(() => cleanup, [cleanup])

  return { ...state, start, stop }
}

// --- canvas drawing helpers ----------------------------------------------

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** Draw a video frame with object-fit: cover into the dest rect. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const vw = el.videoWidth
  const vh = el.videoHeight
  if (!vw || !vh) return
  const scale = Math.max(dw / vw, dh / vh)
  const sw = dw / scale
  const sh = dh / scale
  const sx = (vw - sw) / 2
  const sy = (vh - sh) / 2
  ctx.drawImage(el, sx, sy, sw, sh, dx, dy, dw, dh)
}
