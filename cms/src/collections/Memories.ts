import type { CollectionConfig } from 'payload'

export const Memories: CollectionConfig = {
  slug: 'memories',
  admin: {
    useAsTitle: 'type',
    defaultColumns: ['type', 'moment', 'author', 'createdAt'],
    group: 'book',
  },
  access: {
    // Readable by any authenticated user (memories are tied to moment access in the client)
    read: ({ req: { user } }) => Boolean(user),
    // Any authenticated user can create memories (system or user messages)
    create: ({ req: { user } }) => Boolean(user),
    // Append-only: no updates
    update: () => false,
    // Only admins can delete memories
    delete: ({ req: { user } }) => Boolean(user?.roles?.includes('admin')),
  },
  timestamps: true,
  fields: [
    {
      name: 'moment',
      type: 'relationship',
      relationTo: 'moments',
      required: true,
      index: true,
      admin: {
        description: 'The moment this memory belongs to.',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'System', value: 'system' },
        { label: 'Message', value: 'message' },
        { label: 'Activity', value: 'activity' },
        { label: 'Artifact', value: 'artifact' },
      ],
    },
    {
      name: 'content',
      type: 'richText',
      admin: {
        description: 'The event payload — message text, system event description, etc.',
      },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'accounts',
      admin: {
        description: 'Who or what generated this memory. Null for pure system events.',
      },
    },
    {
      name: 'metadata',
      type: 'json',
      admin: {
        description: 'Flexible payload for typed events (e.g. link clicked, status changed to X, participant added).',
      },
    },
  ],
}
