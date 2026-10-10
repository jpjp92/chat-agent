/**
 * 응답 대기 문구 하니스 — `npx tsx tests/test-loading-status.mts`
 * DEV_261010 §2-11: 문구가 즉시 지워지거나(arXiv·YouTube·URL) 오판(`'정'` → "정리해줘" 가 약품 식별)되던 것.
 */
import fs from 'node:fs';
import { hasPillIntent, pickWaitingStatus } from '../src/lib/loading-status.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got=${got} want=${want}`);

const IMG = [{ mimeType: 'image/png', fileName: 'a.png' }];
const att = (fileName: string, mimeType = 'application/octet-stream') => [{ fileName, mimeType }];
console.log('── 알약 의도 ──');
for (const t of ['이 알약 뭐야', '타이레놀정 맞아?', '무슨 약이야', '이 약 이름 알려줘', '캡슐 식별해줘']) check(`알약  "${t}"`, hasPillIntent(t));
for (const t of ['이 표 정리해줘', '정보 알려줘', '일정 확인', '결정 내용 요약', '수정해줘', '이 사진 분석해줘']) check(`알약 아님  "${t}"`, !hasPillIntent(t));

const pick = (x: Parameters<typeof pickWaitingStatus>[0]) => { const r = pickWaitingStatus(x); return r ? `${r.key}${r.docType ? ':' + r.docType : ''}` : null; };
console.log('\n── 대기 판정 ──');
eq('이미지 + 알약', pick({ text: '이거 무슨 약이야', attachments: IMG }), 'identifyingPill');
eq('🔴 이미지 + "정리해줘" 는 약품 식별 아님', pick({ text: '이 표 정리해줘', attachments: IMG }), 'analyzingImage');
eq('업로드 영상', pick({ text: '요약', attachments: att('a.mp4', 'video/mp4') }), 'analyzingVideo');
eq('YouTube URL — 업로드 영상과 같은 문구', pick({ text: '', attachments: [], youtube: true }), 'analyzingVideo');
eq('오디오', pick({ text: '', attachments: att('a.mp3', 'audio/mpeg') }), 'analyzingAudio');
eq('arXiv', pick({ text: '', attachments: att('arxiv.pdf', 'application/pdf'), arxiv: true }), 'analyzingPaper');
for (const [f, m, t] of [
    ['r.pdf', 'application/pdf', 'PDF'],
    ['r.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'DOCX'],
    ['r.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX'],
    ['r.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PPTX'],
    ['r.hwpx', 'application/octet-stream', 'HWPX'],
    ['r.hwp', 'application/x-hwp', 'HWP'],
    ['r.csv', 'text/csv', 'CSV'],
] as const) eq(`문서 형식  ${f}`, pick({ text: '', attachments: att(f, m) }), `analyzingDoc:${t}`);
eq('PDF URL(document.pdf)', pick({ text: '', attachments: att('document.pdf', 'application/pdf') }), 'analyzingDoc:PDF');
eq('형식 섞임 → 그냥 "문서"', pick({ text: '', attachments: [...att('a.pdf', 'application/pdf'), ...att('b.xlsx')] }), 'analyzingDoc');
eq('일반 URL 가져온 뒤', pick({ text: '', attachments: [], urlFetched: true }), 'analyzingWebpage');
eq('일반 질문 — 문구 없음(Orb 만)', pick({ text: '안녕', attachments: [] }), null);

console.log('\n── 문구 원칙 (4개 언어) ──');
const hookSrc = fs.readFileSync('src/hooks/useChatStream.ts', 'utf8');
const block = hookSrc.slice(hookSrc.indexOf('const STATUS'), hookSrc.indexOf('const waitingText'));
for (const lang of ['ko', 'en', 'es', 'fr']) {
    const sec = block.slice(block.indexOf(`  ${lang}: {`)).split('\n  },')[0];
    for (const key of ['uploading', 'retrying', 'fetchingUrl', 'identifyingPill', 'analyzingVideo', 'analyzingAudio', 'analyzingPaper', 'analyzingDoc', 'analyzingDocGeneric', 'analyzingImage', 'analyzingAttachment', 'analyzingWebpage']) {
        check(`${lang}.${key} 있음`, new RegExp(`\\b${key}: `).test(sec));
    }
    check(`${lang} analyzingDoc 에 {type}`, /analyzingDoc: '[^']*\{type\}/.test(sec) || /analyzingDoc: "[^"]*\{type\}/.test(sec));
}
check('대기 문구에 "..."·괄호·초·Gemini 없음', !/(identifyingPill|analyzing\w+|uploading|retrying|fetchingUrl): ['"][^'"\n]*(\.\.\.|\(|초|\bs\)|Gemini)/.test(block));
check('ko 는 "중입니다" 로 통일', [...block.slice(block.indexOf('  ko: {'), block.indexOf('  en: {')).matchAll(/(?:uploading|retrying|fetchingUrl|identifyingPill|analyzing\w+): '([^']+)'/g)].every(m => m[1].endsWith('중입니다')));
check('shimmer 적용 + reduced-motion 정지', fs.readFileSync('components/ChatArea.tsx', 'utf8').includes('status-shimmer')
    && /prefers-reduced-motion: reduce\)\s*\{\s*\.status-shimmer/.test(fs.readFileSync('app/globals.css', 'utf8')));

console.log('\n── 훅 배선 ──');
const hook = fs.readFileSync('src/hooks/useChatStream.ts', 'utf8');
check('arXiv 분기가 문구를 즉시 지우지 않는다', !/analyzingPaper\);\s*\n[^\n]*\n[^\n]*\n\s*setLoadingStatus\(null\)/.test(hook));
check('YouTube 3초 타이머 제거', !hook.includes('setTimeout(() => setLoadingStatus(null), 3000)'));
check('URL 처리 뒤 pickWaitingStatus 로 한 번 정한다', hook.indexOf('pickWaitingStatus({') > hook.indexOf('[URL_FETCH_FAILED'));
check('첫 조각에서 문구를 내린다', hook.includes('if (!modelResponse && chunk) setLoadingStatus(null);'));
check('하드코딩 한국어 문구 없음(업로드·재시도)', hook.includes('setLoadingStatus(status.uploading)') && hook.includes('setLoadingStatus(status.retrying)'));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
