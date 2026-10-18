/**
 * PDF 텍스트층 추출(브라우저) — **후속 턴 전용** 문서 근거 → DEV_261013
 *
 * PDF 는 첫 턴에 파일 그대로 모델에 간다(표·레이아웃 보존). 그런데 서버 히스토리는
 * 최근 메시지 3개(mediaWindow) 밖의 첨부를 `[Attached File: …]` 이름표로 강등해 후속 2회째부터
 * 모델이 PDF 를 못 본다. DOCX·HWP 처럼 텍스트를 `lastActiveDoc` 로 이어 주면 그 공백이 메워진다.
 * 첫 턴 webContent 에는 싣지 않는다(`extractedText` 가 아닌 `pdfText`) — 첫 분석 동작은 그대로.
 *
 * 워커 대신 메인 스레드(fake worker)로 돈다 — 번들러 워커 설정이 필요 없고, 100쪽 ~1s.
 * 스캔 PDF 는 텍스트층이 없어 빈 문자열 → 호출부가 아무것도 안 붙인다.
 */
const PDF_TEXT_MAX = 200_000;

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
    const pdfjs = await import('pdfjs-dist');
    const g = globalThis as any;
    // 워커 모듈엔 타입 선언이 없다. 전역에 두면 pdfjs 가 fake worker 로 메인 스레드에서 쓴다.
    // @ts-expect-error 워커 모듈엔 타입 선언이 없다
    if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    let out = '';
    try {
        for (let p = 1; p <= doc.numPages && out.length < PDF_TEXT_MAX; p++) {
            const content = await (await doc.getPage(p)).getTextContent();
            out += `\n[p.${p}]\n` + content.items.map((i: any) => (i.str ?? '') + (i.hasEOL ? '\n' : '')).join('');
        }
    } finally {
        await doc.destroy();
    }
    const text = out.trim();
    return text.replace(/\[p\.\d+\]/g, '').trim().length < 50 ? '' : text.slice(0, PDF_TEXT_MAX);
}
