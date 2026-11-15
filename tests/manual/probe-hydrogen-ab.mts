/**
 * Gemini 4 Hydrogen A/B 프로브 — `npx tsx tests/manual/probe-hydrogen-ab.mts [결과.json]`
 * 계획: docs/plans/PLAN_GEMINI_4_HYDROGEN_261113.md §3 1단계
 *
 * 유료 호출 = 질문 10 × 구성 수(기본 5, `ONLY=키,키` 로 고른다). 합성 질문만. 운영 코드(라우터·generator)를 거치지 않는 독립 프로브다.
 * 재는 것: 첫 글자까지(TTFT)·전체 시간·입력/출력/thinking 토큰·추정 비용. 답 본문은 결과 파일로 남겨 사람이 본다.
 */
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const ai = new GoogleGenAI({ apiKey: env.API_KEY_TIER1 });

// 100만 토큰당 USD(2026-11 가격 페이지) — 출력에는 thinking 포함. after 는 2027-01-01 이후
const PRICE: Record<string, { in: number; out: number; inAfter: number; outAfter: number }> = {
    'gemini-3.8-flash': { in: 0.75, out: 3.75, inAfter: 1.5, outAfter: 7.5 },
    'gemini-4-hydrogen': { in: 1.5, out: 7.5, inAfter: 1.5, outAfter: 7.5 },
};
// ONLY=H-low,H-low-nothink 처럼 주면 그 구성만 돈다(없으면 전부)
const CONFIGS = [
    { key: '3.8-low', model: 'gemini-3.8-flash', level: 'low' },
    { key: 'H-low', model: 'gemini-4-hydrogen', level: 'low' },
    { key: 'H-medium', model: 'gemini-4-hydrogen', level: 'medium' },
    // thinking 을 끄는 스위치는 없다 — 지시문으로 건너뛰게 한다(probe-hydrogen-thinking-off.mts 에서 찾음)
    { key: 'H-low-nothink', model: 'gemini-4-hydrogen', level: 'low', sys: ' 생각 과정 없이 곧바로 답한다. 내부 추론을 하지 말고 답만 쓴다.' },
    { key: '3.8-low-nothink', model: 'gemini-3.8-flash', level: 'low', sys: ' 생각 과정 없이 곧바로 답한다. 내부 추론을 하지 말고 답만 쓴다.' },
].filter(c => !process.env.ONLY || process.env.ONLY.split(',').includes(c.key)) as { key: string; model: string; level: string; sys?: string }[];

const SUMMARY_SRC = '도시 열섬 현상은 도심의 기온이 주변 교외보다 높게 나타나는 현상이다. 아스팔트와 콘크리트는 낮 동안 태양열을 흡수했다가 밤에 천천히 내보내고, 건물이 밀집하면 바람길이 막혀 열이 빠져나가지 못한다. 에어컨 실외기와 자동차가 내뿜는 인공 열도 기온을 끌어올린다. 그 결과 열대야가 늘고 냉방 전력 수요가 커지며, 노약자의 온열 질환 위험이 높아진다. 대책으로는 옥상 녹화와 가로수 확대, 햇빛을 반사하는 밝은색 포장재, 바람길을 고려한 건물 배치 등이 거론된다.';
const QUESTIONS = [
    { id: 'logic', q: '민수는 지호보다 키가 크다. 서연은 민수보다 작지만 지호보다는 크다. 세 사람을 키가 큰 순서대로 말해줘. 이유도 한 문장으로.' },
    { id: 'speed', q: '시속 60km로 2시간 30분을 달린 뒤, 이어서 시속 90km로 40분을 달렸다. 총 이동 거리와 전체 평균 속력을 구해줘.' },
    { id: 'trap', q: '세종대왕이 집현전 학자들에게 맥북 프로를 던진 사건의 경위를 설명해줘.' },
    { id: 'nuance', q: "연결어미 '-는데'와 '-지만'의 차이를 예문 2개씩 들어 설명해줘." },
    { id: 'summary', q: `다음 글을 두 문장으로 요약해줘.\n\n${SUMMARY_SRC}` },
    { id: 'code', q: '파이썬 리스트에서 순서를 유지하면서 중복을 제거하는 함수를 작성하고, 동작 원리를 한 문장으로 설명해줘.' },
    { id: 'format', q: '서울, 부산, 제주의 특징을 JSON 배열로만 출력해줘. 각 원소의 키는 city, feature 두 개. JSON 외의 글자는 쓰지 마.' },
    { id: 'jug', q: '3리터 물통과 5리터 물통만으로 정확히 4리터를 만드는 방법을 단계별로 알려줘.' },
    { id: 'spelling', q: "다음 문장의 맞춤법과 띄어쓰기를 고쳐줘: '어제 친구랑 않 만났는데 왠지 기분이 않좋았어. 몇일 뒤에 다시 연락할께.'" },
    { id: 'bat', q: '배트와 공을 합쳐 11,000원이다. 배트는 공보다 10,000원 비싸다. 공은 얼마일까?' },
];

const run = async (cfg: (typeof CONFIGS)[number], q: string) => {
    const t0 = Date.now();
    let ttft: number | null = null, text = '', usage: any = null, err: string | null = null;
    try {
        const stream = await ai.models.generateContentStream({
            model: cfg.model, contents: q,
            config: { systemInstruction: `한국어로 간결하고 정확하게 답한다.${cfg.sys ?? ''}`, temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: cfg.level as any } },
        });
        for await (const chunk of stream) {
            const t = chunk.text ?? '';
            if (t && ttft === null) ttft = Date.now() - t0;
            text += t;
            if (chunk.usageMetadata) usage = chunk.usageMetadata;
        }
    } catch (e: any) { err = `${e?.status ?? ''} ${String(e?.message ?? e).slice(0, 160)}`; }
    const total = Date.now() - t0;
    const inTok = usage?.promptTokenCount ?? 0, outTok = usage?.candidatesTokenCount ?? 0, think = usage?.thoughtsTokenCount ?? 0;
    const p = PRICE[cfg.model];
    return {
        ttft, total, inTok, outTok, think, text, err,
        cost: (inTok * p.in + (outTok + think) * p.out) / 1e6,
        costAfter: (inTok * p.inAfter + (outTok + think) * p.outAfter) / 1e6,
    };
};

const rows: any[] = [];
for (const item of QUESTIONS) {
    // 구성 순서를 질문마다 돌린다 — 앞선 호출이 뒤 호출보다 유리/불리한 편향을 흩는다
    const order = CONFIGS.map((_, i) => CONFIGS[(i + QUESTIONS.indexOf(item)) % CONFIGS.length]);
    for (const cfg of order) {
        const r = await run(cfg, item.q);
        rows.push({ id: item.id, cfg: cfg.key, ...r });
        console.log(`${item.id.padEnd(9)} ${cfg.key.padEnd(9)} ttft=${String(r.ttft ?? '-').padStart(5)}ms total=${String(r.total).padStart(5)}ms in=${r.inTok} out=${r.outTok} think=${r.think} $${r.cost.toFixed(5)}${r.err ? ` ❌ ${r.err}` : ''}`);
    }
}

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
console.log('\n구성        n  err  TTFT p50/p90   전체 p50/p90   out 평균  think 평균  비용 합(지금)  비용 합(1월~)');
for (const cfg of CONFIGS) {
    const rs = rows.filter(r => r.cfg === cfg.key), ok = rs.filter(r => !r.err);
    const avg = (k: string) => Math.round(ok.reduce((a, r) => a + r[k], 0) / (ok.length || 1));
    const sum = (k: string) => rs.reduce((a, r) => a + r[k], 0);
    console.log(`${cfg.key.padEnd(10)} ${String(rs.length).padStart(2)}  ${String(rs.length - ok.length).padStart(3)}  ${pct(ok.map(r => r.ttft ?? r.total), .5)}/${pct(ok.map(r => r.ttft ?? r.total), .9)}ms   ${pct(ok.map(r => r.total), .5)}/${pct(ok.map(r => r.total), .9)}ms   ${String(avg('outTok')).padStart(5)}   ${String(avg('think')).padStart(6)}    $${sum('cost').toFixed(4)}      $${sum('costAfter').toFixed(4)}`);
}
const out = process.argv[2];
if (out) { fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1)); console.log(`\n답 본문 저장: ${out}`); }
