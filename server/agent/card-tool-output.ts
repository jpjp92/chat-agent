export type FastPassCardType = 'pharmacy' | 'hospital' | 'vet' | 'law' | 'movie' | 'weather';

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

export const sanitizeActiveCards = (value: unknown): {
    weather?: boolean; pharmacy?: boolean; hospital?: boolean; vet?: boolean; law?: boolean; latest?: FollowupCardType;
} => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    const safe: Record<string, boolean | FollowupCardType> = {};
    for (const type of ['weather', ...FOLLOWUP_CARD_TYPES] as const) {
        if (typeof input[type] === 'boolean') safe[type] = input[type];
    }
    if (FOLLOWUP_CARD_TYPES.includes(input.latest as FollowupCardType)) safe.latest = input.latest as FollowupCardType;
    return safe;
};
