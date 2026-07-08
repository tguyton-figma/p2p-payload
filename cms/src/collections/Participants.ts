import type { CollectionConfig } from 'payload'

/**
 * Participants — mesh room membership.
 *
 * One row per peer in a session (session, peerId, lastSeen). Each peer only
 * ever touches its own row — heartbeating by bumping lastSeen — so there is no
 * contention on a shared document. Discovery is a query for rows in the session
 * whose lastSeen is recent; stale rows are treated as departed.
 *
 * The join endpoint uses the active count here to enforce the room cap.
 */
export const Participants: CollectionConfig = {
  slug: 'participants',
  admin: {
    group: 'streaming',
    useAsTitle: 'peerId',
    defaultColumns: ['session', 'peerId', 'lastSeen'],
  },
  access: {
    read: ({ req: { user } }) => Boolean(user),
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user),
  },
  fields: [
    {
      name: 'session',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'ID of the session this participant belongs to.' },
    },
    {
      name: 'peerId',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'lastSeen',
      type: 'number',
      required: true,
      admin: { description: 'Epoch ms of the last heartbeat.' },
    },
  ],
}
