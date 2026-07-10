'use client'

import { memo } from 'react'
import type { NodeProps, Node } from '@xyflow/react'

// A Figma file embedded on the canvas via EmbedKit 2.0, rendered as a React Flow
// node. The iframe body stays fully interactive because the node only drags from
// its header (set as the node's `dragHandle` when the node is created) — dragging
// over the iframe pans nothing and reaches Figma instead.
//
// `url` and `name` are shared over the data channel (see EmbedSpec in
// SessionCanvas); `onRemove` is injected locally when the node is built, so it is
// never serialized onto the wire.

export type FigmaEmbedNodeData = {
  url: string
  name: string
  // File key + node id (REST API form) so the recorder can render a still.
  fileKey: string
  nodeId: string | null
  onRemove: () => void
}

export type FigmaEmbedFlowNode = Node<FigmaEmbedNodeData, 'figmaEmbed'>

function FigmaEmbedNodeImpl({ data }: NodeProps<FigmaEmbedFlowNode>) {
  return (
    <div className="figma-embed-node">
      {/* Drag handle — the only region that moves the node. */}
      <div className="figma-embed-node__header">
        <span className="figma-embed-node__title" title={data.name}>
          <span className="figma-embed-node__glyph" aria-hidden>
            ◆
          </span>
          {data.name}
        </span>
        <button
          type="button"
          className="figma-embed-node__remove nodrag"
          onClick={data.onRemove}
          title="Remove from canvas"
          aria-label="Remove Figma embed"
        >
          ✕
        </button>
      </div>
      <iframe
        className="figma-embed-node__frame nodrag"
        src={data.url}
        title={data.name}
        allow="fullscreen; clipboard-write"
        allowFullScreen
        loading="lazy"
      />
    </div>
  )
}

// Memoize: React Flow re-renders nodes often; the iframe only needs to change
// when its url/name change (a stale onRemove closure is harmless — it captures a
// stable id).
export const FigmaEmbedNode = memo(FigmaEmbedNodeImpl)
