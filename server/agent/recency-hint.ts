/**
 * 최신 제품·버전 질문의 검색 턴에 "기준 시점" 한 줄을 **모델 입력의 마지막 사용자 메시지에만** 덧붙인다 — 순수.
 * 검증: `npx tsx tests/test-recency-hint.mts` · 계획: docs/plans/PLAN_WEB_SEARCH_QUALITY_261122.md §3 W2
 *
 * Flash 는 최신을 물어도 기억 속 버전 번호로 검색어를 만든다("iPhone 16 battery…") → 옛 세대 글이 걸린다.
 * 시스템 프롬프트 규칙은 짧은 프롬프트에선 10/10 이었지만 운영 프롬프트(1.8만 자) 안에서는 1/3 로 묻혔다 —
 * 맨 앞으로 옮기거나 턴 지시를 붙이거나 생각 수준을 올려도 같았다. 모델은 검색어를 **사용자 메시지**에서
 * 만들기 때문에 거기에 기준 연·월을 둔 쪽만 통했다(같은 조건 갤럭시·픽셀 3/3). 화면·DB 의 메시지는 그대로다.
 */

// 최신 "제품·버전"을 묻는 표현만 — `temporal`(오늘·지금·올해…)은 날씨·시각까지 잡아 넓다.
// 특정 옛 모델을 지정한 질문("아이폰 13 배터리")은 이 표현이 없어 걸리지 않는다.
// `\b` 는 ASCII 기준이라 `último`·`dernière` 의 악센트 글자에서 경계를 못 잡는다 — 유니코드 글자 경계로 쓴다
const LATEST_PRODUCT = /(최신|신형|신제품|요즘\s?나온|최근\s?(출시|나온|발표)|현재\s?(판매|출시)|(?<!\p{L})(latest|newest|current\s+(model|lineup|version|generation)s?|últim[oa]s?|m[aá]s\s+reciente|nuevo\s+modelo|derni[eè]re?s?|plus\s+r[eé]cente?s?|nouveau\s+mod[eè]le)(?!\p{L}))/iu;
// "최근 검색한 거"·"최신 답변 다시" 같은 직전 결과 참조는 새 최신 요구가 아니다
// `최신` 은 넣지 않는다 — 띄어쓰기 없는 "최신정보알려줘" 가 참조로 오인돼 힌트가 빠진다
const PAST_REF = /(최근|방금|아까)\s?\S{0,3}(검색|알려|말한|말씀|보여|찾)|(방금|아까).{0,6}답변/;

export const isLatestProductRequest = (text: string): boolean =>
    LATEST_PRODUCT.test(text) && !PAST_REF.test(text);

type Lang = 'Korean' | 'English' | 'Spanish' | 'French';

/** 사용자 언어로 된 기준 시점 한 줄. 연·월은 사용자 시간대 기준. */
export const buildRecencyHint = (now: Date, tz: string, lang: Lang | string): string => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric' }).formatToParts(now);
    const y = parts.find(p => p.type === 'year')?.value ?? String(now.getUTCFullYear());
    const m = parts.find(p => p.type === 'month')?.value ?? String(now.getUTCMonth() + 1);
    switch (lang) {
        case 'English': return `(As of ${y}-${m.padStart(2, '0')}: the latest lineup currently released and on sale)`;
        case 'Spanish': return `(Referencia: ${m}/${y}, la gama más reciente ya lanzada y a la venta)`;
        case 'French': return `(Référence : ${m}/${y}, la gamme la plus récente déjà sortie et en vente)`;
        default: return `(기준: ${y}년 ${m}월 현재 출시·판매 중인 최신 라인업)`;
    }
};

/** @google/genai `contents` — 마지막 user 턴의 텍스트 뒤에 붙인 새 배열을 돌려준다(원본 불변). */
export const appendHintToSdkContents = <T extends { role?: string; parts?: any[] }>(contents: T[], hint: string): T[] => {
    const i = contents.map(c => c.role).lastIndexOf('user');
    if (i < 0) return contents;
    const last = contents[i];
    return contents.map((c, k) => (k === i ? { ...last, parts: [...(last.parts ?? []), { text: `\n\n${hint}` }] } : c));
};

/**
 * LangChain 메시지 — 마지막 human 메시지만 텍스트를 덧붙인 복제본으로 바꾼 새 배열(원본 불변).
 * `cloneHuman` 은 호출부가 넘긴다(이 모듈이 LangChain 을 끌어오지 않게).
 */
export const appendHintToMessages = <M extends { _getType(): string; content: any }>(
    messages: M[], hint: string, cloneHuman: (content: any) => M,
): M[] => {
    let i = -1;
    for (let k = messages.length - 1; k >= 0; k--) if (messages[k]._getType() === 'human') { i = k; break; }
    if (i < 0) return messages;
    const content = messages[i].content;
    const next = Array.isArray(content)
        ? [...content, { type: 'text', text: `\n\n${hint}` }]
        : `${String(content)}\n\n${hint}`;
    return messages.map((m, k) => (k === i ? cloneHuman(next) : m));
};
