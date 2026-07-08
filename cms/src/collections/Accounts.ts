import type { CollectionConfig } from 'payload'
import { accountsOAuthEndpoints } from '../endpoints/accounts/oauth'

/**
 * Accounts collection
 *
 * Stores identities provisioned via the Figma OAuth flow in the recorder app.
 * All CRUD is locked — records are created and updated exclusively by the
 * OAuth callback endpoint using overrideAccess: true.
 *
 * sessionToken: the token the Make app uses to authenticate recorder uploads.
 * pendingSessionId: temporary field cleared after the Make app polls for its
 *   session token; stored in the DB so it survives across Lambda instances.
 */
export const Accounts: CollectionConfig = {
  slug: 'accounts',
  admin: {
    useAsTitle: 'handle',
    defaultColumns: ['handle', 'email', 'figmaId', 'updatedAt'],
  },
  access: {
    create: () => false,
    // Admins can read accounts so relationships render in the admin panel
    read: ({ req: { user } }) => Boolean((user as any)?.roles?.includes('admin')),
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'figmaId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'handle',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'email',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'avatarUrl',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'accessToken',
      type: 'text',
      admin: { hidden: true },
      // Never expose Figma tokens in API responses
      access: { read: () => false },
    },
    {
      name: 'refreshToken',
      type: 'text',
      admin: { hidden: true },
      access: { read: () => false },
    },
    {
      name: 'tokenExpiresAt',
      type: 'date',
      admin: { hidden: true },
      access: { read: () => false },
    },
    {
      name: 'sessionToken',
      type: 'text',
      index: true,
      admin: { hidden: true },
      access: { read: () => false },
    },
    {
      name: 'pendingSessionId',
      type: 'text',
      index: true,
      admin: { hidden: true },
      access: { read: () => false },
    },
  ],
  endpoints: accountsOAuthEndpoints,
  timestamps: true,
}
