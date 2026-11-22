import { useMemo, useState } from 'react';
import { type AnalysisRun } from '../core/analysis';
import { basicEventsOf, type CutSetResult, minimalCutSets, DEFAULT_ORDER, MAX_ORDER } from '../core/fta/cutsets';
import { topEventCandidates } from '../core/fta/topEvents';
import { treeSvg } from '../core/fta/tree';
import { failureModes } from '../core/fmea/library';
import { type Netlist } from '../core/netlist';
import { type ReviewSettings } from '../core/review';
import { Disclaimer } from './Disclaimer';

interface Props {
  netlist: Netlist;
  run: AnalysisRun;
  settings: ReviewSettings;
  targets: string[];
  onTargets: (t: string[]) => void;
}

export function FtaPanel({ netlist, run, settings, targets, onTargets }: Props) {
  const candidates = useMemo(() => topEventCandidates(netlist), [netlist]);
  const [top, setTop] = useState<string>('');
  const [order, setOrder] = useState<number>(DEFAULT_ORDER);
  const [result, setResult] = useState<CutSetResult | null>(null);
  const topId = top || candidates[0]?.annotationId || '';
  const selectable = netlist.parts.filter((p) => failureModes(p.kind) !== null);

  if (run.blocked) return <p className="warn">前提が満たされず解析できないため、FTA は実行できません。</p>;
  if (candidates.length === 0) return <p className="warn">トップ事象の候補がありません。期待値の注釈（期待の種類と値）を追加してください。</p>;

  const execute = () => {
    const events = basicEventsOf(
      targets.map((id) => ({ id, modes: failureModes(netlist.parts.find((p) => p.id === id)!.kind) ?? [] })),
    );
    setResult(minimalCutSets(netlist, events, { ...settings, order, topAnnotationId: topId }));
  };

  const topLabel = candidates.find((c) => c.annotationId === topId)?.label ?? 'トップ事象';
  const svg = useMemo(() => (result ? treeSvg(topLabel, result.cutSets) : ''), [result, topLabel]);

  return (
    <div>
      <h3>FTA</h3>
      <div className="row">
        <label>トップ事象
          <select aria-label="トップ事象" value={topId} onChange={(e) => setTop(e.target.value)}>
            {candidates.map((c) => <option key={c.annotationId} value={c.annotationId}>{c.label}</option>)}
          </select>
        </label>
        <label>組合せの次数
          <select aria-label="組合せの次数" value={order} onChange={(e) => setOrder(Number(e.target.value))}>
            {Array.from({ length: MAX_ORDER }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      <div className="row wrap">
        {selectable.map((p) => (
          <label key={p.id} className="chip">
            <input type="checkbox" aria-label={`FTA 対象 ${p.id}`} checked={targets.includes(p.id)}
              onChange={() => onTargets(targets.includes(p.id) ? targets.filter((x) => x !== p.id) : [...targets, p.id])} />
            {p.id}
          </label>
        ))}
      </div>
      <button type="button" className="primary" disabled={targets.length === 0} onClick={execute}>最小カットセットを求める</button>
      {result && (
        <div data-testid="fta-result">
          {result.warning && <p className="warn">{result.warning}</p>}
          <p>組合せ数（次数 {order} まで）: {result.combinationCount}</p>
          <table>
            <thead><tr><th>カットセット</th><th>逸脱量</th><th>根拠</th></tr></thead>
            <tbody>
              {result.cutSets.map((c, i) => (
                <tr key={i} data-testid="cutset-row">
                  <td>{c.events.map((e) => e.label).join(' AND ')}</td>
                  <td>{c.deviation === null ? '—' : `${(c.deviation * 100).toFixed(1)}%`}</td>
                  <td>{c.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.cutSets.length === 0 && <p>トップ事象を起こす組合せは見つかりませんでした。</p>}
          <div className="fta-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}
      <Disclaimer />
    </div>
  );
}
