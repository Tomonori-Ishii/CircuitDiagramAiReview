// 負帰還の検査（FR-AN-08）。各オペアンプの出力から反転入力へ、そのオペアンプ自身を除く
// 2 端子素子（R・C・L・電圧源・電流源）の経路があるかを調べる。
import { type Netlist, TERMINALS } from './netlist';

export interface FeedbackCheck {
  opampId: string;
  hasFeedback: boolean;
}

export function checkFeedback(netlist: Netlist): FeedbackCheck[] {
  const twoTerminal = netlist.parts.filter((p) => ['R', 'C', 'L', 'V', 'I'].includes(p.kind));
  return netlist.parts
    .filter((p) => p.kind === 'OPAMP')
    .map((op) => {
      const from = op.pins.out;
      const to = op.pins['-'];
      const adj = new Map<string, string[]>();
      const link = (a: string, b: string) => {
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
      };
      for (const p of twoTerminal) {
        const [t1, t2] = TERMINALS[p.kind] as readonly string[];
        if (p.pins[t1] && p.pins[t2]) link(p.pins[t1], p.pins[t2]);
      }
      const seen = new Set<string>([from]);
      const queue = [from];
      let reached = from === to;
      while (!reached && queue.length > 0) {
        const cur = queue.shift()!;
        for (const nx of adj.get(cur) ?? []) {
          if (nx === to) {
            reached = true;
            break;
          }
          if (!seen.has(nx)) {
            seen.add(nx);
            queue.push(nx);
          }
        }
      }
      return { opampId: op.id, hasFeedback: reached };
    });
}
