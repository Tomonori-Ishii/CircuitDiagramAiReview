// FTA のトップ事象の候補（FR-FT-01）。期待値の注釈から作る。
import { type Expectation, type Netlist } from '../netlist';

export interface TopEventCandidate {
  annotationId: string;
  label: string;
  expect: Expectation;
}

export function topEventCandidates(netlist: Netlist): TopEventCandidate[] {
  return netlist.annotations
    .filter((a) => a.expect && a.target)
    .map((a) => ({
      annotationId: a.id,
      label: `${a.target?.id} の出力が期待値 ${a.expect?.value} から許容誤差を超えて外れる（${a.text}）`,
      expect: a.expect as Expectation,
    }));
}
