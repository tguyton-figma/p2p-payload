'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, Track } from 'livekit-client'
import type { Participant, RemoteTrack } from 'livekit-client'
import type { MediaFlowNode } from './MediaNode'
import type { FigmaEmbedFlowNode } from './FigmaEmbedNode'
import { isMediaNode, isFigmaEmbedNode } from './sessionNodes'
import type { SessionFlowNode } from './sessionNodes'
import { isAudioSource, mediaLabel, trackName } from './mediaTracks'

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
// Audio-only feed card — must match .media-node--audio in canvas.css.
const AUDIO_W = 220
const AUDIO_H = 72
// Default embed size — must match EMBED_W/EMBED_H in SessionCanvas.
const EMBED_W = 640
const EMBED_H = 400

type XY = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }

// A node placed onto the capture canvas, with its computed local rect.
type DrawItem =
  | { kind: 'video'; node: MediaFlowNode; local: Rect }
  | { kind: 'audio'; node: MediaFlowNode; local: Rect }
  | { kind: 'embed'; node: FigmaEmbedFlowNode; local: Rect }

// A cached Figma render for an embed node, loaded from the same-origin proxy.
type EmbedImage = { img: HTMLImageElement; status: 'loading' | 'ready' | 'error' }

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

function tileSize(node: MediaFlowNode): { w: number; h: number } {
  const isScreen = node.data.trackRef.source === Track.Source.ScreenShare
  const w = node.measured?.width ?? (isScreen ? SCREEN_W : CAMERA_W)
  const h = node.measured?.height ?? (isScreen ? SCREEN_H : CAMERA_H)
  return { w, h }
}

function audioSize(node: MediaFlowNode): { w: number; h: number } {
  return { w: node.measured?.width ?? AUDIO_W, h: node.measured?.height ?? AUDIO_H }
}

function embedSize(node: FigmaEmbedFlowNode): { w: number; h: number } {
  const styleW = typeof node.style?.width === 'number' ? node.style.width : undefined
  const styleH = typeof node.style?.height === 'number' ? node.style.height : undefined
  return {
    w: node.measured?.width ?? styleW ?? EMBED_W,
    h: node.measured?.height ?? styleH ?? EMBED_H,
  }
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
  nodesRef: RefObject<SessionFlowNode[]>,
  room: string,
): RecorderState & { start: () => Promise<void>; stop: () => Promise<void> } {
  const lkRoom = useRoomContext()

  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    isSaving: false,
    error: null,
    savedId: null,
  })

  // All mutable capture machinery lives in refs — it must not drive renders.
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Draw cadence + the manual-capture track. We drive frames on a timer (not
  // requestAnimationFrame) so capture keeps producing frames when the preview
  // loses focus — a backgrounded rAF stops entirely, which silently yielded
  // empty (0-byte) recordings.
  const drawTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const captureTrackRef = useRef<CanvasCaptureMediaStreamTrack | null>(null)
  // nodeId -> attached <video> playing that tile's track (+ the track's sid so we
  // know when to re-attach because the underlying track changed).
  const videosRef = useRef<Map<string, { el: HTMLMediaElement; sid: string }>>(new Map())
  // embedId -> cached same-origin Figma render (snapshot at first sight).
  const embedImagesRef = useRef<Map<string, EmbedImage>>(new Map())
  // participant identity -> cached same-origin Figma avatar (camera-off placeholder).
  const avatarImagesRef = useRef<Map<string, EmbedImage>>(new Map())
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  // Diagnostics: how many `dataavailable` events fired, and how many frames the
  // draw loop painted + pushed into the capture stream this session.
  const dataEventsRef = useRef(0)
  const framesRef = useRef(0)
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

  const syncVideos = useCallback((nodes: MediaFlowNode[]) => {
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

  // Load a same-origin Figma render for each embed once (snapshot at first sight).
  // Serving via /api/figma/render keeps the image same-origin so drawing it never
  // taints the capture canvas.
  const syncEmbeds = useCallback((embeds: FigmaEmbedFlowNode[]) => {
    const map = embedImagesRef.current
    const seen = new Set<string>()
    for (const node of embeds) {
      seen.add(node.id)
      if (map.has(node.id)) continue
      const entry: EmbedImage = { img: new Image(), status: 'loading' }
      entry.img.onload = () => {
        const e = map.get(node.id)
        if (e) e.status = 'ready'
      }
      entry.img.onerror = () => {
        const e = map.get(node.id)
        if (e) e.status = 'error'
      }
      const params = new URLSearchParams({ fileKey: node.data.fileKey, scale: '2' })
      if (node.data.nodeId) params.set('nodeId', node.data.nodeId)
      entry.img.src = `/api/figma/render?${params.toString()}`
      map.set(node.id, entry)
    }
    // Drop renders whose embed is gone.
    for (const [id, entry] of map) {
      if (!seen.has(id)) {
        entry.img.onload = null
        entry.img.onerror = null
        map.delete(id)
      }
    }
  }, [])

  // Load each authenticated participant's Figma avatar once (same-origin, so it
  // never taints the canvas). Used as the camera-off placeholder. Guests
  // (authenticated !== 'true') keep the initials placeholder.
  const syncAvatars = useCallback((participants: MediaFlowNode[]) => {
    const map = avatarImagesRef.current
    const seen = new Set<string>()
    for (const node of participants) {
      const t = node.data.trackRef
      if (t.source !== Track.Source.Camera) continue
      if (t.participant.attributes?.authenticated !== 'true') continue
      const id = t.participant.identity
      seen.add(id)
      if (map.has(id)) continue
      const entry: EmbedImage = { img: new Image(), status: 'loading' }
      entry.img.onload = () => {
        const e = map.get(id)
        if (e) e.status = 'ready'
      }
      entry.img.onerror = () => {
        const e = map.get(id)
        if (e) e.status = 'error'
      }
      entry.img.src = `/api/figma/avatar?figmaId=${encodeURIComponent(id)}`
      map.set(id, entry)
    }
    for (const [id, entry] of map) {
      if (!seen.has(id)) {
        entry.img.onload = null
        entry.img.onerror = null
        map.delete(id)
      }
    }
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const all = nodesRef.current ?? []
    const media = all.filter(isMediaNode)
    // Video feeds (camera / screen share) draw as tiles; audio feeds (extra mics)
    // draw as small cards. Audio playback/mixing is unchanged — every mic is mixed
    // via collectAudio() regardless of whether it has a node.
    const videos = media.filter((n) => !isAudioSource(n.data.trackRef.source))
    const audios = media.filter((n) => isAudioSource(n.data.trackRef.source))
    const embeds = all.filter(isFigmaEmbedNode)
    syncVideos(videos)
    syncEmbeds(embeds)
    syncAvatars(videos)

    ctx.fillStyle = '#0b0b0c'
    ctx.fillRect(0, 0, OUT_W, OUT_H)

    // Bounding box over every node (tiles + embeds), then fit it into the canvas
    // (same idea as React Flow's fitView: scale to fit with padding, never past 1:1).
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const items: DrawItem[] = []
    const track = (x: number, y: number, w: number, h: number) => {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + w)
      maxY = Math.max(maxY, y + h)
    }
    for (const node of videos) {
      const pos = node.position as XY
      const { w, h } = tileSize(node)
      items.push({ kind: 'video', node, local: { x: pos.x, y: pos.y, w, h } })
      track(pos.x, pos.y, w, h)
    }
    for (const node of audios) {
      const pos = node.position as XY
      const { w, h } = audioSize(node)
      items.push({ kind: 'audio', node, local: { x: pos.x, y: pos.y, w, h } })
      track(pos.x, pos.y, w, h)
    }
    for (const node of embeds) {
      const pos = node.position as XY
      const { w, h } = embedSize(node)
      items.push({ kind: 'embed', node, local: { x: pos.x, y: pos.y, w, h } })
      track(pos.x, pos.y, w, h)
    }

    if (items.length > 0) {
      const bboxW = Math.max(1, maxX - minX)
      const bboxH = Math.max(1, maxY - minY)
      const usableW = OUT_W * (1 - FIT_PADDING * 2)
      const usableH = OUT_H * (1 - FIT_PADDING * 2)
      const scale = Math.min(usableW / bboxW, usableH / bboxH, 1)
      const offX = (OUT_W - bboxW * scale) / 2 - minX * scale
      const offY = (OUT_H - bboxH * scale) / 2 - minY * scale

      for (const item of items) {
        const { local } = item
        const dx = local.x * scale + offX
        const dy = local.y * scale + offY
        const dw = local.w * scale
        const dh = local.h * scale
        drawRoundedRect(ctx, dx, dy, dw, dh, 8 * scale)

        if (item.kind === 'video') {
          const node = item.node
          const entry = videosRef.current.get(node.id)
          const el = entry?.el as HTMLVideoElement | undefined
          if (el && el.readyState >= 2 && el.videoWidth > 0) {
            ctx.save()
            ctx.clip()
            drawCover(ctx, el, dx, dy, dw, dh)
            ctx.restore()
          } else {
            // Camera off — the participant's Figma avatar if we have it, else
            // an initials placeholder.
            const avatar = avatarImagesRef.current.get(node.data.trackRef.participant.identity)
            if (avatar?.status === 'ready' && avatar.img.naturalWidth > 0) {
              ctx.save()
              ctx.clip()
              drawCoverImage(ctx, avatar.img, dx, dy, dw, dh)
              ctx.restore()
            } else {
              ctx.fillStyle = '#1b1b1f'
              ctx.fill()
              const name = displayName(node.data.trackRef.participant)
              ctx.fillStyle = '#8a8a93'
              ctx.font = `${Math.round(Math.min(dw, dh) * 0.28)}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText(initials(name), dx + dw / 2, dy + dh / 2)
            }
          }
          drawNameLabel(ctx, displayName(node.data.trackRef.participant), dx, dy, dw, dh, scale)
        } else if (item.kind === 'audio') {
          // Audio-only feed — a small labelled card (the sound itself is mixed
          // separately via the audio graph, so this is purely a visual marker).
          const node = item.node
          ctx.save()
          ctx.clip()
          ctx.fillStyle = '#141417'
          ctx.fill()
          ctx.restore()
          const label = mediaLabel(trackName(node.data.trackRef))
          const name = displayName(node.data.trackRef.participant)
          const text = `🎤  ${name}${label ? ` · ${label}` : ''}`
          ctx.fillStyle = '#e4e4e7'
          ctx.font = `${Math.max(11, Math.round(13 * scale))}px sans-serif`
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(text, dx + 12 * scale, dy + dh / 2)
        } else {
          const node = item.node
          const entry = embedImagesRef.current.get(node.id)
          ctx.save()
          ctx.clip()
          if (entry?.status === 'ready' && entry.img.naturalWidth > 0) {
            // White backdrop behind the (contain-fit) Figma render.
            ctx.fillStyle = '#fff'
            ctx.fillRect(dx, dy, dw, dh)
            drawContain(ctx, entry.img, dx, dy, dw, dh)
          } else {
            // Not accessible / still loading — labeled placeholder card.
            ctx.fillStyle = '#1b1b1f'
            ctx.fillRect(dx, dy, dw, dh)
            const label = entry?.status === 'error' ? 'Preview unavailable' : 'Loading…'
            ctx.fillStyle = '#8a8a93'
            ctx.font = `${Math.max(11, Math.round(14 * scale))}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(label, dx + dw / 2, dy + dh / 2)
          }
          ctx.restore()
          drawNameLabel(ctx, node.data.name, dx, dy, dw, dh, scale)
        }
      }
    }

    // Push this freshly-painted frame into the capture stream. The stream is
    // created with captureStream(0) (manual cadence), so a frame is only captured
    // when we ask — this guarantees a frame per draw rather than relying on the
    // browser's auto-sampler, which was emitting nothing here.
    framesRef.current++
    captureTrackRef.current?.requestFrame?.()
  }, [nodesRef, syncVideos, syncEmbeds, syncAvatars])

  // --- lifecycle ----------------------------------------------------------

  const cleanup = useCallback(() => {
    if (drawTimerRef.current != null) clearInterval(drawTimerRef.current)
    drawTimerRef.current = null
    captureTrackRef.current = null
    lkRoom?.off(RoomEvent.TrackSubscribed, onTrackSubscribed)
    for (const [, entry] of videosRef.current) entry.el.srcObject = null
    videosRef.current.clear()
    for (const [, entry] of embedImagesRef.current) {
      entry.img.onload = null
      entry.img.onerror = null
    }
    embedImagesRef.current.clear()
    for (const [, entry] of avatarImagesRef.current) {
      entry.img.onload = null
      entry.img.onerror = null
    }
    avatarImagesRef.current.clear()
    audioTrackIdsRef.current.clear()
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    audioDestRef.current = null
    if (canvasRef.current?.parentNode) canvasRef.current.parentNode.removeChild(canvasRef.current)
    canvasRef.current = null
    recorderRef.current = null
  }, [lkRoom, onTrackSubscribed])

  const start = useCallback(async () => {
    if (recorderRef.current || !lkRoom) return
    setState({ isRecording: true, isSaving: false, error: null, savedId: null })
    chunksRef.current = []
    startedAtRef.current = new Date().toISOString()

    const canvas = document.createElement('canvas')
    canvas.width = OUT_W
    canvas.height = OUT_H
    // Attach off-screen but RENDERED. A fully detached canvas can emit zero frames
    // to captureStream in Chromium; keep it in the document (just parked far
    // off-screen, not display:none, which would stop it being painted).
    canvas.style.cssText =
      'position:fixed;left:-100000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(canvas)
    canvasRef.current = canvas

    // Audio graph.
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    audioCtxRef.current = ctx
    // start() runs inside the host's click, so resuming here is allowed. AWAIT it
    // — a suspended context delivers no audio samples, and an audio track that
    // never delivers samples can stall MediaRecorder's muxer so it emits nothing
    // for the whole recording (video frames included).
    await ctx.resume().catch(() => {})
    const dest = ctx.createMediaStreamDestination()
    audioDestRef.current = dest
    // Keep-alive: a silent constant source so the destination always produces
    // samples even with no mic connected (a sample-less audio track can block the
    // muxer just like a suspended context).
    try {
      const keepAlive = ctx.createConstantSource()
      const silent = ctx.createGain()
      silent.gain.value = 0
      keepAlive.connect(silent)
      silent.connect(dest)
      keepAlive.start()
    } catch {
      // ConstantSourceNode unsupported — non-fatal; we may just fall back to video-only.
    }
    collectAudio()
    lkRoom.on(RoomEvent.TrackSubscribed, onTrackSubscribed)

    // Paint the FIRST frame before capturing: this creates the 2D context and
    // gives the canvas real content. Capturing a canvas whose rendering context
    // doesn't exist yet produces an empty (frameless) track.
    framesRef.current = 0
    draw()

    // captureStream(0) → manual cadence: frames are captured only on
    // requestFrame(), which draw() calls after each paint. Driving that from a
    // setInterval (not rAF) keeps frames flowing even when the preview isn't the
    // focused surface.
    const stream = canvas.captureStream(0)
    const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    captureTrackRef.current = videoTrack
    videoTrack.requestFrame?.() // push the primed frame immediately
    drawTimerRef.current = setInterval(draw, Math.round(1000 / FPS))

    // Only mux audio if the context actually came up running; otherwise record
    // video-only so a dead audio track can't starve the muxer to zero output.
    const audioRunning = ctx.state === 'running'
    const audioTracks = audioRunning ? dest.stream.getAudioTracks() : []
    const combined = new MediaStream([videoTrack, ...audioTracks])
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: VIDEO_BITRATE })
    dataEventsRef.current = 0
    recorder.ondataavailable = (e) => {
      dataEventsRef.current++
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onerror = (ev) => {
      const err = (ev as unknown as { error?: { name?: string; message?: string } }).error
      console.error('[recorder] MediaRecorder error', err)
      setState((s) => ({
        ...s,
        error: `Recorder error${err?.name ? `: ${err.name}` : ''}`,
      }))
    }
    recorderRef.current = recorder
    recorder.start(1000) // gather in 1s chunks so nothing is lost if the tab hiccups

    // Diagnostics — what the capture stream actually looks like at start.
    console.info('[recorder] started', {
      mimeType,
      videoTracks: combined.getVideoTracks().length,
      audioTracks: combined.getAudioTracks().length,
      audioIncluded: audioRunning,
      videoTrackState: videoTrack?.readyState,
      audioSources: audioTrackIdsRef.current.size,
      audioCtxState: ctx.state,
      recorderState: recorder.state,
    })
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

    // Diagnostics — exactly what MediaRecorder produced this session.
    console.info('[recorder] stopped', {
      chunks: chunksRef.current.length,
      dataEvents: dataEventsRef.current,
      framesDrawn: framesRef.current,
      blobSize: blob.size,
      durationMs,
      mimeType,
    })

    cleanup()

    // Guard against empty captures: never store a ~0-byte file (it lands as an
    // unplayable recording, reported as "ready"). Surface a clear error carrying
    // the diagnostic counters so we can tell capture-starvation from an encoder
    // failure at a glance.
    if (blob.size < 1024) {
      const events = dataEventsRef.current
      setState({
        isRecording: false,
        isSaving: false,
        error:
          events === 0
            ? 'Recording produced no data at all (0 encoder events). Check the browser console for a recorder error.'
            : `Recording captured no video (${blob.size}B from ${events} events). Keep the session window in the foreground while recording.`,
        savedId: null,
      })
      return
    }

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

/** Draw the standard bottom-left name label used on tiles and embeds. */
function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  name: string,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  scale: number,
) {
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

/** Draw an image with object-fit: contain, centered in the dest rect. */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (!iw || !ih) return
  const scale = Math.min(dw / iw, dh / ih)
  const w = iw * scale
  const h = ih * scale
  ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h)
}

/** Draw an image with object-fit: cover into the dest rect. */
function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (!iw || !ih) return
  const scale = Math.max(dw / iw, dh / ih)
  const sw = dw / scale
  const sh = dh / scale
  const sx = (iw - sw) / 2
  const sy = (ih - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
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
