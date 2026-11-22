import { useMemo, useState } from 'react';
import { type AnalysisRun } from '../core/analysis';
import { ACTION_LABEL, type FmeaRow } from '../core/fmea/evaluate';
import { rowsFor, type FmeaSettings } from '../core/fmea/evaluate';
import { fmeaToCsv } from '../core/fmea/csv';
import { failureModes } from '../core/fmea/library';
import { type Kind, type Netlist } from '../core/netlist';
import { Disclaimer } from './Disclaimer';

export interface FmeaState {
  targets: string[];
  occurrence: Record<string, { value: number; basis: string }>;
  percent: Record<string, number>;
  rpnThreshold: number;
  sThreshold: number;
}

interface Props {
  netlist: Netlist;
  run: AnalysisRun;
  state: FmeaState;
  base: Omit<FmeaSettings, 'occurrence' | 'percent' | 'rpnThreshold' | 'sThreshold'>;
  onState: (s: FmeaState) => void;
}

export function FmeaPanel({ netlist, run, state, base, onState }: Props) {
  const [rows, setRows] = useState<FmeaRow[] | null>(null);
  const candidates = netlist.parts.filter((p) => failureModes(p.kind) !== null);
  const undefinedParts = netlist.parts.filter((p) => failureModes(p.kind) === null);
  const csvUrl = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    return URL.createObjectURL(new Blob([fmeaToCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  }, [rows]);

  const toggle = (id: string) =>
    onState({ ...state, targets: state.targets.includes(id) ? state.targets.filter((x) => x !== id) : [...state.targets, id] });

  if (run.blocked) return <p className="warn">前提が満たされず解析できないため、FMEA は実行できません。</p>;

  return (
    <div>
      <h3>FMEA</h3>
      <p className="muted">対象部品を選び、部品ごとに発生度 O（1〜10）と根拠を入力してください。S と D は解析結果から決まります。</p>
      <div className="row wrap">
        {candidates.map((p) => (
          <label key={p.id} className="chip">
            <input type="checkbox" aria-label={`FMEA 対象 ${p.id}`} checked={state.targets.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.id}（{p.kind}）
          </label>
        ))}
      </div>
      {undefinedParts.length > 0 && (
        <p className="warn">故障モードが未定義の部品があります（{undefinedParts.map((p) => p.id).join(', ')}）。故障モードを質問する対象です。</p>
      )}
      {state.targets.map((id) => (
        <div className="row" key={id}>
          <span>{id}の O</span>
          <input
            type="number"
            min={1}
            max={10}
            aria-label={`${id} の発生度 O`}
            value={state.occurrence[id]?.value ?? ''}
            onChange={(e) => {
              const v = Number(e.target.value);
              onState({ ...state, occurrence: { ...state.occurrence, [id]: { value: v, basis: state.occurrence[id]?.basis ?? '' } } });
            }}
          />
          <input
            type="number"
            aria-label={`${id} の値変化（%）`}
            placeholder="変化率（既定 ±50% / ±10%）"
            value={state.percent[id] ?? ''}
            onChange={(e) => {
              const next = { ...state.percent };
              if (e.target.value === '') delete next[id];
              else next[id] = Number(e.target.value);
              onState({ ...state, percent: next });
            }}
          />
          <input
            aria-label={`${id} の O の根拠`}
            placeholder="根拠（例: 同型部品の経験）"
            value={state.occurrence[id]?.basis ?? ''}
            onChange={(e) => onState({ ...state, occurrence: { ...state.occurrence, [id]: { value: state.occurrence[id]?.value ?? 0, basis: e.target.value } } })}
          />
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={state.targets.length === 0}
          onClick={() =>
            setRows(rowsFor(netlist, run, { ...base, ...state }, state.targets, (k) => failureModes(k as Kind)))
          }
        >
          FMEA を実行
        </button>
        {csvUrl && <a href={csvUrl} download="fmea.csv">CSV をダウンロード</a>}
      </div>
      {rows && (
        <table data-testid="fmea-table">
          <thead>
            <tr><th>部品</th><th>故障モード</th><th>注入</th><th>S</th><th>O</th><th>D</th><th>RPN</th><th>対策</th><th>根拠</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.partId}</td>
                <td>{r.modeLabel}</td>
                <td>{r.injection}</td>
                <td>{r.S}</td>
                <td>{r.O ?? '—'}</td>
                <td>{r.D}</td>
                <td>{r.RPN ?? '—'}</td>
                <td>{ACTION_LABEL[r.action]}</td>
                <td>{r.basis.join(' / ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Disclaimer />
    </div>
  );
}
