/**
 * gpt-6-luna vs gpt-5.6-luna — **로컬 도구 11종 계약** 비교 프로브.
 *
 * `compare-luna.mts` 는 연결·capability 스모크였다(멀티턴·function·websearch·image).
 * 여기서 재는 건 다른 것이다 — **우리 제품 경로**가 같은 모양으로 도는가:
 *   ① 모델이 도구를 부르는가        (안 부르면 카드가 아예 안 나온다)
 *   ② 인자를 제대로 채우는가        (`서울 강남구` → sido=서울 … 틀리면 엉뚱한 지역을 조회한다)
 *   ③ 결과를 규약대로 다루는가      (fast-pass 는 **그대로 통과**, synthesize 는 **데이터를 산문에 반영**)
 *
 * 🔴 **도구 정의는 프로덕션에서 import 하고 `execute` 만 스텁으로 갈아끼운다.**
 * 정의를 복사하면 프로덕션 스키마가 바뀐 뒤에도 이 프로브는 계속 초록이다(tests/README §③).
 * 그리고 실행부를 스텁으로 바꾸는 이유는 격리다 — 진짜로 태우면 외부 API 11개(식약처·심평원·
 * 법제처·극장·football-data·PubMed·기상청…)의 **그날 건강 상태**가 모델 비교에 섞인다.
 * 지금 궁금한 변수는 모델 하나다. 두 변수를 함께 움직이면 무엇이 원인인지 말할 수 없다.
 *
 * 판정은 "6-luna 가 잘 한다"가 아니라 **"이미 쓰는 5.6-luna 와 같은가"** 다.
 *
 * 실행: npx tsx --tsconfig tests/tsconfig.probe.json --env-file=.env.local \
 *         tests/manual/openai-6-luna/compare-tools.mts
 * (OPENAI_API_KEY_TIER1 필요 · 실제 비용 발생 · 22회 호출 · `npm test` 제외)
 */
import fs from 'node:fs';
import { HumanMessage } from '@langchain/core/messages';
import { generateOpenAIChat } from '../../../server/openai/chat.js';
import { getLocalFunctionTool, type LocalFunctionTool } from '../../../server/agent/local-tool-registry.js';

if (!process.env.OPENAI_API_KEY_TIER1) {
    console.error('OPENAI_API_KEY_TIER1 이 필요합니다 (--env-file=.env.local).');
    process.exit(1);
}

const MODELS = ['gpt-5.6-luna', 'gpt-6-luna'] as const;
const TIMEOUT_MS = 60_000;
/**
 * 🔴 반복이 **선택이 아니다.** 초판은 셀당 1회였고, `arxiv_search` 에서 gpt-6-luna 만
 * 실패한 것처럼 보였다. 3회씩 돌려 보니 **5.6-luna 가 2/3 으로 더 자주 실패**했다 —
 * 모델 차이가 아니라 그 케이스 자체가 흔들리는 것이었다. 1회 표본으로 모델을 판정하면 안 된다.
 */
const REPS = Number(process.argv[2] ?? 3);

/** fast-pass 스텁 — `cardHasResults` 가 "결과 있음"으로 읽도록 `count` 를 넣는다. */
const card = (type: string) =>
    '```json:' + type + '\n' + JSON.stringify({ count: 1, stub: true }) + '\n```';

type Case = {
    intent: string;
    ask: string;
    /** 인자 판정 — 왜 그 값이어야 하는지가 곧 검사다. */
    args: (a: Record<string, any>) => string | null;
    /** 스텁이 돌려줄 도구 결과 */
    result: string;
    /** 최종 응답 판정 */
    text: (t: string, tool: LocalFunctionTool) => string | null;
};

const passthrough = (type: string) => (t: string) =>
    t.trim() === card(type).trim() ? null : `fast-pass 아님: ${t.slice(0, 60)}`;
const mentions = (...needles: string[]) => (t: string) =>
    needles.some(n => t.includes(n)) ? null : `데이터 미반영(${needles.join('|')}): ${t.slice(0, 60)}`;
const has = (v: unknown, s: string) => typeof v === 'string' && v.includes(s);

const cases: Case[] = [
    // ── fast-pass 6종: 도구 출력이 카드이므로 모델이 손대면 안 된다 ──
    {
        intent: 'pharmacy_search', ask: '서울 강남구에 문 연 약국 알려줘',
        args: a => has(a.sido, '서울') ? null : `sido=${a.sido}`,
        result: card('pharmacy'), text: passthrough('pharmacy'),
    },
    {
        intent: 'hospital_search', ask: '부산 해운대구 정형외과 찾아줘',
        args: a => has(a.sido_name, '부산') ? null : `sido_name=${a.sido_name}`,
        result: card('hospital'), text: passthrough('hospital'),
    },
    {
        intent: 'vet_search', ask: '대전 유성구 동물병원 알려줘',
        args: a => has(a.sido, '대전') ? null : `sido=${a.sido}`,
        result: card('vet'), text: passthrough('vet'),
    },
    {
        intent: 'law_search', ask: '도로교통법 제44조 조문 보여줘',
        args: a => (has(a.query, '도로교통법') || has(a.law_name, '도로교통법')) ? null : `query=${a.query} law_name=${a.law_name}`,
        result: card('law'), text: passthrough('law'),
    },
    {
        intent: 'movie_search', ask: '수원 영화 상영시간표 알려줘',
        args: a => has(a.region, '수원') ? null : `region=${a.region}`,
        result: card('movie'), text: passthrough('movie'),
    },
    {
        intent: 'weather', ask: '전주랑 서울 날씨 알려줘',
        // 실측 회귀가 있던 자리 — 언급한 도시를 **전부** 넘겨야 한다(generator 의 weather 힌트).
        args: a => {
            const c = (a.cities ?? []).join(',');
            return c.includes('전주') && c.includes('서울') ? null : `cities=${c}`;
        },
        result: card('weather'), text: passthrough('weather'),
    },
    // ── synthesize 5종: 도구 데이터가 산문에 실제로 반영돼야 한다 ──
    {
        intent: 'drug_info', ask: '타이레놀 성분이 뭐야?',
        args: a => has(a.drug_name, '타이레놀') ? null : `drug_name=${a.drug_name}`,
        result: '[MFDS_DRUG_DATA] 제품명: 타이레놀정500mg / 주성분: 아세트아미노펜 / 1일 최대 3200mg',
        text: mentions('3200', '아세트아미노펜'),
    },
    {
        intent: 'law_qa', ask: '음주운전 처벌 기준이 어떻게 돼?',
        args: a => (typeof a.query === 'string' && a.query.length > 0) ? null : `query=${a.query}`,
        result: '[LAW_DATA] 도로교통법 제148조의2: 혈중알코올농도 0.08% 이상 — 징역 1년 이상 2년 이하, 벌금 500만원 이상 1천만원 이하. 시행일 2026-01-01.',
        text: mentions('0.08', '148'),
    },
    {
        intent: 'sports', ask: '월드컵 득점왕 누구야?',
        args: a => (typeof a.resource === 'string' && a.resource.length > 0) ? null : `resource=${a.resource}`,
        result: '[WORLDCUP_DATA] 득점왕: Erling Haaland (노르웨이) 9골',
        text: mentions('Haaland', '홀란', '9'),
    },
    {
        intent: 'paper_search', ask: '당뇨병 환자의 운동 효과에 대한 논문 찾아줘',
        args: a => (typeof a.query === 'string' && a.query.length > 0) ? null : `query=${a.query}`,
        result: '[PAPER_DATA]\nPMID 36521234 · "Exercise and glycemic control in type 2 diabetes"\nJ Diabetes Res · 2023 · 무작위배정 대조시험 · HbA1c 0.7%p 감소',
        text: mentions('36521234', '0.7'),
    },
    {
        intent: 'arxiv_search', ask: '그래프 신경망 최신 논문 찾아줘',
        args: a => (typeof a.query === 'string' && a.query.length > 0) ? null : `query=${a.query}`,
        // 🔴 처음엔 `arXiv:2609.04417` 을 썼다가 **프로브가 스스로 실패를 만들었다.**
        //    2609 = 2026년 9월이라 모델이 "미래 날짜"로 읽고 결과를 통째로 버렸다
        //    (실제 응답: "arXiv 번호가 2609로 시작해 현재 시점보다 미래 날짜일 가능성이 있으므로").
        //    픽스처는 **그럴듯해야 한다** — 모델이 의심할 값을 주면 모델이 아니라 픽스처를 재게 된다.
        result: '[ARXIV_DATA]\narXiv:2401.14732 · "Scaling Graph Neural Networks to Billion-Edge Graphs"\n저자: Kim, Park, Lee · 분류: cs.LG · 제출 2024-01-26',
        text: mentions('2401.14732', 'Scaling Graph'),
    },
];

type Cell = { verdicts: string[]; ms: number[]; notes: string[] };
const table: Record<string, Record<string, Cell>> = {};

for (const model of MODELS) {
    table[model] = {};
    for (const c of cases) {
        const prod = getLocalFunctionTool(c.intent);
        if (!prod) { console.error(`레지스트리에 ${c.intent} 없음`); process.exit(1); }
        const cell: Cell = { verdicts: [], ms: [], notes: [] };
        for (let rep = 0; rep < REPS; rep++) {
            let called = false;
            let captured: Record<string, any> = {};
            // 정의는 프로덕션 그대로, 실행만 스텁.
            const tool: LocalFunctionTool = {
                ...prod,
                execute: async args => { called = true; captured = args; return c.result; },
            };
            const startedAt = Date.now();
            try {
                const r = await generateOpenAIChat({
                    model,
                    instructions: 'You are a Korean assistant. Use the provided function when it fits the request. Answer in Korean.',
                    messages: [new HumanMessage(c.ask)],
                    useWebSearch: false, maxOutputTokens: 512, timeoutMs: TIMEOUT_MS,
                    functionTool: tool,
                });
                const argIssue = called ? c.args(captured) : '도구 미호출';
                const textIssue = called ? c.text(r.text, tool) : null;
                cell.verdicts.push(!called ? 'NO_CALL' : argIssue ? 'BAD_ARGS' : textIssue ? 'BAD_TEXT' : 'OK');
                if (argIssue || textIssue) cell.notes.push(String(argIssue ?? textIssue));
            } catch (error: any) {
                cell.verdicts.push('ERROR');
                cell.notes.push(`${error?.status ?? ''} ${error?.code ?? ''} ${error?.message ?? error}`.trim());
            }
            cell.ms.push(Date.now() - startedAt);
        }
        table[model][c.intent] = cell;
        const ok = cell.verdicts.filter(v => v === 'OK').length;
        console.log(`  ${model.padEnd(13)} ${c.intent.padEnd(16)} ${ok}/${REPS} OK` +
            (ok === REPS ? '' : `  [${cell.verdicts.join(',')}]  ${cell.notes[0] ?? ''}`.slice(0, 150)));
    }
}

const okRate = (c: Cell) => c.verdicts.filter(v => v === 'OK').length / c.verdicts.length;

console.log('\n── 의도별 대조 (OK 비율) ──');
let diverged = 0, shaky = 0;
for (const c of cases) {
    const rates = MODELS.map(m => okRate(table[m][c.intent]));
    // 🔴 판정은 **비율 차이**로 한다. 한쪽만 흔들리는 게 아니라면 모델 차이가 아니다.
    //    임계 1/REPS 는 "한 번 더 실패한 정도는 차이로 세지 않는다" 는 뜻이다.
    const gap = Math.abs(rates[0] - rates[1]);
    const isDiverged = gap > 1 / REPS + 1e-9;
    const isShaky = rates.some(r => r < 1) && !isDiverged;
    if (isDiverged) diverged++; else if (isShaky) shaky++;
    console.log(`${isDiverged ? '❌' : isShaky ? '⚠️ ' : '✅'} ${c.intent.padEnd(16)} ` +
        MODELS.map((m, i) => `${m}=${(rates[i] * 100).toFixed(0)}%`).join('  '));
}

const out = `/tmp/openai-luna-tools-${Date.now()}.json`;
fs.writeFileSync(out, JSON.stringify({ models: MODELS, reps: REPS, table, finishedAt: new Date().toISOString() }, null, 2));
console.log(`\n리포트 ${out}`);
console.log(`반복 ${REPS}회 · 갈린 의도 ${diverged} · 두 모델이 함께 흔들린 의도 ${shaky} / 전체 ${cases.length}`);
// 종료 코드는 **갈렸는가**로만 낸다. 둘이 같이 흔들리면 그건 모델 차이가 아니라
// 우리 도구 계약이나 픽스처 문제이므로 ⚠️ 로 남기고 통과시킨다 — 이 프로브의 질문은 "같은가" 다.
console.log(diverged === 0
    ? `\n✅ ${cases.length}개 의도 전부에서 두 모델의 OK 비율이 같은 수준이다.`
    : `\n❌ ${diverged}개 의도가 갈렸다 — gpt-6-luna 를 같은 자리에 두기 전에 해결해야 한다.`);
process.exit(diverged === 0 ? 0 : 1);
