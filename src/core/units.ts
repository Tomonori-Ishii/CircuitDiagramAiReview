// 値の数値・接頭辞・単位の分離と検証（FR-CK-04）。

export const PREFIXES: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  µ: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
};

export const UNITS = ['Ω', 'F', 'H', 'V', 'A'] as const;
export type Unit = (typeof UNITS)[number];

export type ParseResult = { ok: true; value: number; unit: Unit } | { ok: false; error: string };

/** 数値文字列・接頭辞・単位から SI 値を求める。例: ("4.7", "k", "Ω") → 4700 */
export function compose(numberText: string, prefix: string, unit: string): ParseResult {
  const t = numberText.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    return { ok: false, error: `数値として読めません: "${numberText}"` };
  }
  if (!(prefix in PREFIXES)) {
    return { ok: false, error: `接頭辞が不正です: "${prefix}"` };
  }
  if (!(UNITS as readonly string[]).includes(unit)) {
    return { ok: false, error: `単位が不正です: "${unit}"` };
  }
  return { ok: true, value: Number(t) * PREFIXES[prefix], unit: unit as Unit };
}

/**
 * 「4.7kΩ」「100 nF」「1µF」のような表記を読む。
 * 接頭辞 u は µ と同じとは扱わない（表記を統一するため）。
 */
export function parseValueText(text: string): ParseResult {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([pnµmkMG]?)\s*(Ω|F|H|V|A)\s*$/.exec(text);
  if (!m) return { ok: false, error: `値の表記を読めません: "${text}"` };
  return compose(m[1], m[2], m[3]);
}

/** 信号源の実効値（rms）へ換算する。ピーク値は √2 で割る。 */
export function toRms(value: number, mode: 'dc' | 'ac_rms' | 'ac_peak'): number {
  return mode === 'ac_peak' ? value / Math.SQRT2 : value;
}
