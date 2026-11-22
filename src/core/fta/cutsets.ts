// 最小カットセット（FR-FT-02、FR-FT-03）。基本事象は故障モード。同一部品の同時故障は扱わない。
import { type FailureMode } from '../fmea/library';
import { inject } from '../fmea/inject';
import { runAnalysis } from '../analysis';
import { evaluateExpectations, type ReviewSettings } from '../review';
import { type Netlist } from '../netlist';
import { type Solution } from '../mna';

export const DEFAULT_ORDER = 2;
export const MAX_ORDER = 3;
export const COMBINATION_WARNING = 500;

export interface BasicEvent {
  id: string;
  partId: string;
  mode: FailureMode;
  label: string;
}

export interface CutSet {
  events: BasicEvent[];
  /** トップ事象を起こすときの逸脱量（相対誤差） */
  deviation: number | null;
  basis: string;
}

export interface CutSetResult {
  cutSets: CutSet[];
  combinationCount: number;
  warning?: string;
}

export interface CutSetOptions extends ReviewSettings {
  order: number;
  /** トップ事象の注釈 ID */
  topAnnotationId: string;
  frequency?: number;
  percent?: Record<string, number>;
}

/** 基本事象を作る（部品ごとの故障モード）。 */
export function basicEventsOf(partIds: { id: string; modes: FailureMode[] }[]): BasicEvent[] {
  return partIds.flatMap((p) => p.modes.map((m) => ({ id: `${p.id}:${m.id}`, partId: p.id, mode: m, label: `${p.id} の${m.label}` })));
}

/** 組合せの個数（同一部品を含まないもの）。 */
export function countCombinations(events: BasicEvent[], order: number): number {
  let total = 0;
  for (let k = 1; k <= order; k++) total += combosOf(events, k).length;
  return total;
}

function combosOf(events: BasicEvent[], k: number): BasicEvent[][] {
  const out: BasicEvent[][] = [];
  const rec = (start: number, cur: BasicEvent[]) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < events.length; i++) {
      if (cur.some((e) => e.partId === events[i].partId)) continue;
      cur.push(events[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

/** トップ事象が起きるかを、注入した回路の解析で判定する。解析できない場合は起きたとみなす。 */
function occurs(netlist: Netlist, events: BasicEvent[], opts: CutSetOptions): { occurs: boolean; deviation: number | null; basis: string } {
  let nl = netlist;
  for (const e of events) nl = inject(nl, e.partId, e.mode, opts.percent?.[e.partId]).netlist;
  const run = runAnalysis(nl, { frequency: opts.frequency ?? 1000 });
  if (run.blocked) return { occurs: true, deviation: null, basis: '前提が満たされず解析できない（出力が得られないとみなす）' };
  const solved = [run.dc, run.ac].filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (solved.length === 0 || !solved.every((r) => r.ok)) {
    return { occurs: true, deviation: null, basis: '解析できない（出力が得られないとみなす）' };
  }
  const sol: { dc?: Solution; ac?: Solution } = {
    dc: run.dc?.ok ? run.dc.solution : undefined,
    ac: run.ac?.ok ? run.ac.solution : undefined,
  };
  const f = evaluateExpectations(nl, sol, opts).find((x) => x.annotationId === opts.topAnnotationId);
  if (!f) return { occurs: false, deviation: null, basis: 'トップ事象の期待値を測れない' };
  if (f.status === 'unmeasurable') return { occurs: true, deviation: null, basis: f.reason };
  const dev = f.relErr ?? Math.abs((f.actual ?? 0) - f.expected);
  return {
    occurs: f.status === 'mismatch',
    deviation: dev,
    basis: `期待 ${f.expected} に対し実測 ${f.actual?.toPrecision(4)}（逸脱 ${(dev * 100).toFixed(1)}%）`,
  };
}

/** 次数 1〜order の最小カットセットを求める。 */
export function minimalCutSets(netlist: Netlist, events: BasicEvent[], opts: CutSetOptions): CutSetResult {
  const order = Math.min(Math.max(1, opts.order), MAX_ORDER);
  const combinationCount = countCombinations(events, order);
  const warning =
    combinationCount > COMBINATION_WARNING
      ? `組合せ数 ${combinationCount} は ${COMBINATION_WARNING} を超えています。計算に時間がかかる場合があります`
      : undefined;
  const cutSets: CutSet[] = [];
  for (let k = 1; k <= order; k++) {
    for (const combo of combosOf(events, k)) {
      const ids = combo.map((e) => e.id).sort();
      // 既出のカットセットを含むものは最小ではない
      if (cutSets.some((c) => c.events.every((e) => ids.includes(e.id)))) continue;
      const r = occurs(netlist, combo, opts);
      if (r.occurs) cutSets.push({ events: combo, deviation: r.deviation, basis: r.basis });
    }
  }
  return { cutSets, combinationCount, warning };
}
