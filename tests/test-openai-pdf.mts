/**
 * GPT PDF 직접 처리 하니스 — `npx tsx tests/test-openai-pdf.mts`
 * DEV_261011 §1: GPT 선택 + PDF 가 조용히 2.5 로 전환되던 것 → Responses `input_file` 로 직접.
 */
import fs from 'node:fs';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { toOpenAIFilePart, hasOpenAIUnsupportedMedia, hasOpenAIPdf, isOpenAIFileFetchError } from '../server/openai/media.js';
import { buildOpenAIChatRequest } from '../server/openai/chat.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};

const STORAGE = 'https://x.supabase.co/storage/v1/object/public/chat-docs/u/a.pdf';
const pdfUrl = { fileData: { fileUri: STORAGE, mimeType: 'application/pdf' } };
const pdfLink = { fileData: { fileUri: 'https://arxiv.org/pdf/1706.03762', mimeType: 'application/pdf' } };
const pdfInline = { type: 'image_url', image_url: { url: 'data:application/pdf;base64,JVBERi0=' } };
const video = { fileData: { fileUri: 'https://x.supabase.co/v.mp4', mimeType: 'video/mp4' } };
const audioInline = { type: 'image_url', image_url: { url: 'data:audio/mpeg;base64,AA==' } };
const youtube = { fileData: { fileUri: 'https://www.youtube.com/watch?v=abc', mimeType: 'video/*' } };
const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } };
const text = (t: string) => ({ type: 'text', text: t });
const human = (...parts: any[]) => new HumanMessage({ content: parts });

console.log('── ① part → input_file ──');
check('업로드 PDF(Storage URL) → file_url', JSON.stringify(toOpenAIFilePart(pdfUrl)) === JSON.stringify({ type: 'input_file', file_url: STORAGE }));
check('PDF 링크(arXiv) → file_url', toOpenAIFilePart(pdfLink)?.file_url === 'https://arxiv.org/pdf/1706.03762');
const inl = toOpenAIFilePart(pdfInline);
check('인라인 PDF → file_data + filename', inl?.file_data === pdfInline.image_url.url && inl?.filename === 'document.pdf' && !inl?.file_url);
check('이미지는 input_file 아님', toOpenAIFilePart(image) === null);
check('영상 fileData 는 input_file 아님', toOpenAIFilePart(video) === null);
check('텍스트는 input_file 아님', toOpenAIFilePart(text('x')) === null);

console.log('\n── ② 핀 판정 — PDF 는 GPT 가 직접, 영상·오디오만 Gemini ──');
check('🔴 PDF(URL) 만 → 핀 안 함', !hasOpenAIUnsupportedMedia([human(text('분석'), pdfUrl)]));
check('🔴 PDF(인라인) 만 → 핀 안 함', !hasOpenAIUnsupportedMedia([human(text('분석'), pdfInline)]));
check('PDF 링크 → 핀 안 함', !hasOpenAIUnsupportedMedia([human(text('요약'), pdfLink)]));
check('이미지 → 핀 안 함', !hasOpenAIUnsupportedMedia([human(image)]));
check('업로드 영상 → 핀', hasOpenAIUnsupportedMedia([human(text('요약'), video)]));
check('인라인 오디오 → 핀', hasOpenAIUnsupportedMedia([human(audioInline)]));
check('PDF + 영상 섞임 → 핀', hasOpenAIUnsupportedMedia([human(pdfUrl), human(video)]));
check('YouTube fileData 는 여기서 안 셈(pinYoutube 몫)', !hasOpenAIUnsupportedMedia([human(text('요약'), youtube)]));
check('텍스트만 → 핀 안 함', !hasOpenAIUnsupportedMedia([new HumanMessage('안녕'), new AIMessage('네')]));
check('hasOpenAIPdf — URL·인라인 감지', hasOpenAIPdf([human(pdfUrl)]) && hasOpenAIPdf([human(pdfInline)]) && !hasOpenAIPdf([human(image)]));

console.log('\n── ③ 요청 본문 ──');
const body = buildOpenAIChatRequest({
    model: 'gpt-6-luna', instructions: '지시', useWebSearch: false, maxOutputTokens: 16384,
    messages: [human(text('분석'), pdfUrl), new AIMessage('요약입니다'), human(text('3장만 자세히'))],
});
const first = body.input?.[0];
check('PDF 턴 user 는 배열(content parts)', Array.isArray(first?.content));
check('PDF 턴에 input_text + input_file', first?.content?.some((p: any) => p.type === 'input_text' && p.text === '분석')
    && first?.content?.some((p: any) => p.type === 'input_file' && p.file_url === STORAGE));
check('assistant 히스토리는 문자열 유지', body.input?.[1]?.content === '요약입니다');
check('텍스트 후속 user 는 문자열 유지', body.input?.[2]?.content === '3장만 자세히');
check('PDF 를 input_image 로 보내지 않는다', !JSON.stringify(body).includes('"input_image"'));
const inlineBody = buildOpenAIChatRequest({
    model: 'gpt-5.4-mini', instructions: '지시', useWebSearch: false, maxOutputTokens: 1024,
    messages: [human(text('요약'), pdfInline)],
});
check('인라인 PDF 는 file_data 로(input_image 아님)', inlineBody.input?.[0]?.content?.some((p: any) => p.type === 'input_file' && p.file_data)
    && !JSON.stringify(inlineBody).includes('"input_image"'));
const imgBody = buildOpenAIChatRequest({
    model: 'gpt-5.4-mini', instructions: '지시', useWebSearch: false, maxOutputTokens: 1024, messages: [human(text('뭐야'), image)],
});
check('이미지는 기존대로 input_image', imgBody.input?.[0]?.content?.some((p: any) => p.type === 'input_image'));

console.log('\n── ④ 링크 다운로드 실패 → 2.5 재시도 판정 ──');
check('400 "Error while downloading file." → 재시도', isOpenAIFileFetchError({ status: 400, message: 'Error while downloading file.' }));
check('400 다른 오류는 재시도 아님', !isOpenAIFileFetchError({ status: 400, message: 'Invalid value for reasoning' }));
check('429 는 재시도 아님(기존 오류 정책)', !isOpenAIFileFetchError({ status: 429, message: 'Rate limit while downloading' }));
check('undefined 안전', !isOpenAIFileFetchError(undefined));

console.log('\n── ⑤ generator 배선 ──');
const gen = fs.readFileSync('server/agent/nodes/generator.ts', 'utf8');
check('핀 판정이 media.ts 의 hasOpenAIUnsupportedMedia 를 쓴다', gen.includes('hasOpenAIUnsupportedMedia(state.messages)'));
check('예전 인라인 PDF 핀 정규식 제거', !gen.includes('application\\/pdf|audio\\/|video\\/'));
check('🔴 Storage URL PDF 가 pinUrlFileData 로 GPT 를 2.5 로 돌리지 않는다', /pinUrlFileData = hasUrlFileData && !selCaps\.urlFileData && !isOpenAIChatModel\(sel\)/.test(gen));
check('다운로드 실패 → 2.5 로 한 번 재시도', gen.includes('isOpenAIFileFetchError(') && /openAIPdfFallback/.test(gen));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
