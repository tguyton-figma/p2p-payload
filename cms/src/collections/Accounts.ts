import type { CollectionConfig } from 'payload'
import { parseCookies } from 'payload/shared'
import { accountsOAuthEndpoints } from '../endpoints/accounts/oauth'
import { PP_ACCOUNT_COOKIE } from '../lib/oauth/server/account-auth'

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
  auth: {
    // No password login — identities come from Figma OAuth. A custom strategy
    // authenticates browser requests via the httpOnly `pp_account` cookie set at
    // sign-in, so payload.auth() returns the Account as req.user.
    disableLocalStrategy: true,
    strategies: [
      {
        name: 'account-session',
        authenticate: async ({ headers, payload }) => {
          const cookies = parseCookies(headers)
          // Defer to a Payload admin (Users) session when one is present. The
          // admin panel is served on the same host as the app, so its requests
          // also carry the `pp_account` cookie — without this, signing into the
          // app would authenticate an admin as an Account (which has no roles)
          // and lock them out of the admin panel. App requests still resolve the
          // account via getAccountFromRequest's direct-cookie fallback, so this
          // only changes who wins for admin auth.
          if (cookies.get('payload-token')) return { user: null }
          const token = cookies.get(PP_ACCOUNT_COOKIE)
          if (!token) return { user: null }
          const { docs } = await payload.find({
            collection: 'accounts',
            where: { sessionToken: { equals: token } },
            limit: 1,
            overrideAccess: true,
            depth: 0,
          })
          if (!docs.length) return { user: null }
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user: { ...docs[0], collection: 'accounts', _strategy: 'account-session' } as any,
          }
        },
      },
    ],
  },
  access: {
    create: () => false,
    // Admins read all (for admin-panel relationships); a signed-in account reads
    // only its own record.
    read: ({ req: { user } }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((user as any)?.roles?.includes('admin')) return true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((user as any)?.collection === 'accounts') return { id: { equals: (user as any).id } }
      return false
    },
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
