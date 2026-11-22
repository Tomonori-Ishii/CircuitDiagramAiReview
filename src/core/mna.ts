// 修正節点解析（MNA）。直流（DC）と単一周波数の正弦波定常（AC、相量・実効値）を解く。
// 規約:
//  - 電圧源の枝電流は '+' 端子から源を通って '-' 端子へ流れる向き。
//  - 電流源は '-' 端子から源を通って '+' 端子へ電流を送り込む。
//  - 理想オペアンプは V+ − V− = 0 の制約と、出力端子の電流を未知数とする。
import { C0, type Cx, abs, add, cx, div, mul, neg, sub } from './complex';
import { GND, type Netlist, type Part } from './netlist';
import { toRms } from './units';

export const MAX_NODES = 50;

export type AnalysisMode = 'dc' | 'ac';

export interface Solution {
  mode: AnalysisMode;
  frequency: number;
  /** 節点電圧（GND は 0）。実効値（AC）または直流値。 */
  nodeVoltage: Record<string, Cx>;
  /** 部品ごとの枝電流（R・C・L は a→b、電圧源・電流源・オペアンプは規約どおり） */
  current: Record<string, Cx>;
  /** 部品ごとの消費電力（受動素子は吸収、電源は供給。単位 W、実効値ベース） */
  power: Record<string, number>;
}

export type SolveResult =
  | { ok: true; solution: Solution }
  | { ok: false; reason: 'unsupported' | 'too_many_nodes' | 'singular' | 'missing_value' | 'no_source'; message: string; details: string[] };

export function isReactive(kind: string): boolean {
  return kind === 'C' || kind === 'L';
}

/** 解析に使う信号源の有無。 */
export function hasSource(netlist: Netlist, mode: AnalysisMode): boolean {
  return netlist.parts.some(
    (p) => (p.kind === 'V' || p.kind === 'I') && (mode === 'dc' ? p.sourceMode === 'dc' : p.sourceMode !== 'dc'),
  );
}

/** 源の値（相量・直流値）。DC では交流源を 0、AC では直流源を 0 とする（重ね合わせの小信号扱い）。 */
function sourceValue(p: Part, mode: AnalysisMode): number {
  const v = p.value ?? 0;
  if (mode === 'dc') return p.sourceMode === 'dc' ? v : 0;
  if (p.sourceMode === 'dc') return 0;
  return toRms(v, p.sourceMode ?? 'ac_rms');
}

export function solve(netlist: Netlist, mode: AnalysisMode, frequency = 0): SolveResult {
  // 対象外の素子
  const unsupported = netlist.parts.filter((p) => ['D', 'Q', 'M'].includes(p.kind));
  if (unsupported.length > 0) {
    return {
      ok: false,
      reason: 'unsupported',
      message: '対象外の素子が含まれています（初版は線形素子と理想オペアンプのみ）',
      details: unsupported.map((p) => p.id),
    };
  }
  for (const p of netlist.parts) {
    if (p.kind === 'R' || p.kind === 'C' || p.kind === 'L') {
      if (p.value === null || !(p.value > 0)) {
        return { ok: false, reason: 'missing_value', message: `値が未設定です: ${p.id}`, details: [p.id] };
      }
    }
  }

  const nodes = netlist.nodes.map((n) => n.id).filter((id) => id !== GND);
  if (nodes.length > MAX_NODES) {
    return {
      ok: false,
      reason: 'too_many_nodes',
      message: `節点数 ${nodes.length} は上限 ${MAX_NODES} を超えています`,
      details: [],
    };
  }
  const nodeIndex = new Map<string, number>();
  nodes.forEach((id, i) => nodeIndex.set(id, i));

  // 未知数の割当: 節点電圧 + 枝電流（電圧源、オペアンプ、インダクタ）
  const branchParts = netlist.parts.filter((p) => p.kind === 'V' || p.kind === 'OPAMP' || p.kind === 'L');
  const n = nodes.length;
  const m = n + branchParts.length;
  const branchIndex = new Map<string, number>();
  branchParts.forEach((p, i) => branchIndex.set(p.id, n + i));

  const A: Cx[][] = Array.from({ length: m }, () => Array.from({ length: m }, () => ({ ...C0 })));
  const b: Cx[] = Array.from({ length: m }, () => ({ ...C0 }));
  const omega = 2 * Math.PI * frequency;

  const nodeRow = (id: string): number | undefined => (id === GND ? undefined : nodeIndex.get(id));
  const addA = (r: number | undefined, c: number | undefined, v: Cx) => {
    if (r === undefined || c === undefined) return;
    A[r][c] = add(A[r][c], v);
  };
  const addB = (r: number | undefined, v: Cx) => {
    if (r === undefined) return;
    b[r] = add(b[r], v);
  };
  /** 2 端子アドミタンス y（a→b） */
  const stampY = (a: string, bn: string, y: Cx) => {
    const ra = nodeRow(a);
    const rb = nodeRow(bn);
    addA(ra, ra, y);
    addA(rb, rb, y);
    addA(ra, rb, neg(y));
    addA(rb, ra, neg(y));
  };

  for (const p of netlist.parts) {
    switch (p.kind) {
      case 'R':
        stampY(p.pins.a, p.pins.b, cx(1 / (p.value as number)));
        break;
      case 'C':
        // DC では開放（Y = 0）、AC では jωC
        if (mode === 'ac') stampY(p.pins.a, p.pins.b, cx(0, omega * (p.value as number)));
        break;
      case 'L': {
        // 枝電流を未知数とする: Va − Vb − Z·I = 0、DC では Z = 0（短絡）
        const k = branchIndex.get(p.id) as number;
        const z = mode === 'ac' ? cx(0, omega * (p.value as number)) : C0;
        const ra = nodeRow(p.pins.a);
        const rb = nodeRow(p.pins.b);
        addA(ra, k, cx(1));
        addA(rb, k, cx(-1));
        addA(k, ra, cx(1));
        addA(k, rb, cx(-1));
        addA(k, k, neg(z));
        break;
      }
      case 'V': {
        const k = branchIndex.get(p.id) as number;
        const rp = nodeRow(p.pins['+']);
        const rn = nodeRow(p.pins['-']);
        addA(rp, k, cx(1));
        addA(rn, k, cx(-1));
        addA(k, rp, cx(1));
        addA(k, rn, cx(-1));
        b[k] = cx(sourceValue(p, mode));
        break;
      }
      case 'I': {
        // '-' から源を通って '+' へ送り込む
        const I = sourceValue(p, mode);
        addB(nodeRow(p.pins['+']), cx(I));
        addB(nodeRow(p.pins['-']), cx(-I));
        break;
      }
      case 'OPAMP': {
        // 出力端子の電流 I（オペアンプから回路へ流れ出す向き）と、仮想短絡 V+ − V− = 0
        const k = branchIndex.get(p.id) as number;
        const ro = nodeRow(p.pins.out);
        const rp = nodeRow(p.pins['+']);
        const rm = nodeRow(p.pins['-']);
        addA(ro, k, cx(1));
        addA(k, rp, cx(1));
        addA(k, rm, cx(-1));
        break;
      }
      default:
        break;
    }
  }

  const x = solveComplex(A, b);
  if (!x.ok) {
    const cause = describeUnknown(x.pivot, nodes, branchParts);
    return {
      ok: false,
      reason: 'singular',
      message: `解析できません（行列が特異）。原因の候補: ${cause}`,
      details: [cause],
    };
  }

  const nodeVoltage: Record<string, Cx> = { [GND]: { ...C0 } };
  nodes.forEach((id, i) => (nodeVoltage[id] = x.value[i]));
  const V = (id: string): Cx => nodeVoltage[id] ?? C0;

  const current: Record<string, Cx> = {};
  const power: Record<string, number> = {};
  for (const p of netlist.parts) {
    const vab = sub(V(p.pins.a ?? p.pins['+'] ?? p.pins.out ?? GND), V(p.pins.b ?? p.pins['-'] ?? GND));
    switch (p.kind) {
      case 'R': {
        const i = div(vab, cx(p.value as number));
        current[p.id] = i;
        power[p.id] = vab.re * i.re + vab.im * i.im;
        break;
      }
      case 'C': {
        const i = mode === 'ac' ? mul(cx(0, omega * (p.value as number)), vab) : { ...C0 };
        current[p.id] = i;
        power[p.id] = vab.re * i.re + vab.im * i.im;
        break;
      }
      case 'L': {
        const k = branchIndex.get(p.id) as number;
        const i = x.value[k];
        current[p.id] = i;
        power[p.id] = vab.re * i.re + vab.im * i.im;
        break;
      }
      case 'V': {
        const k = branchIndex.get(p.id) as number;
        const i = x.value[k];
        current[p.id] = i;
        // 源が供給する電力（規約では源の吸収は V·I、供給は −V·I）
        power[p.id] = -(vab.re * i.re + vab.im * i.im);
        break;
      }
      case 'I': {
        const i = cx(sourceValue(p, mode));
        current[p.id] = i;
        power[p.id] = -(vab.re * i.re + vab.im * i.im);
        break;
      }
      case 'OPAMP': {
        const k = branchIndex.get(p.id) as number;
        current[p.id] = x.value[k];
        power[p.id] = 0;
        break;
      }
      default:
        break;
    }
  }

  return {
    ok: true,
    solution: { mode, frequency: mode === 'ac' ? frequency : 0, nodeVoltage, current, power },
  };
}

function describeUnknown(
  index: number,
  nodes: string[],
  branches: Part[],
): string {
  if (index < nodes.length) return `節点 ${nodes[index]} が決まりません（浮遊、または直流経路がない可能性）`;
  const p = branches[index - nodes.length];
  return p ? `${p.id}（ループの電圧源や制約が矛盾している可能性）` : '不明';
}

type SolveOut = { ok: true; value: Cx[] } | { ok: false; pivot: number };

/** 部分ピボット付きガウス消去（複素数）。 */
function solveComplex(A0: Cx[][], b0: Cx[]): SolveOut {
  const m = b0.length;
  const A = A0.map((row) => row.map((v) => ({ ...v })));
  const b = b0.map((v) => ({ ...v }));
  let scale = 0;
  for (const row of A) for (const v of row) scale = Math.max(scale, abs(v));
  const eps = Math.max(scale, 1) * 1e-12;

  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (abs(A[r][col]) > abs(A[piv][col])) piv = r;
    if (abs(A[piv][col]) < eps) return { ok: false, pivot: col };
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < m; r++) {
      const f = div(A[r][col], A[col][col]);
      if (abs(f) === 0) continue;
      for (let c = col; c < m; c++) A[r][c] = sub(A[r][c], mul(f, A[col][c]));
      b[r] = sub(b[r], mul(f, b[col]));
    }
  }
  const x: Cx[] = new Array(m);
  for (let r = m - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < m; c++) s = sub(s, mul(A[r][c], x[c]));
    x[r] = div(s, A[r][r]);
  }
  return { ok: true, value: x };
}

/** 実数値（DC）または |相量|（AC）を返す。 */
export function magnitudeOrReal(c: Cx, mode: AnalysisMode): number {
  return mode === 'dc' ? c.re : abs(c);
}
