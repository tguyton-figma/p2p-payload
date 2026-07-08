import type { CollectionConfig } from 'payload'

/**
 * Signals — append-only WebRTC signaling messages.
 *
 * One document per message (offer, answer, or a single ICE candidate). Peers
 * only ever CREATE rows here; they never update a shared document, so there is
 * no read-modify-write race and no lost candidates.
 *
 * Messages are addressed peer-to-peer: `from` and `to` are peer IDs. In a mesh
 * each pair of peers exchanges its own offer/answer/candidates, and a peer polls
 * for rows where `to` is its own ID, deduping by document id.
 */
export const Signals: CollectionConfig = {
  slug: 'signals',
  admin: {
    group: 'streaming',
    useAsTitle: 'id',
    defaultColumns: ['session', 'from', 'kind', 'createdAt'],
  },
  access: {
    read: ({ req: { user } }) => Boolean(user),
    create: ({ req: { user } }) => Boolean(user),
    update: () => false,
    delete: ({ req: { user } }) => Boolean(user?.roles?.includes('admin')),
  },
  fields: [
    {
      name: 'session',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'ID of the session this signal belongs to.' },
    },
    {
      name: 'from',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Peer ID that sent this signal.' },
    },
    {
      name: 'to',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Peer ID this signal is addressed to.' },
    },
    {
      name: 'kind',
      type: 'select',
      options: [
        { label: 'Offer', value: 'offer' },
        { label: 'Answer', value: 'answer' },
        { label: 'Candidate', value: 'candidate' },
      ],
      required: true,
    },
    {
      name: 'data',
      type: 'json',
      admin: { description: 'SDP description or a single ICE candidate.' },
    },
  ],
}
