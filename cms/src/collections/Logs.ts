import type { CollectionConfig } from 'payload'
import { isAdmin } from '../lib/access'

export const Logs: CollectionConfig = {
  slug: 'logs',
  admin: {
    useAsTitle: 'subject',
    defaultColumns: ['subject', 'source', 'timelineId', 'createdAt'],
  },
  access: {
    read: ({ req: { user } }) => isAdmin(user),
    create: ({ req: { user } }) => Boolean(user),
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'subject',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'data',
      type: 'json',
      label: 'Payload',
    },
    {
      name: 'source',
      type: 'select',
      options: [
        { label: 'Client',   value: 'client' },
        { label: 'Server',   value: 'server' },
        { label: 'Recorder', value: 'recorder' },
      ],
      required: true,
    },
    {
      name: 'userId',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'timelineId',
      type: 'text',
      index: true,
    },
    {
      name: 'sessionId',
      type: 'text',
      index: true,
    },
    {
      name: 'accountId',
      type: 'relationship',
      relationTo: 'accounts',
      admin: {
        description: 'Recorder account that triggered this log entry.',
      },
    },
  ],
}
