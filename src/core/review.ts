// 設計レビュー（FR-DR）: 期待値との比較、許容誤差、飽和判定。
import { type AnalysisRun, okSolution } from './analysis';
import { type Cx, abs } from './complex';
import { type Solution } from './mna';
import { type Expectation, GND, type Netlist } from './netlist';

export const DEFAULT_REL_TOLERANCE = 0.05;
/** 期待値が 0 のときの絶対許容差（実効値）。 */
export const ABS_TOLERANCE_AT_ZERO = 1e-3;

export type ToleranceSource = 'annotation' | 'user' | 'default';

export interface Tolerance {
  rel: number;
  source: ToleranceSource;
}

export interface Finding {
  annotationId: string;
  target: string;
  quantity: Expectation['quantity'];
  expected: number;
  actual: number | null;
  /** 相対誤差（期待値 0 のときは null） */
  relErr: number | null;
  tolerance: Tolerance;
  /** ok: 一致、mismatch: 不一致、sign: 符号だけ異なる（Q2）、unmeasurable: 測れない */
  status: 'ok' | 'mismatch' | 'sign' | 'unmeasurable';
  reason: string;
}

export interface ReviewSettings {
  /** 利用者が指定した既定の許容差（相対）。未指定は 5%。 */
  userTolerance?: number;
  /** Q2 で符号反転を認めた注釈 ID */
  signFlips?: Set<string>;
  frequency?: number;
}

export function resolveTolerance(expect: Expectation, settings: ReviewSettings): Tolerance {
  if (expect.tolerance !== undefined) return { rel: expect.tolerance, source: 'annotation' };
  if (settings.userTolerance !== undefined) return { rel: settings.userTolerance, source: 'user' };
  return { rel: DEFAULT_REL_TOLERANCE, source: 'default' };
}

/** 期待値と実測の比較。期待値 0 は絶対値（1 mV）で判定する。 */
export function withinTolerance(actual: number, expected: number, tol: Tolerance): { ok: boolean; relErr: number | null } {
  if (expected === 0) return { ok: Math.abs(actual) <= ABS_TOLERANCE_AT_ZERO, relErr: null };
  const relErr = Math.abs(actual - expected) / Math.abs(expected);
  return { ok: relErr <= tol.rel, relErr };
}

/** 期待値に対応する実測値（V_dc は直流、V_rms と gain は交流）。 */
export function measure(
  sol: { dc?: Solution; ac?: Solution },
  expect: Expectation,
  target: string,
): number | null {
  if (expect.quantity === 'V_dc') {
    if (!sol.dc) return null;
    return (sol.dc.nodeVoltage[target] ?? { re: 0, im: 0 }).re;
  }
  if (!sol.ac) return null;
  const v = sol.ac.nodeVoltage[target];
  if (!v) return null;
  if (expect.quantity === 'V_rms') return abs(v);
  // gain: 入力に対する比の実部（符号付き）
  const input = sol.ac.nodeVoltage[expect.input ?? GND];
  if (!input || abs(input) === 0) return null;
  const ratio = divCx(v, input);
  return ratio.re;
}

function divCx(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

/** 注釈の期待値を評価する。対象節点がない注釈は対象外。 */
export function evaluateExpectations(
  netlist: Netlist,
  sol: { dc?: Solution; ac?: Solution },
  settings: ReviewSettings = {},
): Finding[] {
  const out: Finding[] = [];
  for (const a of netlist.annotations) {
    if (!a.expect || !a.target) continue;
    const e = a.expect;
    const target = a.target.type === 'node' ? a.target.id : undefined;
    const tol = resolveTolerance(e, settings);
    const base = { annotationId: a.id, target: a.target.id, quantity: e.quantity, expected: e.value, tolerance: tol };
    if (!target) {
      out.push({ ...base, actual: null, relErr: null, status: 'unmeasurable', reason: '期待値の対象が節点ではないため測れません' });
      continue;
    }
    const actual = measure(sol, e, target);
    if (actual === null) {
      out.push({ ...base, actual: null, relErr: null, status: 'unmeasurable', reason: '解析結果がないため測れません（交流源・周波数・直流源を確認）' });
      continue;
    }
    const flipped = settings.signFlips?.has(a.id) ?? false;
    const expected = flipped ? -e.value : e.value;
    const r = withinTolerance(actual, expected, tol);
    if (r.ok) {
      out.push({ ...base, actual, relErr: r.relErr, status: 'ok', reason: reasonOk(actual, expected) });
      continue;
    }
    // 符号だけが異なる場合（gain のみ）は Q2 で扱う
    const signOnly =
      e.quantity === 'gain' && !flipped && Math.sign(actual) !== Math.sign(e.value) && withinTolerance(actual, -e.value, tol).ok;
    out.push({
      ...base,
      actual,
      relErr: r.relErr,
      status: signOnly ? 'sign' : 'mismatch',
      reason: signOnly
        ? `符号だけが異なります（期待 ${fmt(e.value)}、実測 ${fmt(actual)}）。符号の扱いを質問します（Q2）`
        : `期待 ${fmt(expected)} に対し実測 ${fmt(actual)}（相対誤差 ${pct(r.relErr)}、許容 ±${pct(tol.rel)}）`,
    });
  }
  return out;
}

function reasonOk(actual: number, expected: number): string {
  return `期待 ${fmt(expected)} に対し実測 ${fmt(actual)}（許容内）`;
}

export const fmt = (x: number): string => (Math.abs(x) >= 1000 || (Math.abs(x) < 0.01 && x !== 0) ? x.toExponential(3) : x.toPrecision(4));
export const pct = (x: number | null): string => (x === null ? '—' : `${(x * 100).toFixed(2)}%`);

export interface SaturationResult {
  opampId: string;
  outputNode: string;
  peak: number | null;
  status: 'saturated' | 'not_saturated' | 'unknown';
  message: string;
}

/** オペアンプ出力の飽和（FR-DR-07）。電源電圧 supplyV が未回答なら「未確定」。 */
export function checkSaturation(netlist: Netlist, run: AnalysisRun, supplyV: number | undefined): SaturationResult[] {
  const sol = { dc: okSolution(run.dc), ac: okSolution(run.ac) };
  return netlist.parts
    .filter((p) => p.kind === 'OPAMP')
    .map((op) => {
      const node = op.pins.out;
      let peak: number | null = null;
      if (sol.ac) peak = abs(sol.ac.nodeVoltage[node] ?? { re: 0, im: 0 }) * Math.SQRT2;
      else if (sol.dc) peak = Math.abs((sol.dc.nodeVoltage[node] ?? { re: 0, im: 0 }).re);
      if (supplyV === undefined || peak === null) {
        return { opampId: op.id, outputNode: node, peak, status: 'unknown' as const, message: '飽和: 未確定（電源電圧（Q1）が未回答、または解析結果がありません）' };
      }
      const saturated = peak >= supplyV * 0.999;
      return {
        opampId: op.id,
        outputNode: node,
        peak,
        status: saturated ? ('saturated' as const) : ('not_saturated' as const),
        message: saturated
          ? `飽和: あり（出力ピーク ${fmt(peak)} V ≥ 電源 ${fmt(supplyV)} V）`
          : `飽和: なし（出力ピーク ${fmt(peak)} V < 電源 ${fmt(supplyV)} V）`,
      };
    });
}
