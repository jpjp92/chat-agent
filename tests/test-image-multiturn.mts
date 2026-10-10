/**
 * 이미지 멀티턴 하니스 — `npx tsx tests/test-image-multiturn.mts`
 *
 * 질문: 이미지를 올린 뒤 2·3·4번째 질문에서 **모델이 그 이미지를 실제로 받는가**, 그리고
 * "이번 턴에 새 이미지가 왔다"를 코드가 구분할 수 있는가(PLAN_SOURCE_SUMMARY_261010 §6-2·§6-3).
 *
 * 실제 경로를 그대로 지난다:
 *   클라 히스토리 → buildHistoryMessages(server/agent/history.ts, mediaWindow 3)
 *   + 현재 메시지(route.ts 와 같은 조립) → buildSdkContents(Gemini) / OpenAI 도 같은 히스토리 사용.
 * 이미지 보존 경로는 이것뿐이다 — `lastActiveDoc` 은 extractedText·PDF 만 잡는다(useChatStream.ts:154).
 */
import { HumanMessage } from '@langchain/core/messages';
import { buildHistoryMessages } from '../server/agent/history.js';
import { buildSdkContents } from '../server/agent/nodes/sdk-contents.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};

const IMG = { fileName: 'chart.png', mimeType: 'image/png', data: 'https://example.supabase.co/storage/v1/object/public/chat-imgs/u/chart.png' };

/** route.ts 의 현재 메시지 조립을 이미지에 한해 재현 */
const currentMessage = (prompt: string, attachments: any[] = []) => {
    const parts: any[] = [{ type: 'text', text: prompt }];
    for (const att of attachments) parts.push({ type: 'image_url', image_url: { url: att.data } });
    return new HumanMessage({ content: parts });
};

type Turn = { prompt: string; attachments?: any[] };
/** n 번째 턴까지의 요청을 만들고 모델 입력을 관측한다 */
const observe = (turns: Turn[]) => {
    const history: any[] = [];
    const rows: { turn: number; imageSentToModel: boolean; newImageThisTurn: boolean; hasMultimodal: boolean; demotedLabel: boolean }[] = [];
    turns.forEach((t, i) => {
        const msgs = buildHistoryMessages(history);
        msgs.push(currentMessage(t.prompt, t.attachments));
        const { sdkContents, hasMultimodalContent } = buildSdkContents(msgs, false);
        const imageParts = sdkContents.flatMap((c: any) => c.parts).filter((p: any) => p.fileData?.mimeType?.startsWith('image/') || p.inlineData);
        const last = sdkContents.at(-1)!;
        rows.push({
            turn: i + 1,
            imageSentToModel: imageParts.length > 0,
            newImageThisTurn: last.parts.some((p: any) => p.fileData || p.inlineData),
            hasMultimodal: hasMultimodalContent,
            demotedLabel: sdkContents.some((c: any) => c.parts.some((p: any) => p.text?.includes('[Attached File:'))),
        });
        history.push({ role: 'user', content: t.prompt, attachments: t.attachments ?? [] });
        history.push({ role: 'model', content: `답변 ${i + 1}` });
    });
    return rows;
};

console.log('── ① 이미지 1장 + 후속 3턴 ──');
const rows = observe([
    { prompt: '이 차트 분석해줘', attachments: [IMG] },
    { prompt: '3월 수치만 알려줘' },
    { prompt: '가장 큰 변화는 언제야?' },
    { prompt: '이거 표로 정리해줘' },
]);
console.table(rows);

check('1턴: 이미지가 모델에 간다', rows[0].imageSentToModel);
check('1턴: "이번 턴 새 이미지" 로 식별된다', rows[0].newImageThisTurn);
check('2턴: 이미지가 히스토리로 다시 간다(후속 질문 가능)', rows[1].imageSentToModel);
check('2턴: 새 이미지가 아니다(현재 메시지엔 없음)', !rows[1].newImageThisTurn);
// 🔴 판정 함정: hasMultimodalContent 는 히스토리 이미지에도 true — "새 자료" 판정에 쓰면 매 턴 한 줄 요약
check('2턴: hasMultimodalContent 는 true — 새 자료 신호로 쓰면 안 된다(관측)', rows[1].hasMultimodal);

// mediaWindow=3 은 **메시지 3개**(사용자+모델 섞임) — 3턴째엔 1턴 사용자 메시지가 창 밖
console.log('\n── ② 창 밖 강등 (관측 — 현재 동작 기록) ──');
const t3 = rows[2], t4 = rows[3];
console.log(`   3턴: 이미지 전송=${t3.imageSentToModel} · 텍스트 라벨 강등=${t3.demotedLabel}`);
console.log(`   4턴: 이미지 전송=${t4.imageSentToModel} · 텍스트 라벨 강등=${t4.demotedLabel}`);
check('3턴: 1턴 이미지가 창 밖으로 강등된다 (현재 동작 — 바뀌면 이 기대를 갱신)', !t3.imageSentToModel && t3.demotedLabel);

console.log('\n── ③ 같은 대화에서 새 이미지 ──');
const rows2 = observe([
    { prompt: '이 차트 분석해줘', attachments: [IMG] },
    { prompt: '3월 수치만 알려줘' },
    { prompt: '이것도 분석해줘', attachments: [{ ...IMG, fileName: 'chart2.png', data: IMG.data.replace('chart.png', 'chart2.png') }] },
]);
check('두 번째 이미지 턴은 다시 "새 이미지"', rows2[2].newImageThisTurn);

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
