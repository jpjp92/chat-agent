/**
 * Gemini 인용 마커 하니스 — `npx tsx tests/test-gemini-citations.mts`
 *
 * 프로덕션을 **임포트**한다(로직 복사 금지).
 *
 * 🔴 왜 있는가 (2026-08-29, 세션 6bd6817b 실측):
 *   검색 답변 본문에 `[N](redirect)` 마커를 심기 시작한 뒤, **후속 턴**에서 화면에 생 URL 이
 *   그대로 노출됐다. DB 원문은 `[1](A)(A)[2](B)(B)` — 마커 뒤에 맨 괄호 URL 이 하나 더 붙어
 *   있었고, 그 맨 괄호가 마크다운 자동링크로 보라색 URL 이 됐다.
 *
 *   경로: 마커가 박힌 답변이 DB→history 로 **그대로** 모델에 되돌아간다 → 모델이 그 포맷을
 *   흉내 내 자기 검색 결과 URL 을 맨 괄호로 쓴다 → groundingSupports 의 segment 경계가 그
 *   괄호들 사이에서 끊기므로 서버 마커가 각 괄호 **앞에** 꽂힌다.
 *   (첫 턴 중복 0 / 후속 턴 마커 14개 전부 중복 — 8월 전체로도 첫 턴 11건 중 0건)
 *
 *   그래서 감시 대상은 셋이다:
 *     ① history 에 마커가 실려 나가지 않는다        (근본 원인)
 *     ② 본문의 맨 redirect URL 은 화면에 안 남는다  (안전망)
 *     ③ 바이트 오프셋 삽입이 한글에서 안 깨진다     (기존 계약 회귀 방지)
 */

import fs from 'node:fs';
import { applyGeminiCitations, stripFabricatedCitations, stripBareGroundingUrls } from '../server/agent/gemini-citations.js';
import { buildHistoryMessages, stripCitationLinksForHistory } from '../server/agent/history.js';

let pass = 0, fail = 0;
const check = (group: string, name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${group}  ${name}`); }
    else { fail++; console.log(`❌ ${group}  ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect';
const A = `${REDIRECT}/AUZIYQESsMnWqNDT9wjfD8T-FeNXi9ac0c9pz0uTFDw_K_bH4MFJ`;
const B = `${REDIRECT}/AUZIYQEbnMWM8w-2baCqWn3YtEMdWGNQCU0v4uAcvwbQGsP6LytX=`;
const C = `${REDIRECT}/AUZIYQGW7Rzra9DyhMHnIXo45MKmVssXtdWXvBag_V6qoYflsmTB`;

const utf8 = (s: string) => Buffer.byteLength(s, 'utf8');
const chunksOf = (...uris: string[]) => uris.map((uri, i) => ({ web: { uri, title: `src${i + 1}.example` } }));

// ── 1. 재현 — 모델이 맨 괄호 URL 을 써 넣은 후속 턴 응답 ────────────────────────
// 실측 원문 모양: 문장 끝에 모델이 `(A)(B)` 를 직접 쓰고, supports 의 segment 가 그 사이에서 끊긴다.
{
    const head = '사이버 전쟁은 정보 작전(IO)을 의미합니다.';
    const rawText = `${head}(${A})(${B}) 이는 데이터를 파괴하는 행동을 포함합니다.`;
    const gm = {
        groundingChunks: chunksOf(A, B),
        groundingSupports: [
            // segment① : 문장 끝(모델이 쓴 `(A)` 앞) → chunk A
            { segment: { endIndex: utf8(head) }, groundingChunkIndices: [0] },
            // segment② : `(A)` 뒤(= `(B)` 앞) → chunk B
            { segment: { endIndex: utf8(`${head}(${A})`) }, groundingChunkIndices: [1] },
        ],
    };
    const out = applyGeminiCitations(rawText, gm);

    check('1. 후속턴 재현', '마커 뒤 중복 괄호 URL 이 남지 않는다',
        !/\)\(https/.test(out.text), out.text);
    check('1. 후속턴 재현', '본문에 노출된 생 redirect URL 이 없다',
        out.text.split(REDIRECT).length - 1 === out.text.split('](' + REDIRECT).length - 1, out.text);
    check('1. 후속턴 재현', '마커는 정상적으로 남는다',
        out.text.includes(`[1](${A})`) && out.text.includes(`[2](${B})`), out.text);
    check('1. 후속턴 재현', '문장 텍스트가 보존된다',
        out.text.startsWith(head) && out.text.includes('데이터를 파괴하는 행동'), out.text);
    check('1. 후속턴 재현', '출처는 번호가 붙어 2건',
        out.sources.length === 2 && out.sources.every(s => s.citationNumber), JSON.stringify(out.sources));
}

// ── 2. 정상 턴(모델이 URL 을 안 쓴 경우) 회귀 방지 ─────────────────────────────
{
    const rawText = '첫 문장입니다. 둘째 문장입니다.';
    const gm = {
        groundingChunks: chunksOf(A, B),
        groundingSupports: [
            { segment: { endIndex: utf8('첫 문장입니다.') }, groundingChunkIndices: [0] },
            { segment: { endIndex: utf8(rawText) }, groundingChunkIndices: [1] },
        ],
    };
    const out = applyGeminiCitations(rawText, gm);
    check('2. 정상 턴', '한글 바이트 오프셋 자리에 마커가 들어간다',
        out.text === `첫 문장입니다.[1](${A}) 둘째 문장입니다.[2](${B})`, out.text);
    check('2. 정상 턴', '문장 중간이 깨지지 않는다',
        out.text.includes('첫 문장입니다.') && out.text.includes('둘째 문장입니다.'), out.text);
}

// ── 3. supports 가 없을 때도 맨 URL 은 지운다 ─────────────────────────────────
{
    const out = applyGeminiCitations(`설명입니다.(${A})`, { groundingChunks: chunksOf(A) });
    check('3. supports 없음', '번호 없는 출처만 돌려준다',
        out.sources.length === 1 && out.sources[0].citationNumber === undefined, JSON.stringify(out.sources));
    check('3. supports 없음', '본문의 맨 redirect URL 은 제거된다',
        out.text === '설명입니다.', JSON.stringify(out.text));
}

// ── 4. strip 유틸 단위 규칙 ──────────────────────────────────────────────────
check('4. strip', '가짜 `[1]` 은 지우고 실제 링크 `[1](url)` 은 남긴다',
    stripFabricatedCitations(`가[1] 나[2](${A})`) === `가 나[2](${A})`,
    stripFabricatedCitations(`가[1] 나[2](${A})`));
check('4. strip', '마커 목적지 URL 은 건드리지 않는다',
    stripBareGroundingUrls(`나[2](${A})`) === `나[2](${A})`);
check('4. strip', '괄호 없이 노출된 redirect URL 도 지운다',
    stripBareGroundingUrls(`설명 ${A} 끝`) === '설명 끝',
    stripBareGroundingUrls(`설명 ${A} 끝`));
check('4. strip', 'grounding redirect 가 아닌 일반 URL 은 살린다',
    stripBareGroundingUrls('출처는 https://example.com/news 입니다') === '출처는 https://example.com/news 입니다');

// ── 5. 🔴 근본 원인 — history 에 마커가 실려 나가면 안 된다 ────────────────────
{
    const prev = `정책은 사이버 전쟁입니다.[1](${A})[2](${B}) 이는 공격 행위입니다.[3](${C})`;
    const msgs = buildHistoryMessages([
        { role: 'user', content: '미국 정부 해킹 허용 정책 확인해줘' },
        { role: 'model', content: prev },
        { role: 'user', content: '거의 사이버전쟁이네' },
    ]);
    const aiText = String((msgs[1] as any).content);

    check('5. history', '모델에 가는 히스토리에 redirect URL 이 없다',
        !aiText.includes('vertexaisearch'), aiText);
    check('5. history', '인용 번호 대괄호도 남지 않는다',
        !/\[\d+\]/.test(aiText), aiText);
    check('5. history', '답변 문장 자체는 온전하다',
        aiText === '정책은 사이버 전쟁입니다. 이는 공격 행위입니다.', JSON.stringify(aiText));
    check('5. history', '사용자 메시지는 손대지 않는다',
        String((msgs[2] as any).content?.[0]?.text ?? (msgs[2] as any).content) === '거의 사이버전쟁이네');
}
check('5. history', 'YouTube 타임스탬프 링크는 보존한다',
    stripCitationLinksForHistory('[[01:23](https://youtu.be/x&t=83)] 장면')
    === '[[01:23](https://youtu.be/x&t=83)] 장면',
    stripCitationLinksForHistory('[[01:23](https://youtu.be/x&t=83)] 장면'));
check('5. history', '숫자가 아닌 라벨 링크는 보존한다',
    stripCitationLinksForHistory(`[약품정보](https://nedrug.mfds.go.kr/x)`) === `[약품정보](https://nedrug.mfds.go.kr/x)`);

// ── 6. 스트리밍 청크 경계 — route.ts 의 보류/제거 규칙 ─────────────────────────
// 라우트 모듈은 tsx 로 임포트할 수 없으므로 **소스에서 정규식을 뽑아** 돌린다.
// (규칙을 여기 복사해 두면 route.ts 가 되돌아가도 테스트는 계속 통과해 버린다)
{
    const routeSrc = fs.readFileSync(new URL('../app/api/chat/route.ts', import.meta.url), 'utf8');
    const pick = (label: string, re: RegExp) => {
        const m = routeSrc.match(re);
        check('6. 스트리밍', `route.ts 에서 ${label} 규칙을 찾는다`, !!m);
        return m ? new RegExp(m[1], m[2] ?? '') : /$^/;
    };
    const incompletecitation = pick('보류(incompletecitation)', /const incompletecitation = \/(.+?)\/;/);
    const fabricatedRe = pick('가짜 번호 제거', /const stripFabricated = \(t: string\) => t\.replace\(\/(.+?)\/(g\w*),/);
    const stripFabricated = (t: string) => t.replace(fabricatedRe, '');
    const run = (chunks: string[]) => {
        let buf = '', out = '';
        for (const c of chunks) {
            let s = buf + c; buf = '';
            const m = s.match(incompletecitation);
            if (m) { buf = m[0]; s = s.slice(0, -buf.length); }
            out += stripFabricated(s);
        }
        return out + stripFabricated(buf);
    };
    check('6. 스트리밍', '청크 경계에서 쪼개진 실제 링크가 살아남는다',
        run([`문장입니다.[1]`, `(${A}) 다음`]) === `문장입니다.[1](${A}) 다음`,
        run([`문장입니다.[1]`, `(${A}) 다음`]));
    check('6. 스트리밍', '한 청크 안의 실제 링크도 보존된다',
        run([`문장입니다.[1](${A}) 다음`]) === `문장입니다.[1](${A}) 다음`,
        run([`문장입니다.[1](${A}) 다음`]));
    check('6. 스트리밍', '가짜 번호는 그대로 제거된다',
        run(['근거가 있습니다[1', '2] 그리고 [3] 끝']) === '근거가 있습니다 그리고 끝',
        run(['근거가 있습니다[1', '2] 그리고 [3] 끝']));
    check('6. 스트리밍', '스트림 끝에 남은 가짜 번호도 제거된다',
        run(['결론입니다[1]']) === '결론입니다', run(['결론입니다[1]']));
}

console.log(`\n${fail === 0 ? '🟢' : '🔴'} pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
