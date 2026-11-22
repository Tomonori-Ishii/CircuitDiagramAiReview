// テスト用の既知の回路（正解が分かっているもの）。
import { type Annotation, GND, type Netlist, type Part, type Kind, type SourceMode } from '../core/netlist';

export function part(
  id: string,
  kind: Kind,
  pins: Record<string, string>,
  value: number | null = null,
  sourceMode?: SourceMode,
  extra: Partial<Part> = {},
): Part {
  return { id, kind, value, valueRaw: value === null ? '' : String(value), pins, block: '', sourceMode, ...extra };
}

export function net(parts: Part[], nodes: string[], annotations: Annotation[] = []): Netlist {
  const all = Array.from(new Set([GND, ...nodes]));
  return { parts, nodes: all.map((id) => ({ id })), annotations };
}

/** 10 V 直流、1k/1k の分圧器。N1 の期待値 5 V（直流）。 */
export function divider(expectedV = 5): Netlist {
  return net(
    [
      part('V1', 'V', { '+': 'N0', '-': GND }, 10, 'dc'),
      part('R1', 'R', { a: 'N0', b: 'N1' }, 1000),
      part('R2', 'R', { a: 'N1', b: GND }, 1000),
    ],
    ['N0', 'N1'],
    [{ id: 'A1', text: '出力 5 V', target: { type: 'node', id: 'N1' }, expect: { quantity: 'V_dc', value: expectedV } }],
  );
}

/** 反転増幅器（ゲイン −10、入力 1 Vrms）。出力 OUT。 */
export function invertingAmp(expectedGain = -10, extraAnn: Annotation[] = []): Netlist {
  return net(
    [
      part('V1', 'V', { '+': 'IN', '-': GND }, 1, 'ac_rms'),
      part('R1', 'R', { a: 'IN', b: 'N2' }, 1000),
      part('R2', 'R', { a: 'N2', b: 'OUT' }, 10000),
      part('U1', 'OPAMP', { '+': GND, '-': 'N2', out: 'OUT' }),
    ],
    ['IN', 'N2', 'OUT'],
    [
      { id: 'A1', text: 'ゲイン -10', target: { type: 'node', id: 'OUT' }, expect: { quantity: 'gain', value: expectedGain, input: 'IN' } },
      ...extraAnn,
    ],
  );
}

/** RC ローパス。R = 1 kΩ、C = 1 µF、fc ≈ 159.15 Hz。出力 OUT。 */
export function rcLowpass(): Netlist {
  return net(
    [
      part('V1', 'V', { '+': 'IN', '-': GND }, 1, 'ac_rms'),
      part('R1', 'R', { a: 'IN', b: 'OUT' }, 1000),
      part('C1', 'C', { a: 'OUT', b: GND }, 1e-6),
    ],
    ['IN', 'OUT'],
  );
}

/** 非反転増幅器（ゲイン 11）。 */
export function nonInvertingAmp(): Netlist {
  return net(
    [
      part('V1', 'V', { '+': 'IN', '-': GND }, 1, 'ac_rms'),
      part('U1', 'OPAMP', { '+': 'IN', '-': 'N2', out: 'OUT' }),
      part('R1', 'R', { a: 'N2', b: GND }, 1000),
      part('R2', 'R', { a: 'N2', b: 'OUT' }, 10000),
    ],
    ['IN', 'N2', 'OUT'],
  );
}

/** 正のフィードバックのないオペアンプ（帰還なし）。 */
export function noFeedback(): Netlist {
  return net(
    [
      part('V1', 'V', { '+': 'IN', '-': GND }, 1, 'ac_rms'),
      part('U1', 'OPAMP', { '+': 'IN', '-': 'N2', out: 'OUT' }),
      part('R1', 'R', { a: 'OUT', b: GND }, 1000),
    ],
    ['IN', 'N2', 'OUT'],
  );
}
