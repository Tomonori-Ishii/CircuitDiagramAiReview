import { useRef, useState, type PointerEvent } from 'react';
import { boxFromPoints } from '../core/editing';

export interface OverlayBox {
  id: string;
  label: string;
  bbox: { x: number; y: number; w: number; h: number };
  nodeLabel?: string;
}

interface Props {
  src: string;
  boxes: OverlayBox[];
  selectedId?: string;
  highlightIds?: string[];
  opacity: number;
  onSelect?: (id: string) => void;
  /** 選択中の部品の枠を描く（ドラッグ）ときに呼ぶ */
  drawFor?: string;
  onDraw?: (id: string, bbox: { x: number; y: number; w: number; h: number }) => void;
}

export function ImageOverlay({ src, boxes, selectedId, highlightIds = [], opacity, onSelect, drawFor, onDraw }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [now, setNow] = useState<{ x: number; y: number } | null>(null);

  const norm = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  return (
    <div
      ref={ref}
      className="overlay"
      data-testid="overlay"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        if (!drawFor) return;
        const p = norm(e);
        setStart(p);
        setNow(p);
      }}
      onPointerMove={(e) => {
        if (start) setNow(norm(e));
      }}
      onPointerUp={() => {
        if (drawFor && start && now && onDraw) {
          const b = boxFromPoints(start, now);
          if (b.w > 0.005 && b.h > 0.005) onDraw(drawFor, b);
        }
        setStart(null);
        setNow(null);
      }}
    >
      <img src={src} alt="回路図" draggable={false} />
      <div className="overlay-layer" style={{ opacity }}>
        {boxes.map((b) => {
          const hl = highlightIds.includes(b.id);
          return (
            <button
              type="button"
              key={b.id}
              data-testid={`box-${b.id}`}
              className={`box${b.id === selectedId ? ' selected' : ''}${hl ? ' highlight' : ''}`}
              style={{
                left: `${b.bbox.x * 100}%`,
                top: `${b.bbox.y * 100}%`,
                width: `${b.bbox.w * 100}%`,
                height: `${b.bbox.h * 100}%`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(b.id);
              }}
            >
              <span>{b.label}</span>
              {b.nodeLabel && <em>{b.nodeLabel}</em>}
            </button>
          );
        })}
        {start && now && (() => {
          const d = boxFromPoints(start, now);
          return <div className="draw" style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: `${d.w * 100}%`, height: `${d.h * 100}%` }} />;
        })()}
      </div>
    </div>
  );
}
