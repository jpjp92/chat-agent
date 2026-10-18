/**
 * 서버(노드)에서 PDF 텍스트층 추출 — 링크로 받은 PDF 의 후속 턴 근거(DEV_261014).
 *
 * 업로드 PDF 는 브라우저가 첨부 시 `pdfText` 를 만든다(lib/pdf-text.ts). 링크 PDF 는 브라우저가
 * 바이트를 못 받으므로(CORS) fetch-url 이 이미 받은 바이트로 같은 함수를 돌린다.
 *
 * pdfjs 는 노드에서 DOMMatrix 등이 없으면 `@napi-rs/canvas` 를 불러오는데, 이 네이티브 모듈이
 *    WSL 에서 프로세스를 죽였다(exit 135). 텍스트 추출엔 렌더링이 필요 없으므로 빈 껍데기를 먼저 둔다.
 */
import { extractPdfText } from '../lib/pdf-text';

const g = globalThis as any;
for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
    if (!g[name]) g[name] = class {};
}

const EXTRACT_TIMEOUT_MS = 8_000;

/** 실패·시간 초과·스캔본이면 빈 문자열 — 호출부는 근거 없이 계속 간다. */
export async function extractPdfTextOnServer(bytes: Uint8Array): Promise<string> {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            extractPdfText(buffer),
            new Promise<string>(resolve => { timer = setTimeout(() => resolve(''), EXTRACT_TIMEOUT_MS); }),
        ]);
    } catch (e: any) {
        console.warn('[pdf-text-node] extraction failed', e?.message);
        return '';
    } finally {
        clearTimeout(timer);
    }
}
