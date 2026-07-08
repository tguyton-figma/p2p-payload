import path from 'path'
import { buildFigmaConfig } from '@payloadcms/figma'
import { fileURLToPath } from 'url'
import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Timelines } from './collections/Timelines'
import { Recordings } from './collections/Recordings'
import { Logs } from './collections/Logs'
import { Accounts } from './collections/Accounts'
import { Moments } from './collections/Moments'
import { Memories } from './collections/Memories'
import { Sessions } from './collections/Sessions'
import { Signals } from './collections/Signals'
import { Participants } from './collections/Participants'
import { enrichMediaTask } from './jobs/enrichMedia'
import { recorderUpload } from './endpoints/recorder/upload'
import { recorderUploadUrl } from './endpoints/recorder/upload-url'
import { recorderFinalize } from './endpoints/recorder/finalize'
import { recorderFinalizeSession } from './endpoints/recorder/finalize-session'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildFigmaConfig({
  cors: ['https://p2p-payload.figma.site'],
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      header: [
        '/components/admin/SonnerBridge#SonnerBridge',
        '/components/admin/NotificationStream#NotificationStream',
      ],
    },
  },
  collections: [Users, Media, Timelines, Recordings, Logs, Accounts, Moments, Memories, Sessions, Signals, Participants],
  endpoints: [
    recorderUpload,
    recorderUploadUrl,
    recorderFinalize,
    recorderFinalizeSession,
  ],
  jobs: {
    tasks: [
      {
        slug: 'enrich-media',
        // Function handler (not a string path): Figma runs jobs via the
        // /api/payload-jobs/run endpoint inside Next.js, where Payload
        // recommends function handlers. ffmpeg/sharp stay external via
        // next.config.mjs, so importing this does not bundle their binaries.
        handler: enrichMediaTask,
        inputSchema: [{ name: 'mediaId', type: 'text', required: true }],
        // Retry transient ffmpeg/network failures; already-populated fields
        // are skipped on the re-run so successful sub-jobs are not repeated.
        retries: { attempts: 2, backoff: { type: 'exponential', delay: 2000 } },
      },
    ],
  },
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  plugins: [],
  figma: {},
})
