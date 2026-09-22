/** Grounding questions and their scorer — the file a human edits before every live run.
 *
 * Scoring is `expectAny`: a list of ALTERNATIVE answer spellings, each of which is a list of
 * parts that must ALL appear. Correct = any one alternative fully matches.
 *
 *     expectAny: [ ['모로코','포르투갈','스페인'],      ← all three, in Korean
 *                  ['MOROCCO','PORTUGAL','SPAIN'] ]    ← or all three, in English
 *
 * The alternatives exist so a right answer is never marked wrong for its language or
 * romanization. They must never be widened into "any one of these words", which would let a
 * partial or wrong answer pass — this probe exists to catch grounded-but-wrong answers.
 *
 * Questions must name their date or subject outright. "가장 최근 거래일" changes meaning between
 * the morning and the afternoon of the same day, which would make the fixture wrong rather
 * than the model. `test-tc-grounding.mts` enforces that.
 */

/** Date a human verified every expectation below against a primary source. */
export const CONFIRMED_ON: string | null = '2026-09-22';

export type Question = { id: string; q: string; expectAny: string[][] };

/** Verified 2026-09-22 against: 대통령실, 국무조정실, whitehouse.gov, un.org, 연합뉴스, fifa.com.
 *  KOSPI is pinned to the 2026-09-21 close (the last completed session at confirmation time). */
export const questions: Question[] = [
    { id: 'kr-president', q: '2026년 9월 현재 대한민국 대통령은 누구야?',
        expectAny: [['이재명'], ['LEE JAE MYUNG']] },
    { id: 'kr-pm', q: '2026년 9월 현재 대한민국 국무총리는 누구야?',
        expectAny: [['한성숙'], ['HAN SEONG SOOK']] },
    { id: 'us-president', q: '2026년 9월 현재 미국 대통령은 누구야?',
        expectAny: [['트럼프'], ['TRUMP']] },
    { id: 'un-sg', q: '2026년 9월 현재 유엔 사무총장은 누구야?',
        expectAny: [['구테흐스'], ['구테레스'], ['GUTERRES']] },
    { id: 'kospi-0921', q: '2026년 9월 21일 코스피 종가는 얼마야? 숫자로 알려줘.',
        expectAny: [['7007.72']] },
    // FIFA separates the 2030 tournament hosts from the three centenary matches
    // (Argentina/Paraguay/Uruguay). The question asks for the former, so naming only the
    // latter must score as wrong.
    { id: 'worldcup-host', q: '2030 FIFA 월드컵의 본대회 개최국 3개국은 어디야?',
        expectAny: [['모로코', '포르투갈', '스페인'], ['MOROCCO', 'PORTUGAL', 'SPAIN']] },
];

/** Spacing, thousands separators, hyphens and accents are spelling noise. Digits and the
 *  decimal point are not — 7007.72, 70077.2 and 7007 must stay distinguishable. */
const normalize = (value: string) => value.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')            // drop combining accents: António → Antonio
    .replace(/[\s,\-–—·]/g, '')
    .toUpperCase();

export function isCorrect(question: Question, text: string): boolean {
    const haystack = normalize(text);
    return question.expectAny.some(group => group.every(part => haystack.includes(normalize(part))));
}

/** Every question must be fully scorable before the probe is allowed to spend requests. */
export const unscored = (list: Question[] = questions) => list
    .filter(x => !x.expectAny?.length
        || x.expectAny.some(g => !Array.isArray(g) || !g.length || g.some(s => !s.trim())))
    .map(x => x.id);
