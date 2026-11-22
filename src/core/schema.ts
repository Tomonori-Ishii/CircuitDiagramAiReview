// ネットリストの形式検証（読込時）。意味の検査（確定前の検査）とは別。
import { KINDS, type Annotation, type Netlist, type Part } from './netlist';

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseNetlist(v: unknown): Parsed<Netlist> {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ['ネットリストがオブジェクトではありません'] };
  const parts: Part[] = [];
  if (!Array.isArray(v.parts)) errors.push('parts が配列ではありません');
  else {
    v.parts.forEach((p, i) => {
      if (!isObj(p) || typeof p.id !== 'string' || typeof p.kind !== 'string' || !(KINDS as readonly string[]).includes(p.kind)) {
        errors.push(`parts[${i}] の id または kind が不正です`);
        return;
      }
      if (!isObj(p.pins)) {
        errors.push(`parts[${i}].pins がオブジェクトではありません`);
        return;
      }
      const pins: Record<string, string> = {};
      for (const [k, n] of Object.entries(p.pins)) {
        if (typeof n !== 'string') errors.push(`parts[${i}].pins.${k} が文字列ではありません`);
        else pins[k] = n;
      }
      if (p.value !== null && p.value !== undefined && typeof p.value !== 'number') errors.push(`parts[${i}].value が数値ではありません`);
      parts.push({
        id: p.id,
        kind: p.kind as Part['kind'],
        value: typeof p.value === 'number' ? p.value : null,
        valueRaw: typeof p.valueRaw === 'string' ? p.valueRaw : '',
        sourceMode: ['dc', 'ac_rms', 'ac_peak'].includes(p.sourceMode as string) ? (p.sourceMode as Part['sourceMode']) : undefined,
        pins,
        block: typeof p.block === 'string' ? p.block : '',
        uncertain: p.uncertain === true ? true : undefined,
        bbox: isBox(p.bbox) ? p.bbox : undefined,
      });
    });
  }
  const nodes: { id: string; label?: string }[] = [];
  if (!Array.isArray(v.nodes)) errors.push('nodes が配列ではありません');
  else
    v.nodes.forEach((n, i) => {
      if (!isObj(n) || typeof n.id !== 'string') errors.push(`nodes[${i}].id が不正です`);
      else nodes.push({ id: n.id, label: typeof n.label === 'string' ? n.label : undefined });
    });
  const annotations: Annotation[] = [];
  if (!Array.isArray(v.annotations)) errors.push('annotations が配列ではありません');
  else
    v.annotations.forEach((a, i) => {
      if (!isObj(a) || typeof a.id !== 'string' || typeof a.text !== 'string') {
        errors.push(`annotations[${i}] の id または text が不正です`);
        return;
      }
      annotations.push({
        id: a.id,
        text: a.text,
        target: isObj(a.target) && typeof a.target.id === 'string' && ['node', 'block', 'part'].includes(a.target.type as string)
          ? { type: a.target.type as 'node', id: a.target.id }
          : null,
        expect: isObj(a.expect) && typeof a.expect.value === 'number' && ['V_rms', 'V_dc', 'gain'].includes(a.expect.quantity as string)
          ? {
              quantity: a.expect.quantity as 'V_rms',
              value: a.expect.value as number,
              tolerance: typeof a.expect.tolerance === 'number' ? a.expect.tolerance : undefined,
              input: typeof a.expect.input === 'string' ? a.expect.input : undefined,
            }
          : undefined,
        uncertain: a.uncertain === true ? true : undefined,
        safety: a.safety === true ? true : undefined,
      });
    });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { parts, nodes, annotations } };
}

function isBox(v: unknown): v is { x: number; y: number; w: number; h: number } {
  return isObj(v) && ['x', 'y', 'w', 'h'].every((k) => typeof v[k] === 'number');
}
