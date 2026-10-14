/**
 * 다운로드형 PDF 판별 하니스 — `npx tsx tests/test-pdf-sniff.mts`
 *
 * KDI `callDownload.do` 는 Content-Type 없이 `Content-Disposition` + `%PDF-` 본문만 준다(DEV_261014).
 * 확장자·Content-Type 만 보면 놓친다 — 세 근거 중 하나면 PDF.
 */
import { isPdfResponse, isPdfText } from '../server/pdf-sniff.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}`); };
const H = (h: Record<string, string>) => new Headers(h);
const PDF = new TextEncoder().encode('%PDF-1.4\n');
const HTML = new TextEncoder().encode('<!doctype html><html>');

check('KDI 형태 — Content-Type 없음 + attachment .pdf', isPdfResponse(H({ 'content-disposition': 'attachment; filename="R2601744.pdf";' }), PDF));
check('헤더 전혀 없음 + %PDF- 본문', isPdfResponse(H({}), PDF));
check('Content-Type application/pdf', isPdfResponse(H({ 'content-type': 'application/pdf' }), HTML));
check('octet-stream + filename*=UTF-8 .pdf', isPdfResponse(H({ 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf" }), new Uint8Array()));
check('일반 HTML 은 아님', !isPdfResponse(H({ 'content-type': 'text/html; charset=utf-8' }), HTML));
check('.pdfx 같은 다른 확장자는 아님', !isPdfResponse(H({ 'content-disposition': 'attachment; filename="a.pdfx"' }), HTML));
check('빈 본문·헤더 없음은 아님', !isPdfResponse(H({}), new Uint8Array()));
check('스크래퍼가 글자로 돌려준 PDF', isPdfText('%PDF-1.4 %äüöß 2 0 obj'));
check('본문에 %PDF- 가 나와도 맨 앞이 아니면 아님', !isPdfText('제목: PDF 형식\n%PDF-1.4 설명'));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
