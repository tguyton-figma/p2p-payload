import type { CollectionConfig } from 'payload'

/**
 * Sessions — the anchor for a 1:1 WebRTC call.
 *
 * Signaling messages (offer / answer / ICE candidates) do NOT live here — they
 * are append-only rows in the `signals` collection, one document per message.
 * Writing each signal as its own insert avoids the lost-update race that a
 * shared, repeatedly-updated document suffers under Payload's read-modify-write
 * update semantics.
 *
 * Media never touches the server: once the handshake completes, audio/video
 * flows directly peer-to-peer.
 */
export const Sessions: CollectionConfig = {
  slug: 'sessions',
  admin: {
    group: 'streaming',
    useAsTitle: 'id',
    defaultColumns: ['id', 'status', 'updatedAt'],
  },
  access: {
    read: ({ req: { user } }) => Boolean(user),
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user?.roles?.includes('admin')),
  },
  fields: [
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Waiting', value: 'waiting' },
        { label: 'Connected', value: 'connected' },
        { label: 'Ended', value: 'ended' },
      ],
      defaultValue: 'waiting',
      required: true,
      index: true,
    },
  ],
}
