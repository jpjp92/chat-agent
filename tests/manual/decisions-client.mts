/**
 * OpenAI Decisions API 호출과 라우터 의도 질문 — probe-decisions-router · probe-decisions-multiturn 공용.
 * 계획: docs/plans/PLAN_DECISION_ROUTER_261019.md
 *
 * 주의: INTENT_QUESTIONS 문구는 1·2차 측정(10-19)에서 고정한 값이다. 바꾸면 검증용 세트 결과와 비교할 수 없다.
 */
export const DECISIONS_URL = 'https://api.openai.com/v1/decisions';
export const DECISIONS_MODEL = 'gpt-6-luna';
export const TIMEOUT_MS = 15_000;
/** 이 값 미만이면 "회색지대"로 본다 — 운영에서 기존 라우터로 넘길 후보 기준(실험값, 측정 전에 고정). */
export const LOW_CONF = 0.7;

// 라우터 프롬프트의 의도 정의를 요약했다. arxiv_search 는 라우터처럼 paper_source 에서 파생한다.
const INTENT_CHOICES = [
    ['drug_id', 'The user has a pill or tablet image and asks to identify it.'],
    ['drug_info', 'Text lookup of a specific drug: dosage, side effects, ingredients.'],
    ['medical_qa', 'A general medical or health question: symptoms, diseases, treatments, anatomy.'],
    ['pharmacy_search', 'Find a pharmacy location or its operating hours.'],
    ['hospital_search', 'Find a hospital or clinic location, ER, hours, or department.'],
    ['vet_search', 'Find a veterinary or animal hospital location.'],
    ['law_search', 'Show a Korean statute itself: a law list, its articles, or an article\'s original text.'],
    ['law_qa', 'A question that Korean law answers: an amount, limit, permission, penalty, or what to do legally.'],
    ['paper_search', 'The user asks for research papers, studies, or academic evidence.'],
    ['movie_search', 'Movie showtimes or what is playing at CGV, Lotte Cinema, or Megabox.'],
    ['weather', 'Current weather, temperature, precipitation, or short-term forecast for a place.'],
    ['biology', 'Biology: protein structure, DNA, RNA, cells, genetics, enzymes.'],
    ['chemistry', 'Chemistry: molecular structure, reactions, elements, compounds.'],
    ['physics', 'Physics simulation: mechanics, force, motion, gravity, electricity.'],
    ['astronomy', 'Constellations, stars, planets, galaxies, space observation.'],
    ['data_viz', 'Data analysis, statistics, or a chart of numbers or trends.'],
    ['general', 'Everything else, including advice, shopping, costs, careers, code, writing, chit-chat, and web search. Words like pet, lawyer, hospital, or pharmacy alone do not make a lookup.'],
] as const;

export const INTENT_QUESTIONS = [
    {
        type: 'choice', name: 'intent',
        instructions: 'Classify the main intent of the latest user message. Pick a lookup intent only when the user actually asks to find, show, or look up that thing.',
        choices: INTENT_CHOICES.map(([value, description]) => ({ value, description })),
    },
    {
        type: 'choice', name: 'paper_source',
        instructions: 'If the user wants papers, which database studies this subject? Answer none if they do not want papers.',
        choices: [
            { value: 'pubmed', description: 'A living body: organisms, physiology, disease, drugs, nutrition, mental health.' },
            { value: 'arxiv', description: 'A formal, physical, or computational system: math, physics, computing, machine learning, engineering.' },
            { value: 'none', description: 'A human record (literature, history, law, art), or the user does not want papers.' },
        ],
    },
];

/**
 * v2 — PLAN §10 오답 유형 B 대응. 의도 정의 두 개에 경계 문장을 붙였다(나머지는 v1 그대로).
 * 예시는 튜닝 세트(1~4차) 표현만 쓴다 — 검증 세트(HOLDOUT2·MULTITURN_HOLDOUT) 문장을 넣으면 검증이 무의미해진다.
 */
const INTENT_DESC_V2: Record<string, string> = {
    medical_qa: 'A human health question: symptoms, diseases, treatments, anatomy, or when to see a doctor. Pet care and pet training are general.',
    law_qa: 'Asks what Korean law requires, permits, or penalizes: an amount, limit, eligibility, penalty, or legal consequence. Practical business setup, tax-filing schedules, or professional fees without a legal question are general.',
};
export const INTENT_QUESTIONS_V2 = INTENT_QUESTIONS.map(q => q.name !== 'intent' ? q : {
    ...q,
    choices: q.choices!.map(c => ({ ...c, description: INTENT_DESC_V2[c.value] ?? c.description })),
});

/** 카드 후속 판정. v1 은 3차 측정에서 쓴 문구. */
export const FOLLOW_UP_V1 = {
    type: 'choice', name: 'follow_up',
    instructions: 'A result card is displayed on screen (see NOTE). How does the latest user message relate to that card?',
    choices: [
        { value: 'refine', description: 'Interprets, compares, or filters the card already shown: which day is hottest, do I need an umbrella, which showtime is earliest, which one is open now.' },
        { value: 'new', description: 'Asks for a new lookup of the same kind: a different city, theater, region, day, or time. Often very short, like "부산은?", "내일은?", or "How about Busan?".' },
        { value: 'unrelated', description: 'The subject moved away from the card entirely: food, coding, a medicine, or another topic.' },
    ],
};
/** v2 — PLAN §10 오답 유형 C 대응. 현행 프롬프트의 "다른 날짜는 new" 규칙과 법령·다른 카드 종류를 명시했다. */
export const FOLLOW_UP_V2 = {
    type: 'choice', name: 'follow_up',
    instructions: 'A result card is displayed on screen (see NOTE). How does the latest user message relate to that card? A different day, time, city, theater, region, statute, or article is a NEW lookup even if the card already contains a multi-day forecast or related data.',
    choices: [
        { value: 'refine', description: 'Interprets, compares, or filters what the card already shows for the same place and target: do I need an umbrella, which showtime is earliest, which one is open now, what this article means for me.' },
        { value: 'new', description: 'Asks for a new lookup of the same kind: a different city, theater, region, day, time, statute, or article. Often very short, like "부산은?", "내일은?", "How about Busan?", or "도로교통법도 보여줘".' },
        { value: 'unrelated', description: 'The subject moved away from the card: food, coding, a medicine, chit-chat, or a lookup of a different kind (for example weather while a law card is shown).' },
    ],
};

/** choice 답은 choice·confidence, predicate 답은 probability 를 쓴다. */
export type ChoiceAnswer = { choice: string; confidence: number | null; probability?: number | null };
export type DecisionsCall = {
    answers: Record<string, ChoiceAnswer | 'REFUSAL'>;
    ms: number; status: number; raw?: unknown; error?: string;
};

/** Decisions 1회 호출. 답은 질문 이름별로 돌려준다(거절은 'REFUSAL'). */
export async function callDecisions(input: string, questions: unknown[], keepRaw = false): Promise<DecisionsCall> {
    const key = process.env.OPENAI_API_KEY_TIER1;
    if (!key) throw new Error('OPENAI_API_KEY_TIER1 이 없다');
    const t0 = Date.now();
    try {
        const res = await fetch(DECISIONS_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: DECISIONS_MODEL, input, questions }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const ms = Date.now() - t0;
        const body: any = await res.json().catch(() => null);
        if (!res.ok) return { answers: {}, ms, status: res.status, raw: body, error: body?.error?.message ?? `HTTP ${res.status}` };
        const answers: DecisionsCall['answers'] = {};
        for (const a of body?.answers ?? []) {
            answers[a.name] = a.type === 'refusal'
                ? 'REFUSAL'
                : { choice: a.choice, confidence: typeof a.confidence === 'number' ? a.confidence : null,
                    probability: typeof a.probability === 'number' ? a.probability : null };
        }
        return { answers, ms, status: res.status, raw: keepRaw ? body : undefined };
    } catch (e: any) {
        return { answers: {}, ms: Date.now() - t0, status: 0, error: e?.name === 'TimeoutError' ? `timeout ${TIMEOUT_MS}ms` : String(e?.message ?? e) };
    }
}

/** intent 답에 라우터와 같은 파생 규칙을 적용한다: paper_search 는 DB 판정으로 arxiv_search / general 로 갈린다. */
export function resolveIntent(call: DecisionsCall): { intent: string; confidence: number | null } {
    if (call.error) return { intent: 'ERR', confidence: null };
    const ia = call.answers.intent;
    if (!ia || ia === 'REFUSAL') return { intent: 'REFUSAL', confidence: null };
    let intent = ia.choice;
    if (intent === 'paper_search') {
        const src = call.answers.paper_source;
        const s = src && src !== 'REFUSAL' ? src.choice : undefined;
        if (s === 'arxiv') intent = 'arxiv_search';
        else if (s !== 'pubmed') intent = 'general';
    }
    return { intent, confidence: ia.confidence };
}
