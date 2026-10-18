/**
 * OpenAI 최종 답 텍스트 보정 — 순수 함수. 검증: `npx tsx tests/test-openai-text-repair.mts`
 *
 * 드물게 나오는 출력 흔들림이라 프롬프트가 아니라 출력 쪽에서 막는다 → DEV_261018 §9
 *   ① 약 카드 JSON 이 ```json:drug 울타리 없이 나오면 카드 대신 원문이 화면에 찍힌다 → 울타리로 감싼다.
 *   ② 인용 표지 `citeturn0search0`(사설 영역 문자)가 남으면 깨진 글자처럼 보인다 →
 *      우리 인용은 annotation 으로 따로 만들므로 이 표지는 버린다.
 */

/** OpenAI 사설 영역 인용 표지와 그 잔재("turn0search0" 류)를 지운다. */
export const stripPrivateCitationMarks = (text: string): string =>
    text
        .replace(/[^]*/g, '')
        .replace(/(?:cite)?(?:?turn\d+(?:search|news|view|fetch|image|product)\d+)+?/g, '')
        .replace(/[-]/g, '');

/** 문자열 안의 중괄호를 무시하고, 맨 앞 `{` 와 짝이 맞는 `}` 의 위치를 찾는다. 없으면 -1. */
const matchingBrace = (s: string, start: number): number => {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return i;
    }
    return -1;
};

/**
 * 답이 울타리 없는 약 카드 JSON 으로 시작하면 ```json:drug 블록으로 감싼다.
 * 약 카드 모양(name + pill_visual 또는 ingredient)일 때만 — 다른 JSON 을 카드로 오인하지 않는다.
 */
export const fenceBareDrugJson = (text: string): string => {
    if (/```json:drug/.test(text)) return text;
    const lead = text.length - text.trimStart().length;
    if (text[lead] !== '{') return text;
    const end = matchingBrace(text, lead);
    if (end < 0) return text;
    let obj: any;
    try { obj = JSON.parse(text.slice(lead, end + 1)); } catch { return text; }
    if (!obj || typeof obj.name !== 'string' || !(obj.pill_visual || obj.ingredient)) return text;
    const rest = text.slice(end + 1).trimStart();
    return '```json:drug\n' + JSON.stringify(obj, null, 2) + '\n```' + (rest ? '\n\n' + rest : '\n');
};

export const repairOpenAIText = (text: string): string => fenceBareDrugJson(stripPrivateCitationMarks(text));
