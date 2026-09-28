/**
 * 출력 사후 검증 — 모델이 **오늘 날짜를 틀리게 단정**했는지 완성된 답변에서 잡는다.
 *
 * 왜 프롬프트가 아니라 출력인가 (§5-a 구조 후보 ①, DEV_260928 §13-4):
 *   시각 블록은 이미 할 말을 다 하고 있다 — "This is the ONLY source for today's date.
 *   Never infer it from search results, article publication dates, or your training data."
 *   문구 후보는 **세 번 기각**됐다(위치 end, 위치 both, 렌더 iso24 / p=0.678).
 *   §13-3 실측: 날짜를 **직접 물으면** 검색이 붙어도(src=10) 주입값을 정확히 쓴다.
 *   즉 지시는 먹고 있고, 실패는 기사 날짜를 읽다가 "오늘"을 **재추론**할 때만 난다.
 *   프롬프트로 더 밀어붙일 자리가 남지 않았으므로, 남은 레버는 **사후 검증**이다.
 *
 * 🔴 **치환하지 않고 덧붙인다.** 이게 이 모듈의 핵심 설계 결정이다.
 *   틀린 날짜를 맞는 날짜로 바꿔치기하면, F1(날짜 오단정)이 **더 나쁜 결함**으로 바뀐다:
 *   *"오늘(9월 27일) 발표된 이 논문은…"* 에서 27→29 로 고치면 **기사 날짜까지 거짓**이 된다.
 *   실제로 F1 은 전날 기사를 읽던 중에 나므로 그 날짜가 맞는 경우가 많다 — 틀린 건
 *   "오늘" 이라는 **꼬리표**뿐이다. 꼬리표만 고칠 수는 없으니 사실을 덧붙여 바로잡는다.
 *
 * 🔴 **덧붙이기만이 세 경로 모두에서 가능하다.** SDK·OpenAI 경로는 완성본을 한 번에 보내지만
 *   LangChain 경로는 `on_chat_model_stream` 으로 **토큰을 이미 흘려보낸 뒤**다(stream-dispatch).
 *   이미 화면에 찍힌 글자는 고쳐 쓸 수 없다. 덧붙이기는 카드 블록이 쓰는 것과 같은 방식이다.
 *
 * ⚠️ 한국어 출력만 검사한다 — 표지가 `오늘`·`월`·`일` 이다. 다른 언어에서는 아무것도 하지
 *   않는다(오검출 0). 다국어로 넓히려면 **먼저 그 언어에서 F1 이 나는지 측정**해라.
 */

/** `Intl` 로 tz 기준 오늘을 뽑는다 — 서버 로컬 시간이 아니라 사용자 tz 가 기준이다. */
export const todayInZone = (now: Date, timeZone: string): { y: number; m: number; d: number } => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
    return { y: get('year'), m: get('month'), d: get('day') };
};

/**
 * 울타리 코드블록을 지운다 — `json:weather` 등 **카드 블록 안에 날짜가 들어 있다**.
 * 카드는 도구가 돌려준 값이라 모델의 단정이 아니다. 스캔 전에 빼지 않으면 카드가 오검출을 만든다.
 * (길이를 유지할 필요는 없다 — 우리는 위치가 아니라 존재만 본다.)
 */
const withoutFencedBlocks = (text: string) => text.replace(/```[\s\S]*?(?:```|$)/g, '');

/**
 * `오늘` 바로 뒤에 붙은 날짜 단정만 잡는다.
 *
 * 간격을 **조사·괄호·별표·공백으로만** 좁게 열어 둔 것이 오검출 방어다:
 *   "오늘 나온 9월 27일 기사"  → `나온` 이 막아서 걸리지 않는다 (날짜 단정이 아니다)
 *   "오늘 기준 2025년 3월 출시" → `기준` 이 막는다 (그 날짜는 출시일이다)
 *   "오늘은 9월 27일", "오늘(2026년 9월 27일)", "오늘 **9월 27일**" → 걸린다
 */
const TODAY_CLAIM = /오늘\s*(?:은|는|의)?\s*[(（[]?\s*\**\s*(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;

export interface TodayClaimCheck {
    /** 모델이 오늘이라고 단정한 값 중 **틀린** 것들 (`"9/27"` 형태). 비면 문제 없음. */
    wrong: string[];
    /** 덧붙일 정정 문장. `wrong` 이 비면 빈 문자열. */
    note: string;
}

/**
 * 완성된 답변에서 틀린 오늘 단정을 찾는다. 순수 함수 — 모델도 네트워크도 타지 않는다.
 */
export const checkTodayClaim = (text: string, now: Date, timeZone: string): TodayClaimCheck => {
    const empty: TodayClaimCheck = { wrong: [], note: '' };
    if (!text) return empty;
    const today = todayInZone(now, timeZone);
    const scanned = withoutFencedBlocks(text);
    const wrong: string[] = [];
    for (const m of scanned.matchAll(TODAY_CLAIM)) {
        const y = m[1] ? Number(m[1]) : today.y;   // 연도를 안 밝히면 올해로 본다
        const mo = Number(m[2]), d = Number(m[3]);
        if (y === today.y && mo === today.m && d === today.d) continue;
        // 🔴 부정문은 세지 않는다 — *"오늘은 9월 27일이 아니라…"* 는 모델이 **맞게** 말한 것이다.
        const tail = scanned.slice(m.index! + m[0].length, m.index! + m[0].length + 12);
        if (/^\s*(?:이)?\s*아니/.test(tail)) continue;
        const label = `${mo}/${d}`;
        if (!wrong.includes(label)) wrong.push(label);
    }
    if (wrong.length === 0) return empty;
    return {
        wrong,
        // 덧붙이는 문장은 **사실 한 줄**이다. 모델 답변을 평가하거나 사과하지 않는다 —
        // 사용자가 잘못 알게 되는 것은 날짜뿐이므로 날짜만 바로잡는다.
        note: `\n\n> ※ 오늘은 ${today.y}년 ${today.m}월 ${today.d}일입니다. 위 답변의 "오늘" 날짜 표기(${wrong.join(', ')})는 정확하지 않을 수 있습니다.\n`,
    };
};
