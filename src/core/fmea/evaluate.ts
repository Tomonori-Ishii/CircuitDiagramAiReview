// FMEA の評価（FR-FM-04、FR-FM-05、FR-FM-06）。
// S（重大度）と D（検出度）は解析結果から決め、O（発生度）は利用者が指定する。
import { type AnalysisRun, runAnalysis } from '../analysis';
import { abs } from '../complex';
import { GND, type Netlist, type Part } from '../netlist';
import { DEFAULT_REL_TOLERANCE, evaluateExpectations, type Finding, type ReviewSettings } from '../review';
import { type Solution } from '../mna';
import { type FailureMode } from './library';
import { inject } from './inject';

export interface FmeaSettings extends ReviewSettings {
  /** 部品ごとの発生度 O（1〜10）と根拠 */
  occurrence: Record<string, { value: number; basis: string }>;
  /** 部品ごとの値変化の割合（既定値の変更） */
  percent: Record<string, number>;
  /** 対策要否の閾値 */
  rpnThreshold: number;
  sThreshold: number;
  frequency?: number;
}

export interface FmeaRow {
  partId: string;
  kind: string;
  modeId: string;
  modeLabel: string;
  injection: string;
  S: number | null;
  O: number | null;
  D: number | null;
  RPN: number | null;
  action: 'required' | 'not_required' | 'undetermined';
  basis: string[];
}

interface Nominal {
  sol: { dc?: Solution; ac?: Solution };
  outputs: string[];
  values: Record<string, number>;
}

/** 通常時の解析結果と出力節点。 */
export function nominalOf(netlist: Netlist, run: AnalysisRun): Nominal {
  const sol = { dc: run.dc?.ok ? run.dc.solution : undefined, ac: run.ac?.ok ? run.ac.solution : undefined };
  const outputs = new Set<string>();
  for (const p of netlist.parts) if (p.kind === 'OPAMP' && p.pins.out) outputs.add(p.pins.out);
  for (const a of netlist.annotations) if (a.target?.type === 'node') outputs.add(a.target.id);
  const nodes = netlist.nodes.map((n) => n.id).filter((id) => id !== GND);
  const outList = outputs.size > 0 ? [...outputs] : nodes;
  const values: Record<string, number> = {};
  for (const n of nodes) values[n] = magnitude(sol, n);
  return { sol, outputs: outList, values };
}

function magnitude(sol: { dc?: Solution; ac?: Solution }, node: string): number {
  if (sol.ac) return abs(sol.ac.nodeVoltage[node] ?? { re: 0, im: 0 });
  if (sol.dc) return Math.abs((sol.dc.nodeVoltage[node] ?? { re: 0, im: 0 }).re);
  return 0;
}

export interface Effect {
  analysisOk: boolean;
  reason?: string;
  findings: Finding[];
  outputLost: boolean;
  outputChange: number;
  internalChange: number;
  safetyAffected: boolean;
}

/** 故障を注入した回路の影響を求める。 */
export function effectOf(
  netlist: Netlist,
  nominal: Nominal,
  partId: string,
  mode: FailureMode,
  settings: FmeaSettings,
): { effect: Effect; description: string } {
  const pct = settings.percent[partId];
  const inj = inject(netlist, partId, mode, pct);
  const run = runAnalysis(inj.netlist, { frequency: settings.frequency ?? 1000 });
  const solved = [run.dc, run.ac].filter((r) => r !== undefined);
  const analysisOk = !run.blocked && solved.length > 0 && solved.every((r) => r.ok);
  if (!analysisOk) {
    const reason = run.blocked
      ? '前提（負帰還・対象外素子）が満たされず解析できません'
      : run.dc && !run.dc.ok ? run.dc.message : run.ac && !run.ac.ok ? run.ac.message : '解析できません';
    return {
      description: inj.description,
      effect: { analysisOk: false, reason, findings: [], outputLost: false, outputChange: 0, internalChange: 0, safetyAffected: false },
    };
  }
  const sol = { dc: run.dc?.ok ? run.dc.solution : undefined, ac: run.ac?.ok ? run.ac.solution : undefined };
  const findings = evaluateExpectations(inj.netlist, sol, settings);

  let outputChange = 0;
  let maxRatio = Infinity;
  const outputSet = new Set(nominal.outputs);
  for (const o of nominal.outputs) {
    const nom = nominal.values[o] ?? 0;
    const now = magnitude(sol, o);
    if (nom > 1e-6) {
      maxRatio = Math.min(maxRatio, now / nom);
    }
    outputChange = Math.max(outputChange, Math.abs(now - nom) / Math.max(nom, 1e-3));
  }
  let internalChange = 0;
  for (const n of Object.keys(nominal.values)) {
    if (outputSet.has(n)) continue;
    const nom = nominal.values[n];
    const now = magnitude(sol, n);
    internalChange = Math.max(internalChange, Math.abs(now - nom) / Math.max(nom, 1e-3));
  }
  const outputLost = maxRatio !== Infinity && maxRatio < 0.01;
  const safetyAffected = netlist.annotations.some((a) => {
    if (!a.safety || !a.target) return false;
    const part = netlist.parts.find((p) => p.id === partId) as Part | undefined;
    const relevant = a.target.id === partId || (part !== undefined && a.target.id === part.block);
    return relevant && findings.some((f) => f.annotationId === a.id && f.status === 'mismatch');
  });
  return {
    description: inj.description,
    effect: { analysisOk: true, findings, outputLost, outputChange, internalChange, safetyAffected },
  };
}

/** S と D を決める（docs/requirements.md 5.6 の尺度）。 */
export function scoreSD(e: Effect): { S: number; D: number; basis: string[] } {
  const basis: string[] = [];
  if (!e.analysisOk) {
    basis.push(`解析できず（${e.reason ?? ''}）`);
    return { S: 7, D: 3, basis };
  }
  const expFindings = e.findings.filter((f) => f.status !== 'unmeasurable');
  const hasExp = expFindings.length > 0;
  const mismatch = expFindings.some((f) => f.status === 'mismatch');
  const maxDev = hasExp
    ? Math.max(...expFindings.map((f) => (f.relErr ?? Math.abs((f.actual ?? 0) - f.expected) / 1e-3)))
    : e.outputChange;
  const beyond = hasExp ? mismatch : e.outputChange > DEFAULT_REL_TOLERANCE;

  let S: number;
  if (!beyond) {
    S = 1;
    basis.push('許容誤差以内');
  } else if (e.outputLost) {
    S = 7;
    basis.push('出力が得られない（ほぼ 0）');
  } else if (e.safetyAffected) {
    S = 9;
    basis.push('安全関連の機能に影響');
  } else {
    S = maxDev <= 0.2 ? 4 : maxDev <= 0.5 ? 5 : 6;
    basis.push(`機能は保たれるが逸脱（最大 ${(maxDev * 100).toFixed(1)}%）`);
  }

  let D: number;
  if (beyond) {
    D = 3;
    basis.push('期待値のある出力で逸脱（検出可能）');
  } else if (e.internalChange > 0.01) {
    D = 7;
    basis.push('許容誤差以内で内部ノードのみ変化');
  } else {
    D = 10;
    basis.push('変化なし（潜在故障）');
  }
  return { S, D, basis };
}

export function rowsFor(netlist: Netlist, run: AnalysisRun, settings: FmeaSettings, partIds: string[], modesOf: (kind: string) => FailureMode[] | null): FmeaRow[] {
  const nominal = nominalOf(netlist, run);
  const rows: FmeaRow[] = [];
  for (const pid of partIds) {
    const part = netlist.parts.find((p) => p.id === pid);
    if (!part) continue;
    const modes = modesOf(part.kind);
    if (!modes) continue;
    const o = settings.occurrence[pid];
    for (const mode of modes) {
      const { effect, description } = effectOf(netlist, nominal, pid, mode, settings);
      const { S, D, basis } = scoreSD(effect);
      const O = o?.value ?? null;
      const RPN = O !== null ? S * O * D : null;
      const action: FmeaRow['action'] =
        S >= settings.sThreshold || (RPN !== null && RPN >= settings.rpnThreshold)
          ? 'required'
          : RPN === null
            ? 'undetermined'
            : 'not_required';
      rows.push({
        partId: pid,
        kind: part.kind,
        modeId: mode.id,
        modeLabel: mode.label,
        injection: description,
        S,
        O,
        D,
        RPN,
        action,
        basis: [...basis, o ? `O の根拠: ${o.basis}` : 'O 未指定'],
      });
    }
  }
  return rows;
}

export const ACTION_LABEL: Record<FmeaRow['action'], string> = {
  required: '対策要',
  not_required: '対策不要',
  undetermined: '未算出（O 未指定）',
};
