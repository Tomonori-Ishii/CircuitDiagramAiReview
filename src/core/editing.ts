// ネットリストの編集操作（FR-CK-04、FR-CK-05 の前提）。すべて純関数。
import { type Annotation, type Kind, type Netlist, type NetNode, type Part, type SourceMode, TERMINALS, VALUED_KINDS } from './netlist';
import { compose, parseValueText } from './units';

export function nextId(existing: string[], prefix: string): string {
  let i = 1;
  while (existing.includes(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

const PREFIX_OF: Partial<Record<Kind, string>> = { R: 'R', C: 'C', L: 'L', V: 'V', I: 'I', OPAMP: 'U', D: 'D', Q: 'Q', M: 'M' };

export function addPart(netlist: Netlist, kind: Kind): Netlist {
  const id = nextId(netlist.parts.map((p) => p.id), PREFIX_OF[kind] ?? 'X');
  const part: Part = {
    id,
    kind,
    value: null,
    valueRaw: '',
    sourceMode: ['V', 'I'].includes(kind) ? 'dc' : undefined,
    pins: {},
    block: '',
  };
  return { ...netlist, parts: [...netlist.parts, part] };
}

export function removePart(netlist: Netlist, id: string): Netlist {
  return {
    ...netlist,
    parts: netlist.parts.filter((p) => p.id !== id),
    annotations: netlist.annotations.map((a) =>
      a.target?.type === 'part' && a.target.id === id ? { ...a, target: null } : a,
    ),
  };
}

function updatePart(netlist: Netlist, id: string, f: (p: Part) => Part): Netlist {
  return { ...netlist, parts: netlist.parts.map((p) => (p.id === id ? f(p) : p)) };
}

/** 種別を変える。端子割当は新しい種別の端子名だけ残す。 */
export function setKind(netlist: Netlist, id: string, kind: Kind): Netlist {
  return updatePart(netlist, id, (p) => {
    const keep: Record<string, string> = {};
    for (const t of TERMINALS[kind]) if (p.pins[t]) keep[t] = p.pins[t];
    return {
      ...p,
      kind,
      pins: keep,
      value: VALUED_KINDS.includes(kind) ? p.value : null,
      sourceMode: ['V', 'I'].includes(kind) ? (p.sourceMode ?? 'dc') : undefined,
    };
  });
}

/** 値を数値・接頭辞・単位から設定する。元の表記も残す。 */
export function setValueParts(netlist: Netlist, id: string, numberText: string, prefix: string, unit: string): { netlist: Netlist; error?: string } {
  const r = compose(numberText, prefix, unit);
  const raw = `${numberText.trim()}${prefix}${unit}`;
  if (!r.ok) return { netlist: updatePart(netlist, id, (p) => ({ ...p, value: null, valueRaw: raw })), error: r.error };
  return { netlist: updatePart(netlist, id, (p) => ({ ...p, value: r.value, valueRaw: raw })) };
}

/** 表記の文字列（例 4.7kΩ）から設定する。 */
export function setValueText(netlist: Netlist, id: string, text: string): { netlist: Netlist; error?: string } {
  const r = parseValueText(text);
  if (!r.ok) return { netlist: updatePart(netlist, id, (p) => ({ ...p, value: null, valueRaw: text })), error: r.error };
  return { netlist: updatePart(netlist, id, (p) => ({ ...p, value: r.value, valueRaw: text })) };
}

export function setSourceMode(netlist: Netlist, id: string, mode: SourceMode): Netlist {
  return updatePart(netlist, id, (p) => ({ ...p, sourceMode: mode }));
}

export function setPin(netlist: Netlist, id: string, terminal: string, node: string): Netlist {
  return updatePart(netlist, id, (p) => ({ ...p, pins: { ...p.pins, [terminal]: node } }));
}

export function setBlock(netlist: Netlist, id: string, block: string): Netlist {
  return updatePart(netlist, id, (p) => ({ ...p, block }));
}

export function setBBox(netlist: Netlist, id: string, bbox: Part['bbox']): Netlist {
  return updatePart(netlist, id, (p) => ({ ...p, bbox: bbox && clampBox(bbox) }));
}

export function clampBox(b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const x = Math.min(Math.max(b.x, 0), 1);
  const y = Math.min(Math.max(b.y, 0), 1);
  const w = Math.min(Math.max(b.w, 0), 1 - x);
  const h = Math.min(Math.max(b.h, 0), 1 - y);
  return { x, y, w, h };
}

/** ドラッグの開始点と終了点から矩形を作る（0〜1 にクランプ）。 */
export function boxFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; w: number; h: number } {
  return clampBox({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
}

export function addNode(netlist: Netlist, id?: string): { netlist: Netlist; node: NetNode } {
  const nodeId = id ?? nextId(netlist.nodes.map((n) => n.id), 'N');
  const node: NetNode = { id: nodeId };
  if (netlist.nodes.some((n) => n.id === nodeId)) return { netlist, node };
  return { netlist: { ...netlist, nodes: [...netlist.nodes, node] }, node };
}

export function addAnnotation(netlist: Netlist, text: string, target: Annotation['target'] = null): Netlist {
  const id = nextId(netlist.annotations.map((a) => a.id), 'A');
  return { ...netlist, annotations: [...netlist.annotations, { id, text, target }] };
}

export function updateAnnotation(netlist: Netlist, id: string, f: (a: Annotation) => Annotation): Netlist {
  return { ...netlist, annotations: netlist.annotations.map((a) => (a.id === id ? f(a) : a)) };
}

export function removeAnnotation(netlist: Netlist, id: string): Netlist {
  return { ...netlist, annotations: netlist.annotations.filter((a) => a.id !== id) };
}

/** 値だけを変える（修正案の適用に使う）。 */
export function setValue(netlist: Netlist, id: string, value: number): Netlist {
  return updatePart(netlist, id, (p) => ({ ...p, value, valueRaw: `${value}` }));
}
