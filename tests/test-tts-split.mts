/**
 * TTS 분할 하니스 — `npx tsx tests/test-tts-split.mts`
 *
 * 조각 상한이 깨지면 모델이 **조용히 중간을 건너뛴다**(PLAN_TTS_STREAMING_261002 §4-2) —
 * 오류도 없이 짧은 음성이 나오므로 여기서 상한·보존을 고정한다. 네트워크 없음.
 */
import { splitForTts, TTS_CHUNK_MAX, TTS_FIRST_CHUNK_MAX } from '../server/tts/split.js';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed++;
};
const strip = (s: string) => s.replace(/\s+/g, '');

const sentences = [
    '오늘 서울은 아침부터 맑은 하늘이 이어지고 있습니다.',
    '낮 최고 기온은 이십삼 도까지 오를 것으로 예상됩니다!',
    '우산이 필요할까요?',
    '주말에는 전국에 비 소식이 있습니다.',
];
const long = Array.from({ length: 60 }, (_, i) => sentences[i % sentences.length]).join(' ');

const chunks = splitForTts(long);
check('모든 조각 ≤ 상한', chunks.every(c => c.length <= TTS_CHUNK_MAX), `max=${Math.max(...chunks.map(c => c.length))}`);
check('첫 조각은 짧다', chunks[0].length <= Math.max(TTS_FIRST_CHUNK_MAX, sentences[0].length), `len=${chunks[0].length}`);
check('내용 보존(공백 제외)', strip(chunks.join('')) === strip(long));
check('문장 중간에서 자르지 않는다', chunks.every(c => /[.?!]$/.test(c)));

const noPunct = '가'.repeat(1300);
const hard = splitForTts(noPunct);
check('구두점 없는 긴 문장도 상한 안', hard.every(c => c.length <= TTS_CHUNK_MAX), hard.map(c => c.length).join(','));
check('구두점 없는 긴 문장 보존', hard.join('') === noPunct);

const commas = Array.from({ length: 80 }, (_, i) => `항목 ${i}`).join(', ') + '.';
const byComma = splitForTts(commas);
check('쉼표에서 자른다', byComma.slice(0, -1).every(c => c.endsWith(',')), byComma.map(c => c.slice(-3)).join(' | '));

check('빈 입력 → 빈 배열', splitForTts('   \n ').length === 0);
check('짧은 입력 → 한 조각', splitForTts('안녕하세요.').length === 1);
check('끝 구두점 없는 꼬리 보존', strip(splitForTts('첫 문장입니다. 꼬리').join('')) === strip('첫 문장입니다. 꼬리'));

if (failed) { console.error(`\n❌ ${failed}건 실패`); process.exit(1); }
console.log('\n✅ 전부 통과');
