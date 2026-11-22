// 取り消し・やり直し（FR-DR-06）。状態のスナップショットを積む。
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function push<T>(h: History<T>, next: T, limit = 200): History<T> {
  const past = [...h.past, h.present];
  if (past.length > limit) past.shift();
  return { past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}
