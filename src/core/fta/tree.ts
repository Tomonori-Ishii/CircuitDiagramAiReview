// FTA 図（SVG）の生成（FR-FT-04、FR-FT-06）。トップ事象は OR、カットセット内は AND。
import { type CutSet } from './cutsets';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function treeSvg(topLabel: string, cutSets: CutSet[]): string {
  const colW = 170;
  const leafH = 34;
  const width = Math.max(420, cutSets.length * colW + 40);
  const topX = width / 2;
  const andY = 130;
  const leafY = 200;
  const height = leafY + 2 * leafH + 40 + 80;
  const parts: string[] = [];
  parts.push(`<rect x="${topX - 150}" y="16" width="300" height="44" rx="6" class="box top"/>`);
  parts.push(`<text x="${topX}" y="43" text-anchor="middle" class="label">${esc(topLabel)}</text>`);
  cutSets.forEach((cs, i) => {
    const cx = 20 + colW / 2 + i * colW;
    parts.push(`<line x1="${topX}" y1="60" x2="${cx}" y2="${andY}" class="edge"/>`);
    parts.push(`<rect x="${cx - 60}" y="${andY - 16}" width="120" height="32" rx="16" class="box gate"/>`);
    parts.push(`<text x="${cx}" y="${andY + 5}" text-anchor="middle" class="label">AND</text>`);
    cs.events.forEach((e, j) => {
      const y = leafY + j * (leafH + 12);
      parts.push(`<line x1="${cx}" y1="${andY + 16}" x2="${cx}" y2="${y}" class="edge"/>`);
      parts.push(`<rect x="${cx - 78}" y="${y}" width="156" height="${leafH}" rx="4" class="box leaf"/>`);
      parts.push(`<text x="${cx}" y="${y + 21}" text-anchor="middle" class="label small">${esc(e.label)}</text>`);
    });
  });
  if (cutSets.length === 0) {
    parts.push(`<text x="${topX}" y="${andY + 20}" text-anchor="middle" class="label">カットセットなし</text>`);
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="FTA 図">`,
    '<style>.box{fill:#fff;stroke:#333}.top{fill:#fde68a}.gate{fill:#e0e7ff}.leaf{fill:#f1f5f9}.edge{stroke:#333}.label{font:13px sans-serif;fill:#111}.small{font-size:11px}</style>',
    ...parts,
    '</svg>',
  ].join('');
}
