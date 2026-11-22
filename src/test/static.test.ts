// 静的な検査: 外部送信・鍵の扱い・React 非依存・日本語 lang（UR-32、UR-35、UR-36、CON-07）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith('.test.ts') || p.endsWith('.test.tsx') ? [] : [p];
  });
}

const sourceFiles = files(join(root, 'src'));

describe('静的検査', () => {
  it('アプリは外部 API を呼ばない（CON-07、NFR-SEC-01）', () => {
    const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /navigator\.share/];
    for (const f of sourceFiles) {
      const text = readFileSync(f, 'utf-8');
      for (const re of banned) expect(text, f).not.toMatch(re);
    }
  });
  it('API キーやログイン情報の入力欄を持たない（CON-07）', () => {
    for (const f of sourceFiles) {
      expect(readFileSync(f, 'utf-8'), f).not.toMatch(/api[_-]?key|apikey|password/i);
    }
  });
  it('解析コア（src/core）は React に依存しない（CON-02、UR-36）', () => {
    for (const f of sourceFiles.filter((x) => x.includes('/core/'))) {
      expect(readFileSync(f, 'utf-8'), f).not.toMatch(/from ['"]react/);
    }
  });
  it('index.html の lang は ja（NFR-LANG-01）', () => {
    expect(readFileSync(join(root, 'index.html'), 'utf-8')).toMatch(/<html lang="ja">/);
  });
  it('React・TypeScript・Vite で構成する（CON-01、CON-06）', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.devDependencies.typescript).toBeDefined();
    expect(pkg.devDependencies.vite).toBeDefined();
  });
});
