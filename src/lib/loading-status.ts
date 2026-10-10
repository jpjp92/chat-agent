/**
 * 응답 대기(Thinking Orb 옆) 문구 선택 — 순수. 검증: `npx tsx tests/test-loading-status.mts`
 *
 * 🔴 예전엔 첨부 문구를 URL 처리 **전에** 정하고, URL 분기가 그 위에 덮어쓰거나 즉시 지웠다
 *   (arXiv: 설정 직후 null · YouTube: 3초 뒤 null · URL: 가져온 뒤 null) → 정작 모델을 기다리는
 *   10~40초 동안 문구가 없었다(DEV_261010 §2-11). 이제 URL 처리 **뒤에 한 번** 정하고
 *   첫 응답 조각에서 내린다(useChatStream).
 *
 * 문구 원칙(10-10, ChatGPT·Claude 참고): 짧은 진행형 한 줄 — "○○을 분석 중입니다".
 * 소요 시간·괄호 설명·모델명 없음. 진행감은 문구가 아니라 shimmer 효과(`.status-shimmer`)로 준다.
 */
export type WaitingStatusKey =
    | 'identifyingPill' | 'analyzingVideo' | 'analyzingAudio' | 'analyzingPaper'
    | 'analyzingDoc' | 'analyzingImage' | 'analyzingAttachment' | 'analyzingWebpage';

export type WaitingStatus = { key: WaitingStatusKey; docType?: string };
export type WaitingAttachment = { mimeType: string; fileName?: string };

/**
 * 알약 식별 의도. 🔴 예전 키워드 목록에 `'정'` 한 글자가 있어 "정리해줘"·"정보"·"일정" 에도 걸렸다 —
 * 표 사진 + "정리해줘" 에 "약품 식별 중..." 이 떴다. 제품명 접미사 `…정`(타이레놀정)만 남긴다.
 */
export const hasPillIntent = (text: string): boolean =>
    /알약|약품|캡슐|무슨\s*약|어떤\s*약|식별|명칭/.test(text)
    || /[가-힣]{2,}정(?=$|\s|[은는이가을를의도,.?!])/.test(text)
    || /(?:^|\s)약(?:$|\s|이|을|은|에|과|도|는)/.test(text);

/** 문서 형식 표기 — 확장자 우선, 없으면 MIME. 앱이 받는 문서 형식만(ChatInput). */
const DOC_TYPES: [RegExp, RegExp, string][] = [
    [/\.pdf$/i, /application\/pdf/, 'PDF'],
    [/\.docx$/i, /wordprocessingml/, 'DOCX'],
    [/\.xlsx$/i, /spreadsheetml/, 'XLSX'],
    [/\.pptx$/i, /presentationml/, 'PPTX'],
    [/\.hwpx$/i, /hwpx|hwp\+zip/, 'HWPX'],
    [/\.(hwp|hwp3|hwpml)$/i, /haansofthwp|x-hwp/, 'HWP'],
    [/\.csv$/i, /text\/csv/, 'CSV'],
    [/\.md$/i, /text\/markdown/, 'MD'],
    [/\.txt$/i, /text\/plain/, 'TXT'],
];
export const docTypeOf = (a: WaitingAttachment): string | null => {
    for (const [ext, mime, label] of DOC_TYPES) if ((a.fileName && ext.test(a.fileName)) || mime.test(a.mimeType)) return label;
    return null;
};

export const pickWaitingStatus = (input: {
    text: string;
    attachments: WaitingAttachment[];
    youtube?: boolean;
    arxiv?: boolean;
    urlFetched?: boolean;
}): WaitingStatus | null => {
    const atts = input.attachments;
    const hasImage = atts.some(a => a.mimeType.startsWith('image/'));
    if (hasImage && hasPillIntent(input.text)) return { key: 'identifyingPill' };
    if (input.youtube || atts.some(a => a.mimeType.startsWith('video/'))) return { key: 'analyzingVideo' };
    if (atts.some(a => a.mimeType.startsWith('audio/'))) return { key: 'analyzingAudio' };
    if (input.arxiv) return { key: 'analyzingPaper' };
    const docTypes = [...new Set(atts.map(docTypeOf).filter((t): t is string => !!t))];
    // 형식이 하나면 표기("XLSX 문서를…"), 여러 형식이 섞이면 그냥 "문서를…"
    if (docTypes.length > 0) return docTypes.length === 1 ? { key: 'analyzingDoc', docType: docTypes[0] } : { key: 'analyzingDoc' };
    if (hasImage) return { key: 'analyzingImage' };
    if (atts.length > 0) return { key: 'analyzingAttachment' };
    if (input.urlFetched) return { key: 'analyzingWebpage' };
    return null;
};
