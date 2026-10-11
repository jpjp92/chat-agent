/**
 * GPT(OpenAI Responses) 가 직접 받는 첨부 판정 — 순수. 검증: `npx tsx tests/test-openai-pdf.mts`
 *
 * 🔴 예전엔 GPT 선택 + PDF 면 **조용히 Gemini 2.5 로 전환**했다(어댑터가 PDF 를 버렸기 때문).
 *   화면엔 GPT 라벨이 붙은 채 2.5 가 답했고, 2.5 가 표 머리글을 반복하다 끊긴 사례가 나왔다(DEV_261011 §1).
 *   실측(2026-10-11): Responses `input_file` 로 PDF 를 직접 받는다 —
 *     · 업로드(Storage 공개 URL)·PDF 링크·arXiv·doi 리다이렉트 → `file_url` (0.4~11MB 2~13s)
 *     · 1MB 미만 인라인 → `file_data` (data URI 그대로)
 *     · 2.07MB 사업계획서 "분석" 장문 → luna 26s · mini 13s, 4회 모두 completed · 표 정상
 *   영상·오디오는 Responses 가 받지 않는다 → 여전히 Gemini 로 핀(PLAN_MEDIA_ROUTING 2단계).
 */
const PDF_MIME = 'application/pdf';
const DATA_PDF = /^data:application\/pdf[;,]/i;

const isPdfFileData = (p: any): boolean => p?.fileData?.mimeType === PDF_MIME;
const isYoutubeFileData = (p: any): boolean => /youtube\.com|youtu\.be/.test(String(p?.fileData?.fileUri ?? ''));
const isInlinePdf = (p: any): boolean => p?.type === 'image_url' && DATA_PDF.test(String(p?.image_url?.url ?? ''));

/** 히스토리 part → Responses `input_file`. PDF 가 아니면 null. */
export const toOpenAIFilePart = (p: any): Record<string, string> | null => {
    if (isPdfFileData(p) && typeof p.fileData.fileUri === 'string') {
        return { type: 'input_file', file_url: p.fileData.fileUri };
    }
    if (isInlinePdf(p)) return { type: 'input_file', filename: 'document.pdf', file_data: p.image_url.url };
    return null;
};

/**
 * GPT 가 직접 못 받는 미디어가 있나 → 있으면 Gemini 로 핀한다.
 * PDF 는 받는다. YouTube fileData 는 pinYoutube 가 따로 판정하므로 여기선 세지 않는다.
 */
export const hasOpenAIUnsupportedMedia = (messages: any[]): boolean =>
    messages.some((m: any) => Array.isArray(m?.content) && m.content.some((p: any) => {
        if (p?.fileData) return !isPdfFileData(p) && !isYoutubeFileData(p);
        return p?.type === 'image_url' && /^data:(?:audio|video)\//i.test(String(p.image_url?.url ?? ''));
    }));

/** 이번 대화에 GPT 로 보낼 PDF 가 있나 — 실패 시 2.5 재시도 대상 판정용. */
export const hasOpenAIPdf = (messages: any[]): boolean =>
    messages.some((m: any) => Array.isArray(m?.content) && m.content.some((p: any) => isPdfFileData(p) || isInlinePdf(p)));

/**
 * OpenAI 가 PDF 링크를 못 받아 온 실패(실측: 400 "Error while downloading file.").
 * 봇 차단·로그인 필요·만료 링크. 이 턴만 Gemini 2.5 로 다시 시도한다 — 2.5 는 서버 쪽에서 받는 경로가 다르다.
 */
export const isOpenAIFileFetchError = (err: any): boolean =>
    err?.status === 400 && /download|fetch.*file|file.*(url|download)/i.test(String(err?.message ?? ''));
