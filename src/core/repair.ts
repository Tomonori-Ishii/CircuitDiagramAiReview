// 修正案の提示（FR-DR-03）。抵抗値を変える案を求め、修正後に再解析して許容誤差内かを確かめる。
import { type Finding, type ReviewSettings, withinTolerance } from './review';
import { type AnalysisMode, solve } from './mna';
import { type Netlist, type Part } from './netlist';

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

/** 値を E24 系列の最も近い値に丸める（対数距離）。 */
export function roundE24(value: number): number {
  if (!(value > 0)) return value;
  const d = Math.floor(Math.log10(value));
  const cands: number[] = [];
  for (let k = d - 1; k <= d + 1; k++) for (const e of E24) cands.push(e * 10 ** k);
  return cands.reduce((a, b) => (Math.abs(Math.log(a / value)) <= Math.abs(Math.log(b / value)) ? a : b));
}

export interface RepairProposal {
  partId: string;
  from: number;
  to: number;
  /** 修正後の再解析で測った値 */
  actualAfter: number;
  relErrAfter: number | null;
  annotationId: string;
  description: string;
}

/** 不一致の期待値 1 件に対する修正案（抵抗値の変更）を最大 maxCount 件返す。 */
export function proposeRepairs(
  netlist: Netlist,
  finding: Finding,
  settings: ReviewSettings,
  maxCount = 3,
): RepairProposal[] {
  if (finding.status !== 'mismatch' || finding.actual === null) return [];
  const annotation = netlist.annotations.find((a) => a.id === finding.annotationId);
  if (!annotation?.expect) return [];
  const expect = annotation.expect;
  const target = finding.target;
  const expected = expect.value;
  const tol = finding.tolerance;
  const proposals: RepairProposal[] = [];

  const measureWith = (variant: Netlist) =>
    analyzeOne(variant, expect.quantity, target, expect.input, settings.frequency);

  for (const part of netlist.parts) {
    if (part.kind !== 'R' || part.value === null) continue;
    const r0 = part.value;
    const signedDiff = (r: number): number | null => {
      const v = measureWith(withValue(netlist, part, r));
      return v === null ? null : v - expected;
    };
    const roots = findRoots(signedDiff, r0 / 100, r0 * 100);
    for (const root of roots) {
      const rounded = roundE24(root);
      const after = measureWith(withValue(netlist, part, rounded));
      if (after === null) continue;
      const check = withinTolerance(after, expected, tol);
      if (!check.ok) continue;
      proposals.push({
        partId: part.id,
        from: r0,
        to: rounded,
        actualAfter: after,
        relErrAfter: check.relErr,
        annotationId: finding.annotationId,
        description: `${part.id} を ${fmtOhm(r0)} から ${fmtOhm(rounded)} に変更（修正後の実測 ${after.toPrecision(4)}、期待 ${expected}）`,
      });
    }
  }
  proposals.sort((a, b) => Math.abs(Math.log(a.to / a.from)) - Math.abs(Math.log(b.to / b.from)));
  return proposals.slice(0, maxCount);
}

function analyze(n: Netlist, mode: AnalysisMode, f: number) {
  const r = solve(n, mode, f);
  return r.ok ? r.solution : undefined;
}

function analyzeOne(n: Netlist, quantity: 'V_rms' | 'V_dc' | 'gain', target: string, input: string | undefined, frequency?: number): number | null {
  const f = frequency ?? 1000;
  if (quantity === 'V_dc') {
    const s = analyze(n, 'dc', 0);
    return s ? (s.nodeVoltage[target]?.re ?? 0) : null;
  }
  const s = analyze(n, 'ac', f);
  if (!s) return null;
  const v = s.nodeVoltage[target];
  if (!v) return null;
  if (quantity === 'V_rms') return Math.hypot(v.re, v.im);
  const inp = s.nodeVoltage[input ?? 'GND'];
  if (!inp) return null;
  const d = inp.re * inp.re + inp.im * inp.im;
  return (v.re * inp.re + v.im * inp.im) / d;
}

function withValue(netlist: Netlist, part: Part, value: number): Netlist {
  return {
    ...netlist,
    parts: netlist.parts.map((p) => (p.id === part.id ? { ...p, value } : p)),
  };
}

/** 対数グリッドで符号変化を探し、二分法で根を求める。 */
export function findRoots(f: (x: number) => number | null, lo: number, hi: number, steps = 80): number[] {
  const roots: number[] = [];
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  let prevX = lo;
  let prevY = f(lo);
  for (let i = 1; i <= steps; i++) {
    const x = Math.exp(logLo + ((logHi - logLo) * i) / steps);
    const y = f(x);
    if (prevY !== null && y !== null && Math.sign(prevY) !== Math.sign(y) && prevY !== 0) {
      let a = prevX;
      let b = x;
      let fa = prevY;
      for (let k = 0; k < 60; k++) {
        const m = Math.sqrt(a * b);
        const fm = f(m);
        if (fm === null) break;
        if (Math.sign(fm) === Math.sign(fa)) {
          a = m;
          fa = fm;
        } else {
          b = m;
        }
      }
      roots.push(Math.sqrt(a * b));
    }
    prevX = x;
    prevY = y;
  }
  return roots;
}

function fmtOhm(r: number): string {
  if (r >= 1e6) return `${+(r / 1e6).toPrecision(3)} MΩ`;
  if (r >= 1e3) return `${+(r / 1e3).toPrecision(3)} kΩ`;
  return `${+r.toPrecision(3)} Ω`;
}
