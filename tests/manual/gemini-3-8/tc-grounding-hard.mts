/** Hard grounding questions — PLAN_GEMINI_PAID_FIRST_261004 §7. The file a human edits before every live run.
 *
 * tc-grounding.mts (09-22) could not separate the models: 3.8 answered 3 of 6 WITHOUT searching,
 * so those questions never tested grounding. Every question here must satisfy one rule:
 *
 *     **It is wrong with search off.**  grounding-quality.mts runs a search-off control arm and
 *     flags any question the model answers correctly from memory as `notDiscriminative`.
 *
 * Two kinds:
 *   fact  — one confirmed fact. Scored with `expectAny` (same semantics as tc-grounding.mts:
 *           alternatives are spellings, never "any one of these words").
 *   synth — the answer must COMBINE several retrieved facts. Each `keyPoints` entry is its own
 *           expectAny; the score is how many points the answer covers. This is the "retrieve →
 *           re-organize" axis — a model that searches but answers from one snippet covers 1 of N.
 *
 * Expectations are time-sensitive and NOT shipped filled in. Verify each against a primary source
 * (official site / exchange / league), write the answer, set CONFIRMED_ON, then run with
 * --confirm-expectations. Questions name their date outright (test-tc-grounding.mts rule).
 */

export const CONFIRMED_ON: string | null = '2026-10-04';

export type Expect = string[][];
export type Question =
    | { id: string; kind: 'fact'; q: string; expectAny: Expect; source?: string }
    | { id: string; kind: 'synth'; q: string; keyPoints: { label: string; expectAny: Expect }[]; source?: string };

/** Confirmed 2026-10-04 by the user against bok.or.kr · federalreserve.gov · krx.co.kr · koreabaseball.com.
 *  KBO questions are pinned to the 10-03 standings because the regular season is not over —
 *  "정규시즌 1위" would change meaning the day it ends. */
export const questions: Question[] = [
    // ── fact ──────────────────────────────────────────────────────────────────────────
    // 2026-08-27 인상 2.75 → 3.00. 웹에 "3.75% 동결" 오답이 돌아다닌다 — citedWrong 를 잡기 좋은 문항
    { id: 'bok-rate-2608', kind: 'fact', source: 'bok.or.kr 기준금리 추이',
        q: '2026년 8월 한국은행 금융통화위원회 기준금리 결정 후 기준금리는 몇 퍼센트야?',
        expectAny: [['3.00%'], ['3.0%'], ['연3%'], ['3퍼센트']] },
    { id: 'kospi-1002', kind: 'fact', source: 'krx.co.kr',
        q: '2026년 10월 2일 코스피 종가는 얼마야? 숫자로 알려줘.', expectAny: [['7003.74']] },
    { id: 'kbo-1003-first', kind: 'fact', source: 'koreabaseball.com 일자별 순위',
        q: '2026년 10월 3일 경기 종료 기준 KBO 리그 순위 1위 팀은 어디야?', expectAny: [['KT'], ['케이티']] },
    // 2026-09-16 FOMC 25bp 인상, 9/17 적용
    { id: 'fomc-2609', kind: 'fact', source: 'federalreserve.gov',
        q: '2026년 9월 FOMC 회의 후 미국 연방기금금리 목표 범위는 얼마야?', expectAny: [['3.75', '4.00'], ['3.75', '4%']] },

    // ── synth ─────────────────────────────────────────────────────────────────────────
    { id: 'rate-compare-2609', kind: 'synth', source: 'bok.or.kr · federalreserve.gov',
        q: '2026년 9월 말 기준 한국 기준금리와 미국 연방기금금리 목표 범위를 각각 알려주고, 미국 목표 범위의 하단과 상단 각각을 기준으로 두 나라 금리 차이가 몇 %p 인지 계산해줘.',
        keyPoints: [
            { label: '한국 3.00%', expectAny: [['3.00%'], ['3.0%'], ['연3%']] },
            { label: '미국 3.75~4.00%', expectAny: [['3.75', '4.00'], ['3.75', '4%']] },
            { label: '차이 0.75 · 1.00%p', expectAny: [['0.75', '1.00'], ['0.75', '1%P'], ['0.75', '1.0%P']] },
        ] },
    // ⚖️ keyPoints 는 팀 포함만 본다 — 순서는 채점하지 않는다(답 형식이 표·목록·문장으로 갈려 위치 매칭이 불안정)
    { id: 'kbo-top5-1003', kind: 'synth', source: 'koreabaseball.com 일자별 순위',
        q: '2026년 10월 3일 경기 종료 기준 KBO 리그 1위부터 5위까지 팀을 순서대로 알려줘.',
        keyPoints: [
            { label: '1위 KT', expectAny: [['KT'], ['케이티']] },
            { label: '2위 삼성', expectAny: [['삼성']] },
            { label: '3위 LG', expectAny: [['LG'], ['엘지']] },
            { label: '4위 KIA', expectAny: [['KIA'], ['기아']] },
            { label: '5위 두산', expectAny: [['두산']] },
        ] },
    // 9/24~26 추석 휴장 → 직전 주 마지막 거래일은 9/23. 원래 "9/28 시가" 는 시가 데이터가 검색에 잘 안 잡혀 종가 대 종가로 바꿨다
    { id: 'kospi-0923-1002', kind: 'synth', source: 'krx.co.kr',
        q: '2026년 9월 23일 코스피 종가와 10월 2일 코스피 종가를 알려주고, 그 사이 몇 포인트, 몇 퍼센트 변했는지 계산해줘.',
        keyPoints: [
            { label: '9/23 종가 7,080.92', expectAny: [['7080.92']] },
            { label: '10/2 종가 7,003.74', expectAny: [['7003.74']] },
            { label: '−77.18p', expectAny: [['77.18']] },
            { label: '약 −1.09%', expectAny: [['1.09%'], ['1.1%']] },
        ] },
];

/** Same normalization as tc-grounding.mts — digits and the decimal point stay significant. */
const normalize = (value: string) => value.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s,\-–—·]/g, '')
    .toUpperCase();

const matches = (expect: Expect, text: string) => {
    const haystack = normalize(text);
    return expect.some(group => group.every(part => haystack.includes(normalize(part))));
};

/** fact → 0|1, synth → covered/total. `correct` means every point covered. */
export function score(question: Question, text: string): { covered: number; total: number; correct: boolean } {
    if (question.kind === 'fact') {
        const ok = matches(question.expectAny, text);
        return { covered: ok ? 1 : 0, total: 1, correct: ok };
    }
    const covered = question.keyPoints.filter(p => matches(p.expectAny, text)).length;
    return { covered, total: question.keyPoints.length, correct: covered === question.keyPoints.length };
}

const emptyExpect = (e: Expect | undefined) => !e?.length || e.some(g => !Array.isArray(g) || !g.length || g.some(s => !s.trim()));

/** Every question must be fully scorable before the probe is allowed to spend requests. */
export const unscored = (list: Question[] = questions) => list
    .filter(x => x.kind === 'fact' ? emptyExpect(x.expectAny) : !x.keyPoints.length || x.keyPoints.some(p => emptyExpect(p.expectAny)))
    .map(x => x.id);
