// AI による抽出の受け渡し（FR-EX-01、FR-EX-02）。アプリは外部 API を呼ばない。
// 抽出依頼 JSON を書き出し、利用者が Claude Code で得た抽出結果 JSON を読み込む。
import { type Netlist } from './netlist';
import { parseNetlist, type Parsed } from './schema';
import { type ProjectImage } from './project';

export const REQUEST_FORMAT = 'circuit-review-extraction-request';
export const RESULT_FORMAT = 'circuit-review-extraction-result';
export const HANDOFF_VERSION = 1;

export const EXTRACTION_INSTRUCTIONS = [
  '添付の回路図画像から、部品（種別・ID・値・単位・端子の接続先ノード・所属ブロック）、',
  '接続、ノード、注釈（期待値を含む）を読み取り、netlist-v1 の JSON で返してください。',
  '読み取れない値は value を null にし、uncertain を true にしてください。推測で埋めないでください。',
].join('');

export function buildRequest(image: ProjectImage): string {
  return JSON.stringify(
    {
      format: REQUEST_FORMAT,
      formatVersion: HANDOFF_VERSION,
      image,
      instructions: EXTRACTION_INSTRUCTIONS,
      resultFormat: RESULT_FORMAT,
    },
    null,
    2,
  );
}

/** 抽出結果を読み込む。結果は未確定の下書きとして扱う（確認・確定を経るまで評価できない）。 */
export function parseResult(text: string): Parsed<Netlist> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['JSON として読めません'] };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['抽出結果ではありません'] };
  const r = raw as Record<string, unknown>;
  if (r.format !== RESULT_FORMAT) return { ok: false, errors: ['抽出結果の形式が違います'] };
  if (r.formatVersion !== HANDOFF_VERSION) return { ok: false, errors: ['未対応の版です'] };
  return parseNetlist(r.netlist);
}
