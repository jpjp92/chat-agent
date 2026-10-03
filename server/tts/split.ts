/**
 * TTS 입력 분할 — 순수 모듈(하니스가 임포트한다).
 *
 * 🔴 왜 나누는가 (2026-10-03, PLAN_TTS_STREAMING_261002 §4-2):
 *   한 번에 ~800자를 넘기면 OpenAI·Gemini **둘 다** 끝은 읽으면서 **중간을 건너뛰거나 반복한다**.
 *   700자 조각도 OpenAI 4회 중 2회 생략(-20%·-11%). 500자 조각은 8/8 정상(±3%).
 *   → 조각 상한 500. 첫 조각은 짧게 해서 첫 소리를 당긴다.
 */

export const TTS_CHUNK_MAX = 500;
export const TTS_FIRST_CHUNK_MAX = 80;

/** 문장 하나가 상한을 넘으면 쉼표 → 공백 순으로 자르고, 그래도 넘으면 글자 수로 자른다. */
function hardSplit(s: string, max: number): string[] {
    if (s.length <= max) return [s];
    const out: string[] = [];
    let rest = s;
    while (rest.length > max) {
        const window = rest.slice(0, max);
        let cut = Math.max(window.lastIndexOf(','), window.lastIndexOf('，'));
        if (cut < max / 2) cut = window.lastIndexOf(' ');
        if (cut < max / 2) cut = max - 1;
        out.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1);
    }
    if (rest.trim()) out.push(rest);
    return out;
}

export function splitForTts(text: string, max = TTS_CHUNK_MAX, firstMax = TTS_FIRST_CHUNK_MAX): string[] {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    // 문장 끝: . ? ! 。 … 와 줄바꿈 유래 공백. 끝 구두점이 없는 꼬리도 한 문장으로 받는다.
    const sentences = (normalized.match(/[^.?!。…]+(?:[.?!。…]+|$)\s*/g) ?? [normalized])
        .flatMap(s => hardSplit(s, max));
    const chunks: string[] = [];
    let cur = '';
    for (const s of sentences) {
        const limit = chunks.length === 0 ? firstMax : max;
        if (cur && cur.length + s.length > limit) {
            chunks.push(cur.trim());
            cur = '';
        }
        cur += s;
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(Boolean);
}
