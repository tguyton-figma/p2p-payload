import type { CollectionConfig } from 'payload'

/**
 * Sessions — domain anchor for a live A/V session (see ADR-0001).
 *
 * Realtime media and signaling are handled entirely by LiveKit (the SFU); this
 * collection is the CMS-side record of a session, intended to map to a LiveKit
 * room and link it to a Moment, participating Accounts, and the resulting
 * Recording. That domain wiring is not built yet — for now the row is just a
 * lifecycle anchor. Rooms are currently keyed by name at join time and no
 * Session document is created automatically.
 */
export const Sessions: CollectionConfig = {
  slug: 'sessions',
  admin: {
    group: 'streaming',
    useAsTitle: 'id',
    defaultColumns: ['id', 'status', 'updatedAt'],
  },
  access: {
    // Any authenticated principal — a signed-in Account or an admin/editor User.
    read: ({ req: { user } }) => Boolean(user),
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Boolean((user as any)?.collection === 'accounts' || (user as any)?.roles),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete: ({ req: { user } }) => Boolean((user as any)?.roles?.includes('admin')),
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
