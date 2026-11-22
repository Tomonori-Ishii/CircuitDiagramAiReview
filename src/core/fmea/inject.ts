// 故障の注入（FR-FM-04、FR-AN-04）。注入後のネットリストを返す純関数。
import { type Netlist, type Part } from '../netlist';
import { type FailureMode } from './library';

/** 短絡の代用抵抗（1 mΩ、要件の既定値） */
export const SHORT_OHM = 1e-3;

export interface InjectionResult {
  netlist: Netlist;
  /** 注入の説明（記録用） */
  description: string;
}

/**
 * mode を部品 partId に注入する。
 * percent: 値の変化の割合（既定は mode.percent）。利用者は変更でき、変更値は記録される。
 */
export function inject(netlist: Netlist, partId: string, mode: FailureMode, percent?: number): InjectionResult {
  const part = netlist.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`部品が見つかりません: ${partId}`);
  const withoutPart = { ...netlist, parts: netlist.parts.filter((p) => p.id !== partId) };
  const pct = percent ?? mode.percent ?? 0;

  switch (mode.id) {
    case 'open':
      return { netlist: withoutPart, description: `${partId} を開放（素子を取り除く）` };
    case 'short':
      if (part.kind === 'R' || part.kind === 'C' || part.kind === 'L') {
        return {
          netlist: replace(netlist, partId, { ...part, kind: 'R', value: SHORT_OHM, valueRaw: `${SHORT_OHM} Ω`, sourceMode: undefined }),
          description: `${partId} を短絡（${SHORT_OHM} Ω の抵抗で代用）`,
        };
      }
      return { netlist, description: `${partId} の短絡は対象外` };
    case 'change_up':
    case 'change_down': {
      const base = part.value ?? 0;
      const v = base * (1 + pct / 100);
      return {
        netlist: replace(netlist, partId, { ...part, value: v, valueRaw: `${v}` }),
        description: `${partId} の値を ${base} から ${v}（${pct > 0 ? '+' : ''}${pct}%）に変更`,
      };
    }
    case 'loss': {
      if (part.kind === 'OPAMP') {
        // 出力を 0 V の電圧源で GND に固定する
        const out = part.pins.out;
        const rest = withoutPart.parts;
        return {
          netlist: {
            ...withoutPart,
            parts: [
              ...rest,
              { id: `${partId}_loss`, kind: 'V', value: 0, valueRaw: '0 V', sourceMode: 'dc', pins: { '+': out, '-': 'GND' }, block: part.block },
            ],
          },
          description: `${partId} の出力を 0 V に固定`,
        };
      }
      return {
        netlist: replace(netlist, partId, { ...part, value: 0, valueRaw: '0' }),
        description: `${partId} の出力を 0 にする`,
      };
    }
    default:
      throw new Error(`未知の故障モード: ${mode.id}`);
  }
}

function replace(netlist: Netlist, id: string, part: Part): Netlist {
  return { ...netlist, parts: netlist.parts.map((p) => (p.id === id ? part : p)) };
}
