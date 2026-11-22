// 故障モードライブラリ（FR-FM-02、CON-05）。LLM は使わない。
import { type Kind } from '../netlist';

export type ModeId = 'open' | 'short' | 'change_up' | 'change_down' | 'loss';

export interface FailureMode {
  id: ModeId;
  label: string;
  /** 値の変化の割合（±%）。既定値。 */
  percent?: number;
}

const passive: FailureMode[] = [
  { id: 'open', label: '開放' },
  { id: 'short', label: '短絡' },
  { id: 'change_up', label: '値の変化（+50%）', percent: 50 },
  { id: 'change_down', label: '値の変化（−50%）', percent: -50 },
];

const source: FailureMode[] = [
  { id: 'loss', label: '出力喪失（0）' },
  { id: 'change_up', label: '値の変化（+10%）', percent: 10 },
  { id: 'change_down', label: '値の変化（−10%）', percent: -10 },
];

/** 部品種別の故障モード。未定義の種別は null。 */
export function failureModes(kind: Kind): FailureMode[] | null {
  switch (kind) {
    case 'R':
    case 'C':
    case 'L':
      return passive;
    case 'V':
    case 'I':
      return source;
    case 'OPAMP':
      return [{ id: 'loss', label: '出力喪失（出力 0 V に固定）' }];
    default:
      return null;
  }
}
