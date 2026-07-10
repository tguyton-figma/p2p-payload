import type { ParticipantFlowNode } from './ParticipantNode'
import type { FigmaEmbedFlowNode } from './FigmaEmbedNode'

// The union of every node type the session canvas can hold. Lives in its own
// module so the recorder can import the union without pulling in SessionCanvas
// (which imports the recorder) and creating a cycle.
export type SessionFlowNode = ParticipantFlowNode | FigmaEmbedFlowNode

export const isParticipantNode = (n: SessionFlowNode): n is ParticipantFlowNode =>
  n.type === 'participant'

export const isFigmaEmbedNode = (n: SessionFlowNode): n is FigmaEmbedFlowNode =>
  n.type === 'figmaEmbed'
