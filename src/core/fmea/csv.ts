// FMEA 結果の CSV（FR-FM-07）。Excel 形式は対象外。
import { ACTION_LABEL, type FmeaRow } from './evaluate';

export function escapeCsv(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function fmeaToCsv(rows: FmeaRow[]): string {
  const header = ['部品ID', '種別', '故障モード', '注入', 'S', 'O', 'D', 'RPN', '対策要否', '根拠'];
  const lines = rows.map((r) =>
    [r.partId, r.kind, r.modeLabel, r.injection, r.S, r.O, r.D, r.RPN, ACTION_LABEL[r.action], r.basis.join(' / ')]
      .map((v) => escapeCsv(v as string | number | null))
      .join(','),
  );
  return [header.map((h) => escapeCsv(h)).join(','), ...lines].join('\r\n') + '\r\n';
}
