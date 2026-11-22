// プロジェクトファイル（FR-ST-03、FR-ST-04）。画像を埋め込み、評価結果は保存しない。API キーは含めない。
import { type Netlist } from './netlist';
import { parseNetlist, type Parsed } from './schema';
import { type QuestionState } from './questions';

export const PROJECT_FORMAT = 'circuit-review-project';
export const PROJECT_VERSION = 1;

export interface ProjectImage {
  name: string;
  mime: string;
  dataUrl: string;
}

export interface ProjectSettings {
  userTolerance?: number;
  frequency?: number;
  supplyV?: number;
  signFlips?: string[];
  fmea?: {
    targets: string[];
    occurrence: Record<string, { value: number; basis: string }>;
    percent: Record<string, number>;
    rpnThreshold: number;
    sThreshold: number;
  };
  fta?: { topAnnotationId?: string; order: number; targets: string[] };
}

export interface Project {
  netlist: Netlist;
  /** 確定の版（0 は未確定） */
  version: number;
  image: ProjectImage | null;
  answers: QuestionState;
  settings: ProjectSettings;
}

export function serializeProject(p: Project, savedAt = new Date().toISOString()): string {
  return JSON.stringify(
    {
      format: PROJECT_FORMAT,
      formatVersion: PROJECT_VERSION,
      savedAt,
      version: p.version,
      image: p.image,
      netlist: p.netlist,
      answers: p.answers,
      settings: p.settings,
    },
    null,
    2,
  );
}

export function parseProject(text: string): Parsed<Project> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['JSON として読めません'] };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['プロジェクトファイルではありません'] };
  const r = raw as Record<string, unknown>;
  if (r.format !== PROJECT_FORMAT) return { ok: false, errors: ['プロジェクトファイルの形式が違います'] };
  if (r.formatVersion !== PROJECT_VERSION) {
    return { ok: false, errors: [`未対応のファイル版です（${String(r.formatVersion)}）`] };
  }
  const net = parseNetlist(r.netlist);
  if (!net.ok) return { ok: false, errors: net.errors };
  const answers = r.answers as QuestionState | undefined;
  const answersOk = typeof answers === 'object' && answers !== null && typeof answers.answers === 'object' && answers.answers !== null;
  const image = r.image as ProjectImage | null;
  const imageOk = image === null || (typeof image === 'object' && typeof image.dataUrl === 'string' && image.dataUrl.startsWith('data:image/'));
  if (!answersOk) return { ok: false, errors: ['回答（answers）の形式が不正です'] };
  if (!imageOk) return { ok: false, errors: ['画像データが不正です'] };
  return {
    ok: true,
    value: {
      netlist: net.value,
      version: typeof r.version === 'number' ? r.version : 0,
      image,
      answers: answers as QuestionState,
      settings: (typeof r.settings === 'object' && r.settings !== null ? r.settings : {}) as Project['settings'],
    },
  };
}
