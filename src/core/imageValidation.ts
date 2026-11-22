// 画像の受付条件（FR-IN-02、FR-IN-03）。
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_LONG_SIDE = 4000;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg'] as const;

export interface ImageMeta {
  type: string;
  size: number;
  width?: number;
  height?: number;
}

export function validateImage(meta: ImageMeta): string[] {
  const errors: string[] = [];
  if (!(ACCEPTED_TYPES as readonly string[]).includes(meta.type)) {
    errors.push('対応形式は PNG と JPG です（SVG と PDF は後続）');
  }
  if (meta.size > MAX_IMAGE_BYTES) errors.push('ファイルサイズは 10 MB 以下にしてください');
  if (meta.width !== undefined && meta.height !== undefined) {
    if (Math.max(meta.width, meta.height) > MAX_LONG_SIDE) {
      errors.push('画像の長辺は 4000 px 以下にしてください');
    }
  }
  return errors;
}
