import { useRef, useState, type DragEvent } from 'react';
import { validateImage } from '../core/imageValidation';

export interface LoadedImage {
  name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  dataUrl: string;
}

/** 画像を読み、受付条件を検査する。 */
export function readImage(file: File): Promise<{ ok: true; image: LoadedImage } | { ok: false; errors: string[] }> {
  // 形式とサイズは読み込む前に検査する
  const early = validateImage({ type: file.type, size: file.size });
  if (early.length > 0) return Promise.resolve({ ok: false, errors: early });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, errors: ['ファイルを読めませんでした'] });
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onerror = () => resolve({ ok: false, errors: ['画像として読めません'] });
      img.onload = () => {
        const errors = validateImage({ type: file.type, size: file.size, width: img.naturalWidth, height: img.naturalHeight });
        if (errors.length > 0) resolve({ ok: false, errors });
        else resolve({ ok: true, image: { name: file.name, mime: file.type, size: file.size, width: img.naturalWidth, height: img.naturalHeight, dataUrl } });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function ImageDropZone({ onImage, disabled }: { onImage: (img: LoadedImage) => void; disabled?: boolean }) {
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const r = await readImage(file);
    if (r.ok) {
      setErrors([]);
      onImage(r.image);
    } else setErrors(r.errors);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void handle(e.dataTransfer.files[0]);
  };

  return (
    <div>
      <div
        data-testid="dropzone"
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={disabled ? undefined : onDrop}
      >
        <p>回路図の画像（PNG または JPG）をここへドラッグ&ドロップしてください</p>
        <button type="button" onClick={() => input.current?.click()} disabled={disabled}>
          ファイルを選ぶ
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          data-testid="file-input"
          onChange={(e) => void handle(e.target.files?.[0])}
        />
        <small>10 MB 以下、長辺 4000 px 以下、1 画像を 1 回路として扱います。</small>
      </div>
      {errors.length > 0 && (
        <ul className="error-list" role="alert">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
