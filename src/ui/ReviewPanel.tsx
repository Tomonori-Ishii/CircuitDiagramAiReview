import { useMemo, useState } from 'react';
import { type AnalysisRun, okSolution } from '../core/analysis';
import { type Netlist } from '../core/netlist';
import { proposeRepairs, type RepairProposal } from '../core/repair';
import { checkSaturation, evaluateExpectations, type Finding, type ReviewSettings, pct } from '../core/review';
import { setValue } from '../core/editing';
import { Disclaimer } from './Disclaimer';

interface Props {
  netlist: Netlist;
  version: number;
  run: AnalysisRun;
  settings: ReviewSettings;
  supplyV: number | undefined;
  assumptions: { question: string; answer: string }[];
  onApply: (next: Netlist) => void;
}

export function ReviewPanel({ netlist, version, run, settings, supplyV, assumptions, onApply }: Props) {
  const findings: Finding[] = useMemo(
    () => (run.blocked ? [] : evaluateExpectations(netlist, { dc: okSolution(run.dc), ac: okSolution(run.ac) }, settings)),
    [netlist, run, settings],
  );
  const [proposals, setProposals] = useState<{ finding: string; list: RepairProposal[] } | null>(null);
  const sat = run.blocked ? [] : checkSaturation(netlist, run, supplyV);

  if (run.blocked) {
    return (
      <div>
        <p className="warn">前提が満たされず解析していません。質問の回答または回路の修正が必要です。</p>
        {run.unsupported.length > 0 && <p>対象外の素子: {run.unsupported.join(', ')}</p>}
        {run.feedbackMissing.length > 0 && <p>負帰還の経路がないオペアンプ: {run.feedbackMissing.join(', ')}</p>}
        <Disclaimer />
      </div>
    );
  }

  return (
    <div>
      <h3>設計レビュー（版 {version}）</h3>
      {findings.length === 0 && <p className="muted">期待値（注釈）がありません。</p>}
      <table>
        <thead>
          <tr><th>注釈</th><th>対象</th><th>判定</th><th>理由</th><th>許容差（出所）</th></tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.annotationId} data-testid={`finding-${f.annotationId}`}>
              <td>{f.annotationId}</td>
              <td>{f.target}</td>
              <td>{statusLabel(f.status)}</td>
              <td>{f.reason}</td>
              <td>±{pct(f.tolerance.rel)}（{sourceLabel(f.tolerance.source)}）</td>
            </tr>
          ))}
        </tbody>
      </table>

      {findings.some((f) => f.status === 'mismatch') && (
        <div className="row">
          <button
            type="button"
            onClick={() => {
              const f = findings.find((x) => x.status === 'mismatch')!;
              setProposals({ finding: f.annotationId, list: proposeRepairs(netlist, f, settings) });
            }}
          >
            修正案を作る（最初の不一致）
          </button>
        </div>
      )}
      {proposals && (
        <div className="proposals" data-testid="proposals">
          <h4>修正案（{proposals.finding}）</h4>
          {proposals.list.length === 0 && <p>許容誤差内に収まる抵抗値の修正案は見つかりませんでした。</p>}
          <ul>
            {proposals.list.map((p, i) => (
              <li key={i}>
                {p.description}。再解析の相対誤差 {pct(p.relErrAfter)}
                <button type="button" onClick={() => onApply(setValue(netlist, p.partId, p.to))}>この案を適用</button>
              </li>
            ))}
          </ul>
          <p className="muted">適用すると回路が変わるため、再確定が必要になります。</p>
        </div>
      )}

      <h4>飽和の判定</h4>
      {sat.length === 0 ? <p className="muted">オペアンプはありません。</p> : (
        <ul>{sat.map((s) => <li key={s.opampId}>{s.opampId}: {s.message}</li>)}</ul>
      )}

      <h4>判定の前提（記録）</h4>
      {assumptions.length === 0 ? <p className="muted">回答はありません。</p> : (
        <ul>{assumptions.map((a, i) => <li key={i}>{a.question} → {a.answer}</li>)}</ul>
      )}
      <Disclaimer />
    </div>
  );
}

function statusLabel(s: Finding['status']): string {
  return { ok: '一致', mismatch: '不一致', sign: '符号のみ異なる（Q2）', unmeasurable: '測定不可' }[s];
}
function sourceLabel(s: Finding['tolerance']['source']): string {
  return { annotation: '注釈', user: '利用者指定', default: '既定' }[s];
}
