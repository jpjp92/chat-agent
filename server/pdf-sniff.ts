/**
 * 응답 바이트·헤더로 PDF 를 알아본다 — URL 확장자가 없는 다운로드 링크용(fetch-url, DEV_261014).
 * route.ts 는 라우트 핸들러 외 export 가 막혀 있어 여기 둔다.
 */
/** 응답이 PDF 인가 — Content-Type · Content-Disposition 파일명 · `%PDF-` 첫 바이트 중 하나. */
export const isPdfResponse = (headers: Headers, head: Uint8Array): boolean => {
    if ((headers.get('content-type') ?? '').toLowerCase().includes('application/pdf')) return true;
    if (/filename\*?=[^;]*\.pdf\b/i.test(headers.get('content-disposition') ?? '')) return true;
    return head.length >= 5 && String.fromCharCode(...head.subarray(0, 5)) === '%PDF-';
};

/**
 * 대체 스크래퍼(ScrapingBee·browserless)가 PDF 바이너리를 글자로 돌려준 결과인가.
 * W3C 처럼 우리 브라우저 UA 를 403 으로 막는 곳은 직접 fetch 판별을 못 거치고 여기로 온다(DEV_261014).
 */
export const isPdfText = (text: string): boolean => /^\s*%PDF-\d/.test(text);
