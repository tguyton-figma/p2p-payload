import type { MediaFlowNode } from './MediaNode'
import type { FigmaEmbedFlowNode } from './FigmaEmbedNode'

// The union of every node type the session canvas can hold. Lives in its own
// module so the recorder can import the union without pulling in SessionCanvas
// (which imports the recorder) and creating a cycle.
export type SessionFlowNode = MediaFlowNode | FigmaEmbedFlowNode

export const isMediaNode = (n: SessionFlowNode): n is MediaFlowNode => n.type === 'media'

export const isFigmaEmbedNode = (n: SessionFlowNode): n is FigmaEmbedFlowNode =>
  n.type === 'figmaEmbed'
