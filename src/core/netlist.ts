// ネットリストのデータモデル（FR-CK、docs/requirements.md 5.2）。React に依存しない。

export type Kind = 'R' | 'C' | 'L' | 'V' | 'I' | 'OPAMP' | 'D' | 'Q' | 'M';

/** 種別ごとの端子名。D・Q・M は対象外素子（解析では報告のみ）。 */
export const TERMINALS: Record<Kind, readonly string[]> = {
  R: ['a', 'b'],
  C: ['a', 'b'],
  L: ['a', 'b'],
  V: ['+', '-'],
  I: ['+', '-'],
  OPAMP: ['+', '-', 'out'],
  D: ['a', 'k'],
  Q: ['c', 'b', 'e'],
  M: ['d', 'g', 's'],
};

export const KINDS: readonly Kind[] = ['R', 'C', 'L', 'V', 'I', 'OPAMP', 'D', 'Q', 'M'];

/** 値を持つ種別（未読取の検査の対象）。 */
export const VALUED_KINDS: readonly Kind[] = ['R', 'C', 'L', 'V', 'I'];

/** 信号源の種類（FR-CK-04）。 */
export type SourceMode = 'dc' | 'ac_rms' | 'ac_peak';

export interface Part {
  id: string;
  kind: Kind;
  /** SI 単位の数値（Ω・F・H・V・A）。未読取は null。 */
  value: number | null;
  /** 入力された元の表記（FR-CK-04 の元の表記の保持）。 */
  valueRaw: string;
  sourceMode?: SourceMode;
  /** 端子名 → ノード ID */
  pins: Record<string, string>;
  /** 所属ブロック名（空文字は未所属） */
  block: string;
  /** 不確かとして示された項目（FR-CK-05 の警告） */
  uncertain?: boolean;
  /** 画像上の枠。正規化座標（0〜1）。 */
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface NetNode {
  id: string;
  label?: string;
}

export type TargetType = 'node' | 'block' | 'part';

export type ExpectQuantity = 'V_rms' | 'V_dc' | 'gain';

export interface Expectation {
  quantity: ExpectQuantity;
  /** 期待値（gain は符号付き。V は実効値または直流値） */
  value: number;
  /** 注釈で指定された許容差（相対、例 0.1 = 10%） */
  tolerance?: number;
  /** gain の入力節点 */
  input?: string;
}

export interface Annotation {
  id: string;
  text: string;
  target: { type: TargetType; id: string } | null;
  expect?: Expectation;
  uncertain?: boolean;
  /** 安全関連として指定された機能（FMEA の S 判定で 9 以上に使う） */
  safety?: boolean;
}

export interface Netlist {
  parts: Part[];
  nodes: NetNode[];
  annotations: Annotation[];
}

/** 接地ノードの ID。 */
export const GND = 'GND';

export function emptyNetlist(): Netlist {
  return { parts: [], nodes: [{ id: GND, label: 'GND' }], annotations: [] };
}

export function terminalsOf(kind: Kind): readonly string[] {
  return TERMINALS[kind];
}

/** ノードに接続している端子の数（ID 重複を除かず、部品の端子を数える）。 */
export function terminalCount(netlist: Netlist, nodeId: string): number {
  let count = 0;
  for (const p of netlist.parts) {
    for (const n of Object.values(p.pins)) if (n === nodeId) count++;
  }
  return count;
}

export function partById(netlist: Netlist, id: string): Part | undefined {
  return netlist.parts.find((p) => p.id === id);
}

export function clone(netlist: Netlist): Netlist {
  return structuredClone(netlist);
}
