/** Contrast checks for the grounding scorer. The point of expectAny is to avoid punishing a
 * correct answer for its spelling or language, WITHOUT letting a wrong answer through. Each
 * check below proves one of those two halves. No network. */
import assert from 'node:assert/strict';
import { isCorrect, questions, CONFIRMED_ON, type Question } from './tc-grounding.mjs';

const q = (id: string): Question => {
    const found = questions.find(x => x.id === id);
    if (!found) throw new Error(`Unknown question ${id}`);
    return found;
};
let n = 0;
const check = (label: string, actual: unknown, expected: unknown) => { n++; assert.deepEqual(actual, expected, label); };

// --- language and spelling variants of the SAME answer all count as correct ---
const unsg = q('un-sg');
check('ko spelling', isCorrect(unsg, '현 유엔 사무총장은 안토니우 구테흐스입니다.'), true);
check('ko alt spelling', isCorrect(unsg, '현 유엔 사무총장은 안토니오 구테레스입니다.'), true);
check('en only', isCorrect(unsg, 'The Secretary-General is António Guterres.'), true);
check('en no accent', isCorrect(unsg, 'The Secretary-General is Antonio Guterres.'), true);
check('wrong person', isCorrect(unsg, '현 유엔 사무총장은 반기문입니다.'), false);

const krp = q('kr-president');
check('ko name', isCorrect(krp, '대한민국 대통령은 이재명입니다.'), true);
check('romanized hyphen', isCorrect(krp, 'The president is Lee Jae-myung.'), true);
check('romanized spaced', isCorrect(krp, 'The president is Lee Jae Myung.'), true);
check('wrong president', isCorrect(krp, '대한민국 대통령은 윤석열입니다.'), false);

const usp = q('us-president');
check('ko surname', isCorrect(usp, '미국 대통령은 도널드 트럼프입니다.'), true);
check('en full name', isCorrect(usp, 'The president is Donald J. Trump.'), true);
check('wrong president', isCorrect(usp, 'The president is Joe Biden.'), false);

// --- a number must match exactly; thousands separators are noise, digits are not ---
const kospi = q('kospi-0921');
check('with separator', isCorrect(kospi, '2026년 9월 21일 코스피 종가는 7,007.72입니다.'), true);
check('without separator', isCorrect(kospi, '종가는 7007.72 입니다.'), true);
check('different close', isCorrect(kospi, '종가는 6,994.23입니다.'), false);
check('digits shifted', isCorrect(kospi, '종가는 70077.2입니다.'), false);
check('truncated value', isCorrect(kospi, '종가는 7,007입니다.'), false);

// --- a multi-part answer needs EVERY part, in either language, but not a mix-and-match ---
const wc = q('worldcup-host');
check('all three ko', isCorrect(wc, '2030년 본대회는 모로코, 포르투갈, 스페인에서 열립니다.'), true);
check('all three en', isCorrect(wc, 'The hosts are Morocco, Portugal and Spain.'), true);
check('order does not matter', isCorrect(wc, '스페인과 포르투갈, 그리고 모로코입니다.'), true);
check('two of three rejected', isCorrect(wc, '포르투갈과 스페인에서 열립니다.'), false);
// The centenary matches are a different thing; naming only those is not the host answer.
check('centenary hosts rejected', isCorrect(wc, '아르헨티나, 파라과이, 우루과이에서 열립니다.'), false);

// --- fixture integrity: the probe must not be runnable on half-filled expectations ---
check('every question is scorable', questions.every(x =>
    Array.isArray(x.expectAny) && x.expectAny.length > 0
    && x.expectAny.every(g => Array.isArray(g) && g.length > 0 && g.every(s => !!s.trim()))), true);
check('confirmation date recorded', typeof CONFIRMED_ON === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(CONFIRMED_ON!), true);
check('six questions', questions.length, 6);
check('ids unique', new Set(questions.map(x => x.id)).size, questions.length);
// Every question must name its date or subject explicitly — "가장 최근" drifts between runs.
check('no drifting phrasing', questions.every(x => !/가장 최근|오늘|현재 기준/.test(x.q)), true);

console.log(`${n} grounding scorer assertions passed (spelling/language variants accepted, wrong answers rejected).`);
