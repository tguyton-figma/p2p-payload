import type { CollectionConfig } from 'payload'
import { isAdmin, isAdminOrEditor } from '../lib/access'

/**
 * SessionRecordings
 *
 * One document per recorded live session: a single composited canvas video
 * (camera tiles + screen shares laid out fit-to-view, with everyone's audio
 * mixed into one track) captured in the host's browser and uploaded through the
 * presigned Media pipeline.
 *
 * The `video` points at the Media doc that holds the actual file — Media's own
 * enrichment pipeline fills in thumbnail/duration/dimensions asynchronously, so
 * a recording may be playable before those are populated.
 *
 * Documents are created server-side (overrideAccess) by the finalize endpoint,
 * never by clients directly. A transcript is intentionally out of scope for now;
 * the slot is left for a fast-follow.
 */
export const SessionRecordings: CollectionConfig = {
  slug: 'session-recordings',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'host', 'durationMs', 'status', 'createdAt'],
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => isAdminOrEditor(user),
    update: ({ req: { user } }) => isAdminOrEditor(user),
    delete: ({ req: { user } }) => isAdmin(user),
  },
  hooks: {
    beforeValidate: [
      ({ data, operation }) => {
        if (operation === 'create' && data?.startedAt && !data.title) {
          const d = new Date(data.startedAt)
          data.title = `Session ${d.toISOString().slice(0, 16).replace('T', ' ')}`
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'video',
      type: 'relationship',
      relationTo: 'media',
      admin: {
        readOnly: true,
        description: 'The composited canvas recording (video + mixed audio).',
      },
    },
    {
      // Inline player + copy-production-link button for the recorded file.
      name: 'preview',
      type: 'ui',
      admin: {
        condition: (data) => Boolean(data?.video),
        components: {
          Field: '/components/admin/SessionRecordingPlayer#SessionRecordingPlayer',
        },
      },
    },
    {
      name: 'host',
      type: 'relationship',
      relationTo: 'accounts',
      required: true,
      index: true,
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'room',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'LiveKit room name the recording was captured from.',
      },
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'ready',
      options: [
        { label: 'Recording', value: 'recording' },
        { label: 'Processing', value: 'processing' },
        { label: 'Ready', value: 'ready' },
        { label: 'Failed', value: 'failed' },
      ],
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'startedAt',
      type: 'date',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        readOnly: true,
        description: 'When the host started recording.',
      },
    },
    {
      name: 'endedAt',
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        readOnly: true,
      },
    },
    {
      name: 'durationMs',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Recording length in milliseconds (client-measured).',
      },
    },
    {
      name: 'participants',
      type: 'array',
      admin: {
        readOnly: true,
        description: 'Snapshot of who was in the session when it was recorded.',
      },
      fields: [
        { name: 'identity', type: 'text' },
        { name: 'name', type: 'text' },
      ],
    },
  ],
}
