/**
 * TTS 전처리 하니스 — `npx tsx tests/test-tts-speakable.mts`
 *
 * 카드 JSON 이 TTS 로 새면 **한 글자씩 철자로 읽고**, 기호뿐인 조각은 오디오가 안 와 스트림이 끊긴다
 * (2026-10-03 로컬 실사용, 날씨 카드). 실제 답변 모양으로 고정한다. 네트워크 없음.
 */
import { toSpeakableText } from '../lib/tts-speakable.js';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed++;
};

// 실제 세션의 날씨 카드 답변(축약)
const weatherCard = '\n```json:weather\n{"source":"KMA","location":{"name":"성남시"},"daily":[{"date":"2026-09-03","maxTemp":31}]}\n```';
check('카드 JSON 만 있는 답변 → 읽을 것 없음', toSpeakableText(weatherCard) === '', JSON.stringify(toSpeakableText(weatherCard)));

const prose = `네, 맞습니다. 성남의 기온은 점차 떨어질 것으로 보입니다.

*   **오늘(9월 3일)** 최고 기온은 **31°C**이지만,
*   **내일(9월 4일)**은 최고 **30°C**`;
const p = toSpeakableText(prose);
check('강조·글머리표 기호 제거, 글자 보존', !/[*#`]/.test(p) && p.includes('오늘(9월 3일) 최고 기온은 31°C이지만'), p);
check('글머리표 항목마다 문장 경계', p.includes('30°C.') && p.includes('31°C이지만.') && !p.includes(',.'), p);

const mixed = `설명입니다.\n\n\`\`\`python\nprint("hello")\n\`\`\`\n\n다음 문장입니다.`;
check('코드 블록 제거, 앞뒤 문장 유지', toSpeakableText(mixed) === '설명입니다. 다음 문장입니다.', toSpeakableText(mixed));

check('닫히지 않은 펜스(스트리밍 중단)도 제거', toSpeakableText('앞 문장.\n```json:chart\n{"a":1') === '앞 문장.');

const links = '자세한 내용은 [공식 문서](https://example.com/docs)를 보세요 [[1]](https://a.com). 출처: https://b.com/x?y=1';
const l = toSpeakableText(links);
check('링크는 글자만, 인용 번호·URL 제거', !/[\[\]()]|http/.test(l) && l.startsWith('자세한 내용은 공식 문서를 보세요'), l);

const table = '| 도시 | 기온 |\n|---|---|\n| 서울 | 23도 |\n| 부산 | 25도 |';
check('표는 칸을 쉼표로', toSpeakableText(table) === '도시, 기온. 서울, 23도. 부산, 25도.', toSpeakableText(table));

check('수식 제거', !toSpeakableText('넓이는 $\\pi r^2$ 입니다.\n$$\\int x dx$$').includes('\\'), toSpeakableText('넓이는 $\\pi r^2$ 입니다.'));
check('제목 기호 제거', toSpeakableText('## 요약\n본문.') === '요약. 본문.', toSpeakableText('## 요약\n본문.'));
check('인라인 코드는 글자만', toSpeakableText('`npm run dev` 로 실행하세요.') === 'npm run dev 로 실행하세요.');
check('기호뿐인 줄 제거', toSpeakableText('본문.\n---\n123\n') === '본문.', toSpeakableText('본문.\n---\n123\n'));

if (failed) { console.error(`\n❌ ${failed}건 실패`); process.exit(1); }
console.log('\n✅ 전부 통과');
