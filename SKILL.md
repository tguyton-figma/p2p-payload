# Media Recorder & Uploader — P2P Payload

You are building a browser-based media recorder app in **Figma Make** that records from the user's local A/V devices and uploads the result directly to a **Payload CMS** backend.

---

## CMS Backend

**Base URL:** `https://p2p-payload.payload.dev`

**Upload endpoint (recorder-specific — do NOT use `/api/media` directly):**
```
POST /api/recorder/upload
Content-Type: multipart/form-data
Authorization: Bearer <sessionToken>
```

**Upload fields:**
| Field      | Type   | Required | Notes                                              |
|------------|--------|----------|----------------------------------------------------|
| `file`     | File   | Yes      | The multipart file part                            |
| `_payload` | JSON   | Yes      | Must be a JSON string containing `alt` (and optionally `anchor`) |

**`alt`** (inside `_payload`): a short description shown in the CMS. Auto-generate from timestamp if no user input.
**`anchor`**: focal point select — one of `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`. Defaults to `center`.

**Important:** Non-file fields MUST be sent inside a single `_payload` JSON string. Payload's multipart parser ignores plain appended fields when a file is present.

---

## Authentication

Auth uses a **Figma OAuth flow** that runs once and issues a persistent `sessionToken` stored in `clientStorage`. The token never expires unless the user re-authenticates.

### On first launch

```js
// 1. Check for existing token
const sessionToken = await figma.clientStorage.getAsync('sessionToken')

if (!sessionToken) {
  // 2. Generate a sessionId and start OAuth
  const sessionId = crypto.randomUUID()
  await figma.clientStorage.setAsync('pendingSessionId', sessionId)

  // 3. Open the OAuth authorize URL in a new browser tab
  figma.openExternal(
    `https://p2p-payload.payload.dev/api/accounts/oauth/authorize?session_id=${sessionId}`
  )

  // 4. Poll for the token (2s interval, 5 min timeout)
  startPolling(sessionId)
}
```

### Polling for the session token

```js
async function startPolling(sessionId) {
  const maxAttempts = 150 // 5 minutes at 2s intervals
  let attempts = 0

  const interval = setInterval(async () => {
    attempts++
    if (attempts > maxAttempts) {
      clearInterval(interval)
      showError('Sign-in timed out. Please try again.')
      return
    }

    try {
      const res = await fetch(
        `https://p2p-payload.payload.dev/api/accounts/oauth/session?session_id=${sessionId}`
      )
      const data = await res.json()

      if (data.ready && data.sessionToken) {
        clearInterval(interval)
        await figma.clientStorage.setAsync('sessionToken', data.sessionToken)
        await figma.clientStorage.deleteAsync('pendingSessionId')
        onAuthenticated(data.sessionToken)
      }
    } catch (err) {
      // Network error — keep polling
    }
  }, 2000)
}
```

### On subsequent launches

```js
const sessionToken = await figma.clientStorage.getAsync('sessionToken')
if (sessionToken) {
  onAuthenticated(sessionToken)
} else {
  // Check if a sign-in was already in progress
  const pendingSessionId = await figma.clientStorage.getAsync('pendingSessionId')
  if (pendingSessionId) {
    startPolling(pendingSessionId) // Resume polling
  } else {
    showSignInPrompt()
  }
}
```

### Re-authentication (token rotation)

The session token is rotated every time the user goes through the OAuth flow again. If an upload returns `401`, prompt the user to re-authenticate:

```js
await figma.clientStorage.deleteAsync('sessionToken')
showSignInPrompt()
```

---

## Uploading a Recording

**Always use the two-step presigned URL flow.** Sending the file binary directly through our server hits Lambda's ~6MB request payload limit, causing a misleading CORS error for recordings longer than ~30 seconds.

### Step 1 — Get a presigned S3 URL

```js
async function getUploadUrl(blob, sessionToken) {
  const filename = `recording-${Date.now()}.webm`
  const mimeType = blob.type || 'video/webm'

  const res = await fetch('https://p2p-payload.payload.dev/api/recorder/upload-url', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, mimeType }),
  })

  if (res.status === 401) {
    await figma.clientStorage.deleteAsync('sessionToken')
    throw new Error('Session expired. Please sign in again.')
  }
  if (!res.ok) throw new Error(`Failed to get upload URL: ${res.status}`)
  return res.json() // { uploadUrl, filename }
}
```

### Step 2 — PUT the file directly to S3

```js
async function uploadToS3(uploadUrl, blob) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'video/webm' },
    body: blob,
  })
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`)
}
```

### Step 3 — Finalize (create the media document)

```js
async function finalizeUpload(filename, blob, altText, sessionToken) {
  const res = await fetch('https://p2p-payload.payload.dev/api/recorder/finalize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      alt: altText,
      filename,                      // safe filename from Step 1
      mimeType: blob.type || 'video/webm',
      filesize: blob.size,           // byte length, available from the Blob object
    }),
  })
  if (!res.ok) throw new Error(`Finalize failed: ${res.status} ${await res.text()}`)
  return res.json() // Returns the created Media document
}
```

### Full upload function

```js
async function uploadRecording(blob, altText, sessionToken) {
  // 1. Get presigned URL
  const { uploadUrl, filename } = await getUploadUrl(blob, sessionToken)

  // 2. Upload directly to S3 (no Lambda involved — no size limit)
  await uploadToS3(uploadUrl, blob)

  // 3. Create media document
  return finalizeUpload(filename, blob, altText, sessionToken)
}
```

---

## Recording — Browser APIs

Use only standard browser APIs (no npm packages needed):

### 1. Enumerate available devices
```js
const devices = await navigator.mediaDevices.enumerateDevices()
const videoInputs = devices.filter(d => d.kind === 'videoinput')
const audioInputs = devices.filter(d => d.kind === 'audioinput')
```
`enumerateDevices()` may return empty labels until the user grants permission; call it again after `getUserMedia` resolves.

### 2. Acquire a stream from selected devices
```js
const stream = await navigator.mediaDevices.getUserMedia({
  video: selectedVideoDeviceId ? { deviceId: { exact: selectedVideoDeviceId } } : true,
  audio: selectedAudioDeviceId ? { deviceId: { exact: selectedAudioDeviceId } } : true,
})
```

### 3. Record with MediaRecorder
```js
const chunks = []
const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
  ? 'video/webm;codecs=vp9'
  : MediaRecorder.isTypeSupported('video/webm')
  ? 'video/webm'
  : ''
const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})

recorder.ondataavailable = (e) => {
  if (e.data.size > 0) chunks.push(e.data)
}

recorder.onstop = async () => {
  const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
  const sessionToken = await figma.clientStorage.getAsync('sessionToken')
  await uploadRecording(blob, `Recording ${new Date().toLocaleString()}`, sessionToken)
}

recorder.start()

// On stop (user action):
recorder.stop()
stream.getTracks().forEach(t => t.stop()) // Release camera/mic
```

---

## App UI Requirements

1. **Auth state** — On launch, check `clientStorage` for `sessionToken`. If missing, show a "Sign in with Figma" button. While polling, show a "Waiting for sign-in..." state. Never expose the token in the UI.
2. **Source selectors** — Two dropdowns (video source, audio source) populated from `enumerateDevices`. Only show after auth.
3. **Record / Stop button** — Single toggle. Disabled until a stream is acquired and user is authenticated.
4. **Status indicator** — Shows current state: `not signed in` → `signing in...` → `ready` → `recording` → `uploading` → `done` / `error`.

---

## OAuth Endpoint Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/accounts/oauth/authorize?session_id=<id>` | GET | Opens Figma OAuth. Pass a unique `session_id`. Redirects to Figma. |
| `/api/accounts/oauth/session?session_id=<id>` | GET | Returns `{ready:false}` while pending or `{ready:true,sessionToken:"..."}` when complete. |
| `/api/recorder/upload-url` | POST | Step 1: get presigned S3 URL. Body: `{filename, mimeType}`. Returns `{uploadUrl, filename}`. |
| S3 presigned URL | PUT | Step 2: PUT blob directly to S3. No Lambda involved. No size limit. |
| `/api/recorder/finalize` | POST | Step 3: create media doc. Body: `{alt, filename, mimeType, filesize}`. Returns media doc. |

---

## CORS Considerations

The CMS CORS config allows the Make app's Figma origin. If you receive CORS errors:
- Check the `cors` array in `src/payload.config.ts` — add the Make app's origin if needed.
- Flag CORS errors distinctly in the status indicator (they surface as network errors, not HTTP status codes).

---

## Error Handling Checklist

- `getUserMedia` throws `NotAllowedError` → user denied camera/mic. Show a friendly prompt to allow access in browser settings.
- `getUserMedia` throws `NotFoundError` → no camera/mic found. Prompt to check hardware.
- Upload returns `401` → session token is invalid or expired. Clear `clientStorage` and prompt re-authentication.
- Upload returns `400` → `alt` field missing. Always populate it (use a timestamp fallback).
- Upload returns `413` → file too large. Mention as a known limitation for long recordings.
- Poll returns `{ready:false}` indefinitely → user may have closed the browser tab without completing sign-in. Show a retry button that clears `pendingSessionId` and restarts the flow.
- Network failure during upload → surface error with a retry button. Do not auto-retry silently.
