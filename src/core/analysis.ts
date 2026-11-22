// 解析の実行（前検査 → DC・AC の解析）。判定に必要な質問の材料も返す。
import { checkFeedback } from './feedback';
import { hasSource, isReactive, type SolveResult, solve, type Solution } from './mna';
import { type Netlist } from './netlist';

export interface AnalysisRun {
  /** 負帰還がないオペアンプ（解析せず質問する） */
  feedbackMissing: string[];
  /** 対象外の素子 */
  unsupported: string[];
  /** AC 解析に周波数（Q4）が必要だが未指定 */
  needsFrequency: boolean;
  /** 直流解析の結果（対象外・前提未達のときは未実行） */
  dc?: SolveResult;
  /** 交流解析の結果 */
  ac?: SolveResult;
  /** 直流・交流の解析に使った周波数 */
  frequency?: number;
  /** 出力を解析で使うオペアンプの有無（Q1 の対象） */
  opampUsed: boolean;
  blocked: boolean;
}

export interface AnalysisOptions {
  frequency?: number;
}

export function runAnalysis(netlist: Netlist, opts: AnalysisOptions = {}): AnalysisRun {
  const feedbackMissing = checkFeedback(netlist)
    .filter((f) => !f.hasFeedback)
    .map((f) => f.opampId);
  const unsupported = netlist.parts.filter((p) => ['D', 'Q', 'M'].includes(p.kind)).map((p) => p.id);
  const opampUsed = netlist.parts.some((p) => p.kind === 'OPAMP');
  const needsFrequency =
    hasSource(netlist, 'ac') && netlist.parts.some((p) => isReactive(p.kind)) && opts.frequency === undefined;

  const run: AnalysisRun = {
    feedbackMissing,
    unsupported,
    needsFrequency,
    opampUsed,
    blocked: feedbackMissing.length > 0 || unsupported.length > 0,
  };
  if (run.blocked) return run;

  const hasDc = hasSource(netlist, 'dc');
  const hasAc = hasSource(netlist, 'ac');
  const frequency = opts.frequency ?? 1000;
  run.frequency = frequency;
  if (hasDc) run.dc = solve(netlist, 'dc');
  if (hasAc && !needsFrequency) run.ac = solve(netlist, 'ac', frequency);
  return run;
}

export function okSolution(r: SolveResult | undefined): Solution | undefined {
  return r && r.ok ? r.solution : undefined;
}
