'use client'

import { useCallback, useState } from 'react'
import { LiveKitRoom, VideoConference } from '@livekit/components-react'
import '@livekit/components-styles'
import './session.css'

// A live session is a LiveKit room. We fetch a short-lived, room-scoped access
// token from our own /api/livekit/token endpoint (which also returns the server
// URL, so no public env var is needed), then hand it to <LiveKitRoom>. LiveKit's
// SFU handles signaling, media forwarding, and reconnection — this replaces the
// old hand-rolled P2P mesh, and scales to many-to-many (1-10) without the mesh
// fan-out cap.

interface Connection {
  room: string
  token: string
  url: string
}

async function fetchToken(room: string): Promise<{ token: string; url: string }> {
  const res = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Could not join the room.')
  }
  return (await res.json()) as { token: string; url: string }
}

export default function SessionPage() {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [joinId, setJoinId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const connect = useCallback(async (room: string) => {
    setError(null)
    setConnecting(true)
    try {
      const { token, url } = await fetchToken(room)
      setConnection({ room, token, url })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the room.')
    } finally {
      setConnecting(false)
    }
  }, [])

  // Start a new call with a short random room name; anyone with the name can join.
  const createRoom = useCallback(() => void connect(crypto.randomUUID().slice(0, 8)), [connect])
  const joinRoom = useCallback(() => {
    const id = joinId.trim()
    if (id) void connect(id)
  }, [connect, joinId])

  if (connection) {
    return (
      <div className="session session--live">
        <header className="session__bar">
          <h1 className="session__title">Session</h1>
          <div className="session__meta">
            <code className="session__id">{connection.room}</code>
            <button
              className="session__btn session__btn--ghost"
              onClick={() => navigator.clipboard?.writeText(connection.room)}
            >
              Copy ID
            </button>
          </div>
        </header>
        <LiveKitRoom
          className="session__room"
          token={connection.token}
          serverUrl={connection.url}
          connect
          video
          audio
          data-lk-theme="default"
          onDisconnected={() => setConnection(null)}
          onError={(e) => setError(e.message)}
        >
          <VideoConference />
        </LiveKitRoom>
      </div>
    )
  }

  return (
    <div className="session">
      <header className="session__bar">
        <h1 className="session__title">Live Session</h1>
        <div className="session__controls">
          <button
            className="session__btn session__btn--primary"
            onClick={createRoom}
            disabled={connecting}
          >
            {connecting ? 'Connecting…' : 'Start call'}
          </button>
          <span className="session__or">or</span>
          <input
            className="session__input"
            placeholder="Room ID"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') joinRoom()
            }}
          />
          <button className="session__btn" onClick={joinRoom} disabled={connecting}>
            Join
          </button>
        </div>
      </header>
      {error && <p className="session__error">{error}</p>}
    </div>
  )
}
