/**
 * 응답 대기(Thinking Orb 옆) 문구 선택 — 순수. 검증: `npx tsx tests/test-loading-status.mts`
 *
 * 문구는 URL 처리 **뒤에 한 번** 정하고 첫 응답 조각에서 내린다(useChatStream) — URL 처리 전에 정하면
 * URL 분기가 덮어쓰거나 지워, 정작 모델을 기다리는 동안 문구가 없다 → DEV_261010 §2-11
 *
 * 문구 원칙: 짧은 진행형 한 줄 — "○○을 분석 중입니다".
 * 소요 시간·괄호 설명·모델명 없음. 진행감은 문구가 아니라 shimmer 효과(`.status-shimmer`)로 준다.
 */
export type WaitingStatusKey =
    | 'identifyingPill' | 'analyzingVideo' | 'analyzingAudio' | 'analyzingPaper'
    | 'analyzingDoc' | 'analyzingImage' | 'analyzingAttachment' | 'analyzingWebpage';

export type WaitingStatus = { key: WaitingStatusKey; docType?: string };

/**
 * 문구 없는 턴(일반 질문)에서 "답변을 준비 중입니다" 를 띄우기까지의 대기(ms).
 * 그 전에 첫 응답 조각이나 서버 단계 알림(searching·lookup)이 오면 띄우지 않는다(useChatStream).
 * 미리보기: /dev/loading-preview (dev 전용)
 */
export const SLOW_TURN_MS = 2000;
type WaitingAttachment = { mimeType: string; fileName?: string };

/**
 * 알약 식별 의도 — 제품명 접미사 `…정`(타이레놀정)만 본다. `'정'` 한 글자를 키워드로 두면
 * "정리해줘"·"정보"·"일정" 에도 걸린다.
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
const docTypeOf = (a: WaitingAttachment): string | null => {
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
