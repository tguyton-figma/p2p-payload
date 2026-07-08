'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import './session.css'

// Google's public STUN servers are enough for peers on the same/friendly
// network. Cross-network calls (~15% of cases) will need a TURN relay — added
// in a later slice.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
]

const MAX_PARTICIPANTS = 5
const PARTICIPANT_POLL_MS = 3000
const SIGNAL_POLL_MS = 1000

type Phase = 'idle' | 'active'
type SignalKind = 'offer' | 'answer' | 'candidate'

interface Signal {
  id: string
  from: string
  kind: SignalKind
  data: unknown
}

async function postSignal(
  sessionId: string,
  from: string,
  to: string,
  kind: SignalKind,
  data: unknown,
) {
  await fetch(`/api/sessions/${sessionId}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, kind, data }),
  })
}

async function getSignals(sessionId: string, to: string): Promise<Signal[]> {
  const res = await fetch(`/api/sessions/${sessionId}/signals?to=${encodeURIComponent(to)}`)
  if (!res.ok) return []
  return (await res.json()).signals as Signal[]
}

/** Renders one remote peer's stream. */
function RemoteTile({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return (
    <figure className="session__tile session__tile--remote">
      <video ref={ref} autoPlay playsInline />
      <figcaption>Peer</figcaption>
    </figure>
  )
}

export default function SessionPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [sessionId, setSessionId] = useState('')
  const [joinId, setJoinId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remotes, setRemotes] = useState<Record<string, MediaStream>>({})

  const meRef = useRef<string>('')
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const seenRef = useRef<Set<string>>(new Set())
  const participantTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const signalTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Bind local preview once the stream + element exist.
  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream
  }, [localStream])

  const removePeer = useCallback((peerId: string) => {
    const pc = pcsRef.current.get(peerId)
    if (pc) {
      pc.close()
      pcsRef.current.delete(peerId)
    }
    setRemotes((prev) => {
      if (!(peerId in prev)) return prev
      const next = { ...prev }
      delete next[peerId]
      return next
    })
  }, [])

  const createPeer = useCallback((sessionId: string, remoteId: string) => {
    const me = meRef.current
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!))
    pc.onicecandidate = (e) => {
      if (e.candidate) void postSignal(sessionId, me, remoteId, 'candidate', e.candidate.toJSON())
    }
    pc.ontrack = (e) => {
      setRemotes((prev) => ({ ...prev, [remoteId]: e.streams[0] }))
    }
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) removePeer(remoteId)
    }
    pcsRef.current.set(remoteId, pc)
    return pc
  }, [removePeer])

  // A new/known peer we should connect to: the higher peer ID initiates, so
  // exactly one side offers (no glare) even on simultaneous joins.
  const initiateTo = useCallback(
    async (sessionId: string, remoteId: string) => {
      const pc = createPeer(sessionId, remoteId)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await postSignal(sessionId, meRef.current, remoteId, 'offer', {
        type: offer.type,
        sdp: offer.sdp,
      })
    },
    [createPeer],
  )

  // Returns false if the signal couldn't be applied yet (retry next poll).
  const handleSignal = useCallback(
    async (sessionId: string, sig: Signal): Promise<boolean> => {
      const remoteId = sig.from
      if (sig.kind === 'offer') {
        const pc = pcsRef.current.get(remoteId) ?? createPeer(sessionId, remoteId)
        await pc.setRemoteDescription(sig.data as RTCSessionDescriptionInit)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await postSignal(sessionId, meRef.current, remoteId, 'answer', {
          type: answer.type,
          sdp: answer.sdp,
        })
        return true
      }
      if (sig.kind === 'answer') {
        const pc = pcsRef.current.get(remoteId)
        if (!pc) return true // stale answer for a torn-down peer
        if (!pc.currentRemoteDescription) {
          await pc.setRemoteDescription(sig.data as RTCSessionDescriptionInit)
        }
        return true
      }
      // candidate — needs the remote description in place first
      const pc = pcsRef.current.get(remoteId)
      if (!pc || !pc.remoteDescription) return false
      try {
        await pc.addIceCandidate(sig.data as RTCIceCandidateInit)
      } catch {
        /* ignore malformed/duplicate candidate */
      }
      return true
    },
    [createPeer],
  )

  const stopLoops = useCallback(() => {
    if (participantTimer.current) clearInterval(participantTimer.current)
    if (signalTimer.current) clearInterval(signalTimer.current)
    participantTimer.current = null
    signalTimer.current = null
  }, [])

  const leave = useCallback(
    (sessionId: string) => {
      stopLoops()
      pcsRef.current.forEach((pc) => pc.close())
      pcsRef.current.clear()
      if (meRef.current) {
        void fetch(
          `/api/sessions/${sessionId}/participants?peerId=${encodeURIComponent(meRef.current)}`,
          { method: 'DELETE' },
        )
      }
    },
    [stopLoops],
  )

  const join = useCallback(
    async (sessionId: string) => {
      setError(null)
      const me = crypto.randomUUID()
      meRef.current = me

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch {
        setError('Camera/microphone access is required.')
        return
      }
      localStreamRef.current = stream

      // Register (enforces the room cap) before showing the call UI.
      const res = await fetch(`/api/sessions/${sessionId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: me }),
      })
      if (!res.ok) {
        stream.getTracks().forEach((t) => t.stop())
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Could not join the session.')
        return
      }

      setSessionId(sessionId)
      setLocalStream(stream)
      setPhase('active')

      // Discover peers + heartbeat: reconcile the mesh against the roster.
      const pollParticipants = async () => {
        const r = await fetch(`/api/sessions/${sessionId}/participants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: me }),
        })
        if (!r.ok) return
        const { peers } = (await r.json()) as { peers: string[] }
        const others = peers.filter((p) => p !== me)
        for (const p of others) {
          // Higher ID initiates; the other side answers the incoming offer.
          if (!pcsRef.current.has(p) && me > p) await initiateTo(sessionId, p)
        }
        for (const known of [...pcsRef.current.keys()]) {
          if (!others.includes(known)) removePeer(known)
        }
      }

      const pollSignals = async () => {
        const signals = await getSignals(sessionId, me)
        for (const sig of signals) {
          if (seenRef.current.has(sig.id)) continue
          const consumed = await handleSignal(sessionId, sig)
          if (consumed) seenRef.current.add(sig.id)
        }
      }

      await pollParticipants()
      participantTimer.current = setInterval(() => void pollParticipants().catch(() => {}), PARTICIPANT_POLL_MS)
      signalTimer.current = setInterval(() => void pollSignals().catch(() => {}), SIGNAL_POLL_MS)
    },
    [handleSignal, initiateTo, removePeer],
  )

  const createRoom = useCallback(async () => {
    const { id } = await fetch('/api/sessions', { method: 'POST' }).then((r) => r.json())
    await join(id)
  }, [join])

  const joinRoom = useCallback(async () => {
    const id = joinId.trim()
    if (id) await join(id)
  }, [join, joinId])

  // Teardown on unmount.
  useEffect(() => {
    return () => {
      stopLoops()
      pcsRef.current.forEach((pc) => pc.close())
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [stopLoops])

  const remoteEntries = Object.entries(remotes)
  const count = phase === 'active' ? remoteEntries.length + 1 : 0

  return (
    <div className="session">
      <header className="session__bar">
        <h1 className="session__title">P2P Session</h1>
        {phase === 'idle' ? (
          <div className="session__controls">
            <button className="session__btn session__btn--primary" onClick={createRoom}>
              Start call
            </button>
            <span className="session__or">or</span>
            <input
              className="session__input"
              placeholder="Session ID"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
            />
            <button className="session__btn" onClick={joinRoom}>
              Join
            </button>
          </div>
        ) : (
          <div className="session__meta">
            <code className="session__id">{sessionId}</code>
            <button
              className="session__btn session__btn--ghost"
              onClick={() => navigator.clipboard?.writeText(sessionId)}
            >
              Copy ID
            </button>
            <span className="session__count">
              {count}/{MAX_PARTICIPANTS}
            </span>
          </div>
        )}
      </header>

      {error && <p className="session__error">{error}</p>}

      <div className="session__stage">
        {phase === 'active' && (
          <figure className="session__tile">
            <video ref={localVideoRef} autoPlay playsInline muted />
            <figcaption>You</figcaption>
          </figure>
        )}
        {remoteEntries.map(([peerId, stream]) => (
          <RemoteTile key={peerId} stream={stream} />
        ))}
      </div>
    </div>
  )
}
