// 作業の状態（編集中・確定済み）と版番号（FR-CK-07、FR-CK-08）。
import { type Issue, hasErrors, validateNetlist } from './validation';
import { type Netlist } from './netlist';

export interface Session {
  netlist: Netlist;
  status: 'editing' | 'confirmed';
  /** 確定の度に増える版番号（0 は未確定） */
  version: number;
  /** 確定時点のスナップショット（評価に使う） */
  confirmed?: Netlist;
}

export function newSession(netlist: Netlist): Session {
  return { netlist, status: 'editing', version: 0 };
}

export type ConfirmResult = { ok: true; session: Session } | { ok: false; issues: Issue[] };

/** 確定。エラーがあれば確定しない。 */
export function confirm(session: Session): ConfirmResult {
  const issues = validateNetlist(session.netlist);
  if (hasErrors(issues)) return { ok: false, issues };
  return {
    ok: true,
    session: {
      netlist: session.netlist,
      status: 'confirmed',
      version: session.version + 1,
      confirmed: structuredClone(session.netlist),
    },
  };
}

/** 編集。確定後の編集は編集中に戻す（評価は再確定まで行えない）。 */
export function edit(session: Session, netlist: Netlist): Session {
  return { ...session, netlist, status: 'editing' };
}

export const canEvaluate = (s: Session): boolean => s.status === 'confirmed' && s.confirmed !== undefined;
