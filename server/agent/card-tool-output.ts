export type FastPassCardType = 'pharmacy' | 'hospital' | 'vet' | 'law' | 'movie' | 'weather' | 'paper';

const INTERNAL_DIRECTIVE_PATTERN = /\[(?:지시사항|SYSTEM|INSTRUCTION|TOOL[_ ]?INSTRUCTION)\]/i;

/** 카드 도구가 사용자에게 전달할 수 있는 유일한 성공/빈 결과 형식. */
export const buildCardToolOutput = (type: FastPassCardType, payload: unknown): string =>
    `\`\`\`json:${type}\n${JSON.stringify(payload)}\n\`\`\``;

export const hasInternalToolDirective = (output: string): boolean =>
    INTERNAL_DIRECTIVE_PATTERN.test(output);

/**
 * fast-pass는 모델 합성 없이 곧바로 사용자 UI로 간다. 따라서 빈 문자열뿐 아니라
 * 내부 제어문과 예상하지 않은 일반 텍스트도 경계에서 거부한다.
 */
export const assertSafeFastPassOutput = (output: string, cardType?: FastPassCardType): void => {
    if (!output.trim()) throw new Error('Local function returned empty output');
    if (hasInternalToolDirective(output)) throw new Error('Local function returned an internal directive');
    if (cardType && !output.includes(`\`\`\`json:${cardType}`)) {
        throw new Error(`Local function returned an invalid ${cardType} card`);
    }
};

const FOLLOWUP_CARD_TYPES = ['pharmacy', 'hospital', 'vet', 'law'] as const;
export type FollowupCardType = typeof FOLLOWUP_CARD_TYPES[number];

/** 변조 가능한 요청 본문에서 온 카드 컨텍스트를 시스템 지시에 넣기 전 정규화한다. */
export const sanitizeCardContexts = (value: unknown): Partial<Record<FollowupCardType, string>> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const safe: Partial<Record<FollowupCardType, string>> = {};
    for (const type of FOLLOWUP_CARD_TYPES) {
        const raw = (value as Record<string, unknown>)[type];
        if (typeof raw !== 'string' || raw.length > 200_000) continue;
        const match = raw.trim().match(new RegExp(`^\`\`\`json:${type}\\s*\\n([\\s\\S]*?)\\n\`\`\`$`));
        if (!match) continue;
        try {
            safe[type] = buildCardToolOutput(type, JSON.parse(match[1]));
        } catch { /* JSON이 아닌 클라이언트 입력은 폐기 */ }
    }
    return safe;
};

/**
 * 카드에 **보여줄 결과가 들어 있는가** — fast-pass 를 켤지 정하는 판정.
 *
 * 🔴 실측(2026-09-01~02). `변호사 수임료는 보통 얼마나 될까?`·`이혼 소송 비용 얼마나 들어?`·
 * `강아지 사료 추천해줘` 에 **카드만 뜨고 산문이 0줄**이었다. fast-pass 가 카드 펜스만 보고
 * 최종 LLM 생성을 통째로 건너뛰기 때문이다(`langchain-path.ts`). 결과가 있을 땐 옳은
 * 최적화지만 **카드가 비어도 똑같이 건너뛴다** — 사용자는 막다른 길을 받는다.
 *
 * ⚖️ 오분류만의 문제가 아니다. 의도가 맞아도 0건(`울릉도 약국`)이거나 백엔드가 죽으면 같은 길이다.
 * 라우터를 아무리 올려도 100% 는 없으므로 **틀렸을 때 복구되는 구조**가 진짜 방어선이다.
 *
 * ⚖️ **모르는 모양이면 `true`** — 현행(fast-pass)을 유지한다. 이 판정이 과하게 false 를 내면
 * 멀쩡한 카드 턴마다 모델 호출이 하나씩 붙어 지연이 늘어난다. 확신할 때만 끈다.
 */
// `noAbstract`·`retracted` 도 센다 — 인용 목록은 비었어도 **보여줄 값이 있는** 칸이다
// (초록 없는 논문의 원문을 여는 것, 철회 사실을 아는 것). 이게 빠지면 그 카드가 통째로 숨는다.
const CARD_LIST_KEYS = ['pharmacies', 'hospitals', 'vets', 'laws', 'articles', 'papers',
    'theaters', 'movies', 'noAbstract', 'retracted'];

export const cardHasResults = (toolContent: string): boolean => {
    const block = toolContent.match(/```json:[a-z]+\s*\n([\s\S]*?)\n```/);
    if (!block) return true;                       // 카드가 아니다 — 판단하지 않는다
    let payload: any;
    try { payload = JSON.parse(block[1]); } catch { return true; }
    if (!payload || typeof payload !== 'object') return true;
    if (payload.error) return false;               // 조회 실패는 알려야 한다
    if (typeof payload.count === 'number') return payload.count > 0;
    const lists = CARD_LIST_KEYS.filter(k => Array.isArray(payload[k]));
    if (lists.length) return lists.some(k => payload[k].length > 0);
    return true;                                   // 날씨처럼 목록이 없는 카드 — 종전대로
};

export const sanitizeActiveCards = (value: unknown): {
    weather?: boolean; paper?: boolean; pharmacy?: boolean; hospital?: boolean; vet?: boolean; law?: boolean; latest?: FollowupCardType;
} => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    const safe: Record<string, boolean | FollowupCardType> = {};
    // `paper` 는 FOLLOWUP_CARD_TYPES 가 아니다(cardContexts 원문을 쓰지 않는다) — 존재 플래그만 받는다
    for (const type of ['weather', 'paper', ...FOLLOWUP_CARD_TYPES] as const) {
        if (typeof input[type] === 'boolean') safe[type] = input[type];
    }
    if (FOLLOWUP_CARD_TYPES.includes(input.latest as FollowupCardType)) safe.latest = input.latest as FollowupCardType;
    return safe;
};

/**
 * 산문 + 카드 합성 intent 에서 **카드만 도구 출력로 고정한다.**
 *
 * 모델에게 카드 JSON 을 통째로 다시 쓰게 했더니 3개 모델 중 1개만 제대로 냈다(실측):
 * gemini-3.7 은 카드를 아예 안 냈고, gpt-5.4-mini 는 JSON 이 깨졌으며, gpt-5.6-luna 만 통과했다.
 * 논문 카드는 5편 × 9필드라 재작성 표면이 넓고, PMID·DOI 가 한 글자만 틀려도 사용자는
 * 엉뚱한 논문으로 간다. 그래서 산문은 모델이 쓰되 **카드는 코드가 붙인다.**
 *
 * 모델이 쓴 같은 종류의 카드 블록은 지운다 — 남겨두면 카드가 두 번 렌더된다.
 */
export const pinCardToProse = (modelText: string, toolOutput: string, type: FastPassCardType): string => {
    const card = toolOutput.trim().match(new RegExp(`\`\`\`json:${type}\\s*\\n[\\s\\S]*?\\n\`\`\``));
    if (!card) return modelText;
    /**
     * 🔴 **결과가 없는 카드는 화면에 붙이지 않는다.** 실측(2026-09-02): `이혼 소송비용` 에
     * "관련 법령을 찾을 수 없습니다" 가 **산문과 카드에 두 번** 나왔다. 빈 카드가 주는 정보는
     * "없다" 하나뿐인데 그건 산문이 이미 말한다 — 같은 말을 두 번 하고 화면만 차지한다.
     *
     * 게다가 그 문구는 사용자가 하지도 않은 요구를 담는다("법령명을 더 구체적으로 입력해 주세요").
     * `이혼 소송비용` 을 물은 사람은 법령을 조회한 적이 없다 — 우리 오분류의 흔적일 뿐이다.
     *
     * ⚖️ 모델 컨텍스트에서는 지우지 않는다. 도구 출력은 그대로 가서 "조회했으나 없었다" 를
     * 알려주고(`buildEmptyCardRules` 가 그걸 읽고 답한다), **화면에만** 안 붙인다.
     */
    if (!cardHasResults(card[0])) {
        return modelText
            .replace(new RegExp(`\`\`\`json\\s*:\\s*${type}\\s*\\n[\\s\\S]*?\\n\`\`\``, 'g'), '')
            .trim();
    }

    const prose = dropDanglingMarkers(modelText
        .replace(new RegExp(`\`\`\`json\\s*:\\s*${type}\\s*\\n[\\s\\S]*?\\n\`\`\``, 'g'), '')
        // 카드를 열었다가 닫지 못한 잘린 블록도 걷어낸다(gpt-5.4-mini 실측 사례)
        .replace(new RegExp(`\`\`\`json\\s*:\\s*${type}[\\s\\S]*$`), '')
        .trim(), card[0], type);

    return prose ? `${prose}\n\n${card[0]}` : card[0];
};

/**
 * 🔴 **붙이는 카드에 없는 번호를 가리키는 마커를 지운다.**
 *
 * 인용 마커 `[n]` 은 "이 메시지에 붙은 카드의 n번째" 라는 뜻이다. 그런데 멀티턴에서는 지난 턴
 * 카드가 히스토리에 그대로 남아 있어 모델이 **그 번호를 가져다 쓴다**(실측 2026-08-31):
 *
 *   > 이전 검색 결과에서 비타민 D에 대해 언급된 논문은 … 논문 **[5]** 입니다
 *
 * 이번 턴 카드가 1건뿐이면 `[5]` 는 아무 데도 가리키지 않는 마커가 된다. 프롬프트에 "마커는
 * 이번 턴 카드만 가리킨다" 를 넣고 재측정했지만 **2회 중 2회 그대로**였다 — 철회 논문·초록
 * 없는 논문에 이어 세 번째다. 확률적으로만 지켜지는 지시는 계약이 아니다.
 * 카드를 코드가 붙이기로 한 그 자리에서(§DEV_260830 §6.6) 계약도 코드가 지킨다.
 *
 * ⚖️ 세 가지는 일부러 하지 않는다.
 *   · **문장은 지우지 않는다.** 이런 문장은 논문을 제목으로도 부르고 있어 마커만 빠지면 뜻이
 *     온전하다. 문장을 지우면 모델이 한 말을 우리가 바꾸는 것이라 더 나쁘다.
 *   · **`[3](url)` 은 건드리지 않는다** — grounding 인용 링크지 카드 마커가 아니다. 지우면 출처가 사라진다.
 *   · **카드를 못 읽으면 손대지 않는다** — 추측으로 사용자에게 갈 글자를 지우지 않는다.
 *
 * ⚠️ 범위 **안**의 잘못된 번호(지난 카드 3번을 뜻하는 `[3]`)는 여기서 못 잡는다. 결정적으로
 * 판정할 방법이 없다. 여기서 없애는 건 **가리킬 곳이 없는 마커**뿐이고, 그게 눈에 보이는 파손이다.
 */
export const dropDanglingMarkers = (prose: string, cardBlock: string, type: FastPassCardType): string => {
    if (type !== 'paper' || !prose) return prose;
    let count: number;
    try {
        const json = cardBlock.match(/```json:paper\s*\n([\s\S]*?)\n```/)?.[1];
        const papers = JSON.parse(json ?? '{}')?.papers;
        if (!Array.isArray(papers)) return prose;
        count = papers.length;
    } catch {
        return prose;
    }

    /**
     * 앞 공백까지 함께 잡는 이유: 실제 산문은 조사를 마커에 **붙여** 쓴다 —
     * "메타 분석 연구 [2]에 따르면"(실측). 마커만 들어내면 "연구 에 따르면" 이 되므로,
     * 마커 뒤가 곧바로 한글이면 앞 공백도 같이 걷어 "연구에 따르면" 을 남긴다.
     * 마커 뒤에 공백이 있으면("논문 [5] 입니다") 앞 공백은 그대로 둔다.
     */
    return dropMarkersOutsideRange(prose, count);
};

/**
 * `[n]` 중 **1..count 밖**을 가리키는 것만 지운다. 문장은 남긴다.
 *
 * 🔴 스트리밍 경로가 이 함수를 직접 쓴다. Gemini 는 산문을 토큰으로 흘려 **사용자에게 먼저
 * 보내므로**, 최종 메시지에 붙는 `pinCardToProse` 로는 이미 늦다(실측: 그 경로에서 `[5]` 가
 * 그대로 화면에 남았다). 카드는 도구 종료 시점(이벤트 #19)에 이미 있고 본문 첫 토큰은
 * 그 뒤(#24)라, route.ts 가 건수를 먼저 잡아 두면 스트림에도 같은 계약을 적용할 수 있다.
 */
export const dropMarkersOutsideRange = (prose: string, count: number): string => {
    if (!prose || !Number.isFinite(count) || count <= 0) return prose;
    return prose
        // 뒤따르는 한글 한 글자까지 함께 잡아, 지울 때 앞 공백을 걷을지 그 자리에서 결정한다.
        // 🔴 전역 규칙(`한글 + 공백 + 조사` → 붙이기)으로 하면 안 된다 — 마커와 무관한
        //   "연구 가치가" 를 "연구가치가" 로 붙여버린다. 손대는 곳은 마커를 지운 자리뿐이다.
        .replace(/([ \t]?)\[(\d+(?:\s*,\s*\d+)*)\](?!\()([가-힣]?)/g,
            (whole, lead: string, group: string, next: string) => {
                const asked = group.split(/\s*,\s*/).map(Number);
                const kept = asked.filter(n => n >= 1 && n <= count);
                if (kept.length === asked.length) return whole;
                if (kept.length) return `${lead}[${kept.join(', ')}]${next}`;
                // 마커 뒤가 곧바로 한글이면 조사다("연구 [2]에") — 앞 공백까지 걷어야 "연구에" 가 된다.
                // 뒤에 공백·문장부호가 오면("논문 [5] 입니다") 앞 공백은 그대로 둔다.
                return next || lead;
            })
        // 마커를 들어낸 자리의 공백 정리 — "효과는 미미했다 [9]." 가 "…했다 ." 로 남으면 안 된다
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([,.;:!?)\]}·])/g, '$1');
};


/** 카드를 산문에 고정하는 의도 — 라우터가 고른 DB 와 무관하게 카드 타입은 `paper` 하나다. */
export const PINNED_CARD_INTENT_SET = new Set(['paper_search', 'arxiv_search']);

/**
 * **스트리밍이 끝난 뒤 아직 사용자에게 못 간 카드 블록**을 돌려준다.
 *
 * 🔴 이 함수가 없던 시절의 버그: Gemini 는 산문을 토큰 단위로 흘려 전송 버퍼를 먼저 채우는데,
 * 카드는 그 뒤 `pinCardToProse` 가 **최종 메시지**에 붙인다. route.ts 는 "스트리밍이 아무것도
 * 안 왔을 때만 최종 메시지를 보낸다" 는 조건이라 **카드가 통째로 버려졌다** — 도구는 호출됐고
 * 모델은 결과를 읽어 산문까지 썼는데 카드만 화면에 도달하지 않았다(gemini-3.7 실측).
 * OpenAI 는 이 경로로 스트리밍하지 않아 우연히 멀쩡했고, 그래서 모델 차이로 오인하기 쉽다.
 *
 * 카드는 도구 출력로 고정된 값이라 산문과 겹치지 않는다 — 이미 보낸 것만 빼고 이어 붙인다.
 * route.ts 와 하니스가 **같은 함수**를 써야 이 회귀를 다시 잡는다.
 */
export const pendingCardBlocks = (msgText: string, delivered: string, intent: string): string[] => {
    if (!msgText || !PINNED_CARD_INTENT_SET.has(intent)) return [];
    const cards = msgText.match(/```json:paper\n[\s\S]*?\n```/g) ?? [];
    // 빈 카드는 화면에 붙이지 않는다 — `pinCardToProse` 와 같은 이유(위 주석)
    return cards.filter(c => !delivered.includes(c) && cardHasResults(c));
};
