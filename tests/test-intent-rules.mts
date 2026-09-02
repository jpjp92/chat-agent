// tests/test-intent-rules.mts
//
// classifyIntentByRules 양방향 채점 — 기획: docs/plans/PLAN_INTENT_RULES_PRECISION_260816.md
//
// 실행: npx tsx tests/test-intent-rules.mts
//
// ── 왜 양방향인가 ─────────────────────────────────────────────────────
// 이 폴백은 라우터 LLM이 429/503으로 죽었을 때만 도는 경로다(+ weather·movie_search는
// 구제 경로라 LLM 성공 시에도 발동). 원래 목적이 "확신할 때만 건지기"인데
// 재현율을 올리려 넓게 잡혀 있어 일상어가 전문 intent로 끌려간다.
//
//   · 미포착 → general → 검색 붙고 산문으로 답한다. 품질 저하 정도
//   · 오탐   → 렌더러 스펙 주입 + 검색 OFF. 확실히 나쁜 답
//
// 그래서 잡아야 할 것(TP)과 잡으면 안 될 것(FP)을 **한 파일에서 함께** 본다.
// 한쪽만 보면 반드시 다른 쪽이 깨진다 (PLAN_LANG_COVERAGE_260805의 교훈).
//
// ⚠️ 정규식을 여기 복사하지 않는다. 프로덕션을 import한다.
//    복사본 하니스는 프로덕션이 바뀌어도 초록으로 남아 거짓 안심을 준다
//    (PLAN_SEARCH_POLICY_260815 §4 C5).

import { classifyIntentByRules, resolveClinicIntent, resolveWeatherStickiness, resolvePaperArtifactIntent } from '../server/agent/intentRules.js';
import type { IntentType } from '../server/agent/state.js';

type Case = {
    text: string;
    expect: IntentType;
    note: string;
    /** 착수 시점에 이미 틀린 케이스. 고치면 태그를 지운다(하니스가 알려준다). */
    red?: true;
    /** 라우터 구제 경로라 LLM이 성공해도 발동한다 — 우선순위 높음 */
    rescue?: true;
    hasImage?: true;
};

// ══════════════════════════════════════════════════════════════════════
// 1. 잡아야 하는 것 — 회귀 가드
//    패턴을 좁히는 작업이므로, 여기가 깨지면 좁히기가 과했다는 뜻이다.
// ══════════════════════════════════════════════════════════════════════
const TRUE_POSITIVES: Case[] = [
    { text: '월드컵 조별리그 순위 알려줘', expect: 'sports', note: '조별 리그' },
    { text: '16강 대진 어떻게 돼?', expect: 'sports', note: '16강' },

    { text: '오늘 상영시간표 알려줘', expect: 'movie_search', note: '상영시간표', rescue: true },
    { text: '볼만한 영화 추천해줘', expect: 'movie_search', note: '볼만한 영화', rescue: true },
    { text: 'CGV 강남점 예매', expect: 'movie_search', note: '멀티플렉스명', rescue: true },
    // Step 2에서 `영화관` 단독을 좁힌다 — 실제 질의는 살아야 한다
    { text: '근처 영화관 알려줘', expect: 'movie_search', note: '영화관 + 위치 질의', rescue: true },
    { text: '영화관 어디 있어?', expect: 'movie_search', note: '영화관 + 어디', rescue: true },

    { text: '도로교통법 제32조 내용 알려줘', expect: 'law_search', note: '법령 + 조문' },
    { text: '근로기준법 연차 규정이 어떻게 돼?', expect: 'law_search', note: '법률명' },

    { text: '근처 약국 찾아줘', expect: 'pharmacy_search', note: '약국' },
    { text: '동물병원 어디 있어?', expect: 'vet_search', note: '동물병원 — hospital보다 앞이어야' },
    { text: '가까운 응급실 알려줘', expect: 'hospital_search', note: '응급실' },

    { text: '서울 날씨 어때?', expect: 'weather', note: '현재 날씨', rescue: true },
    { text: '내일 기온 몇 도야?', expect: 'weather', note: '기온 + 몇 도', rescue: true },
    // Step 2에서 `날씨`·`기온` 단독을 좁힌다 — 실제 질의는 살아야 한다
    { text: '부산 날씨', expect: 'weather', note: '지역 + 날씨(무종결)', rescue: true },
    { text: '오늘 날씨 알려줘', expect: 'weather', note: '날씨 + 알려', rescue: true },
    { text: '내일 비 와?', expect: 'weather', note: '비 와', rescue: true },
    { text: '주말 날씨 예보 보여줘', expect: 'weather', note: '날씨 + 예보', rescue: true },

    { text: '오리온자리 위치 알려줘', expect: 'astronomy', note: '별자리명' },
    { text: '오늘 밤하늘 별자리 보여줘', expect: 'astronomy', note: '밤하늘/별자리' },
    // Step 1에서 `달`·`태양`·영문 12궁을 좁힌다 — 좁힌 뒤에도 이것들은 살아야 한다
    { text: '보름달은 언제 떠?', expect: 'astronomy', note: '보름달' },
    { text: '달 착륙 과정 설명해줘', expect: 'astronomy', note: '달 + 천문 문맥' },
    { text: '태양계 행성 순서 알려줘', expect: 'astronomy', note: '태양계' },
    { text: '별똥별 언제 볼 수 있어?', expect: 'astronomy', note: '별똥별' },
    { text: 'show me the leo constellation', expect: 'astronomy', note: 'en — constellation이 받는다' },

    { text: '헤모글로빈 단백질 구조 보여줘', expect: 'biology', note: '단백질' },
    { text: '카페인 분자 구조식 그려줘', expect: 'chemistry', note: '분자/구조식' },
    { text: '경사면에서 마찰력 계산해줘', expect: 'physics', note: '경사면/마찰' },

    { text: '이 데이터를 막대 그래프로 시각화해줘', expect: 'data_viz', note: '그래프/시각화' },
    { text: '분기별 매출을 막대 차트로 그려줘', expect: 'data_viz', note: 'Step 1에서 해소' },
    { text: '연도별 추이를 그래프로 보여줘', expect: 'data_viz', note: 'Step 1에서 해소' },

    { text: '타이레놀 부작용 알려줘', expect: 'drug_info', note: '부작용' },
    { text: '인공 타액제 알려줘', expect: 'drug_info', note: '제형 어휘 (6f98abd)' },
    { text: '이 알약 뭐야?', expect: 'drug_id', note: '이미지 동반', hasImage: true },
];

// ══════════════════════════════════════════════════════════════════════
// 2. 잡으면 안 되는 것 — 전부 general이어야 한다
// ══════════════════════════════════════════════════════════════════════
const FALSE_POSITIVES: Case[] = [
    // ── astronomy: `별\s` `별$` `우주` ──────────────────────────────
    { text: '그건 별 문제 아니야', expect: 'general', note: '별 = 별로' },
    { text: '별 다섯개 리뷰 써줘', expect: 'general', note: '별점' },
    { text: '별 일 없었어', expect: 'general', note: '별일' },
    { text: '우주적인 스케일의 실수였다', expect: 'general', note: '비유' },
    { text: '지역별 인구를 정리해줘', expect: 'general', note: '~별 접미사' },
    { text: '제품별 판매량 알려줘', expect: 'general', note: '~별 접미사' },

    // ── astronomy: `달` 단독 — 기획 측정 이후 추가로 발견 ───────────
    { text: '이번 달 일정 알려줘', expect: 'general', note: '달 = 월(月)' },
    { text: '목표 달성 방법 알려줘', expect: 'general', note: '달성' },
    { text: '달러 환율 얼마야', expect: 'general', note: '달러' },
    { text: '태양광 발전 수익률', expect: 'general', note: '태양광 = 에너지' },

    // ── astronomy: 영문 12궁 단독명 — 일반 영단어와 충돌 ────────────
    { text: 'Gemini 모델 성능 비교해줘', expect: 'general', note: '🔴 이 앱의 주력 모델명이다' },
    { text: 'cancer 치료제 최신 연구', expect: 'general', note: 'cancer = 암' },
    { text: 'leo라는 이름 뜻이 뭐야', expect: 'general', note: 'leo = 인명' },
    { text: '이 앱은 libra 라이브러리를 써', expect: 'general', note: 'libra = 패키지명' },

    // ── hospital_search: `의원` ─────────────────────────────────────
    { text: '국회의원 정수가 몇 명이야', expect: 'general', note: '의원 = 議員' },

    // ── physics: `힘` `속도` ────────────────────────────────────────
    { text: '인터넷 속도가 너무 느려', expect: 'general', note: '속도 = 네트워크' },
    { text: '힘내라고 응원 메시지 써줘', expect: 'general', note: '힘내' },
    { text: '힘든 하루였어', expect: 'general', note: '힘들다' },
    { text: '업무 속도를 높이는 방법', expect: 'general', note: '속도 = 생산성' },

    // ── data_viz: `비교` `통계` `추이` `분포` 단독 ──────────────────
    { text: '이 두 제품 비교해줘', expect: 'general', note: '비교 단독' },
    { text: '통계학 공부 어떻게 시작해?', expect: 'general', note: '통계학' },
    { text: '장단점 비교해서 설명해줘', expect: 'general', note: '비교 단독' },
    { text: 'A안과 B안 비교', expect: 'general', note: '비교 단독' },

    // ── law_search: `고시` `조항` ───────────────────────────────────
    { text: '공무원 고시 준비하려면?', expect: 'general', note: '고시 = 시험' },
    { text: '이 조항 좀 다듬어줘', expect: 'general', note: '조항 = 문서 편집' },
    { text: '계약서 조항 작성해줘', expect: 'general', note: '조항 = 작문' },

    // ── biology: `cell` `유전자` ────────────────────────────────────
    { text: '셀(cell) 단위로 나눠줘', expect: 'general', note: 'cell = 스프레드시트' },
    { text: '유전자 알고리즘 구현해줘', expect: 'general', note: '유전 알고리즘 = 코드' },

    // ── chemistry: `화학` ───────────────────────────────────────────
    { text: '화학적으로 잘 맞는 사람', expect: 'general', note: '비유' },
    { text: '화학과 진학 고민이야', expect: 'general', note: '학과' },

    // ── weather / movie_search: 구제 경로 → LLM 성공해도 발동 ────────
    { text: '날씨 좋은 날 뭐하지', expect: 'general', note: '날씨 = 배경', rescue: true },
    { text: '요즘 회사 분위기가 기온처럼 오르내려', expect: 'general', note: '기온 = 비유', rescue: true },
    { text: '영화관 데이트 코스 글 써줘', expect: 'general', note: '영화관 = 작문 소재', rescue: true },

    // ── hospital_search: `병원` ─────────────────────────────────────
    { text: '병원 예약하는 법 알려줘', expect: 'general', note: '방법 질의' },
    { text: '병원비 세액공제 방법', expect: 'general', note: '세무' },
];

// ══════════════════════════════════════════════════════════════════════
// 3. 미포착 — 우선순위 낮음(general+검색이 받아준다). 관측용으로만 둔다.
// ══════════════════════════════════════════════════════════════════════
const MISSES: Case[] = [
    { text: '목성의 위성은 몇 개야?', expect: 'astronomy', note: '목성·위성이 패턴에 없음', red: true },
];

const run = (label: string, cases: Case[]) => {
    console.log(`\n${'═'.repeat(76)}\n${label}\n${'═'.repeat(76)}`);
    let pass = 0, knownRed = 0, regression = 0, fixed = 0;

    for (const c of cases) {
        const got = classifyIntentByRules(c.text, c.hasImage ?? false);
        const ok = got === c.expect;
        const tag = c.rescue ? ' [구제]' : '';

        if (ok && c.red) {
            fixed++;
            console.log(`  🎉 FIXED  ${c.text}  → ${got}${tag}`);
            console.log(`            red 태그를 지울 것 — ${c.note}`);
        } else if (ok) {
            pass++;
            console.log(`  ✅ ${c.text}  → ${got}${tag}`);
        } else if (c.red) {
            knownRed++;
            console.log(`  🔴 ${c.text}  → ${got}  (기대 ${c.expect})${tag}  ${c.note}`);
        } else {
            regression++;
            console.log(`  ❌ 회귀  ${c.text}  → ${got}  (기대 ${c.expect})${tag}  ${c.note}`);
        }
    }
    console.log(`\n  통과 ${pass} · 알려진 결함 ${knownRed} · 새로 고쳐짐 ${fixed} · 🚨회귀 ${regression}`);
    return { pass, knownRed, regression, fixed };
};

// ── 규칙이 LLM 을 이기는 경우 ────────────────────────────────────────
// 🔴 실측(2026-08-31, TIER1 3회씩): 라우터 LLM 이 "서초구 소아과"·"강남 이비인후과"·
//   "분당 피부과"·"근처 치과" 를 **3/3 전부 pharmacy_search** 로 보냈다. 흔들림이 아니라
//   고정된 오분류다. 화면에는 빈 약국 카드가 떴다(사용자 로컬 스크린샷).
//   약국 규칙은 "약국/pharmacy" 라는 **말 자체**를 요구하고, 병원 규칙은 진료과명을 명시
//   열거한다 — 이 충돌에서는 규칙이 정밀하다. 그래서 코드가 이긴다(프롬프트로 밀지 않는다).
{
    let bad = 0;
    const t = (llm: string, text: string, want: string) => {
        const got = resolveClinicIntent(llm as any, classifyIntentByRules(text, false));
        if (got !== want) { bad++; console.log(`  🔴 ${got} (기대 ${want}) ← LLM=${llm} "${text}"`); }
    };
    // 뒤집어야 하는 것 — 진료과명이 있고 약국이라는 말이 없다
    for (const q of ['서초구 소아과', '강남 이비인후과', '분당 피부과', '근처 치과', '서초구 내과'])
        t('pharmacy_search', q, 'hospital_search');
    // 뒤집으면 안 되는 것 — 약국이라는 말이 실제로 있으면 규칙도 약국이라 충돌이 없다
    t('pharmacy_search', '강남역 근처 약국', 'pharmacy_search');
    t('pharmacy_search', '소아과 옆 약국 알려줘', 'pharmacy_search');
    // 규칙이 병원이 아니면 손대지 않는다
    t('pharmacy_search', '타이레놀 사려면', 'pharmacy_search');
    // 다른 의도는 통과 — 이 가드는 약국↔병원 충돌 하나만 본다
    t('vet_search', '근처 동물병원', 'vet_search');
    t('general', '서초구 소아과', 'general');
    console.log(bad ? `\n🚨 진료과 가드 ${bad}건 실패` : '\n✅ 진료과 가드 (약국 오분류 뒤집기) 통과');
    if (bad) process.exit(1);
}

// ── 영화 — 제목이 앞에 오는 모양 ────────────────────────────────────
// 🔴 실측(2026-08-31): "오디세이 영화"·"영화 오디세이 정보" 가 general 로 떨어졌고,
//   날씨 카드가 떠 있던 탓에 LLM 이 weather 를 골라 **"도시를 찾지 못했어요 '오디세이'"**
//   가 화면에 떴다. 규칙이 `영화 + 정보/상영/예매` 를 요구해서 제목이 앞에 오면 못 잡았다.
//   규칙이 movie_search 를 확언해야 날씨 흡입 가드도 발동한다(둘이 물려 있다).
{
    let bad = 0;
    const t = (text: string, want: string) => {
        const got = classifyIntentByRules(text, false);
        if (got !== want) { bad++; console.log(`  🔴 ${got} (기대 ${want}) ← "${text}"`); }
    };
    for (const q of ['오디세이 영화', '영화 오디세이', '영화 오디세이 정보', '듄 파트2 영화',
                     '오디세이 영화정보 알려줘', '오디세이 상영시간']) t(q, 'movie_search');
    // 🔴 오탐 — 이건 영화 검색이 아니라 잡담이다. 잘못 잡으면 검색이 꺼지고 렌더러가 붙는다
    for (const q of ['인생 영화 추천해줘', '무서운 영화 보고 싶다', '한국 영화 역사',
                     '영화 같은 인생이네', '영화 산업 전망은?', '요즘 영화 왜 재미없지'])
        if (classifyIntentByRules(q, false) === 'movie_search') { bad++; console.log(`  🔴 오탐: "${q}"`); }
    console.log(bad ? `\n🚨 영화 규칙 ${bad}건 실패` : '✅ 영화 규칙 (제목 선행형) 통과');
    if (bad) process.exit(1);
}

// ── 날씨 카드 흡입 ───────────────────────────────────────────────────
// 🔴 실측(2026-08-31): 날씨 카드가 화면에 있으면 라우터 LLM 이 무관한 질의를 weather 로
//   끌어왔다 — "서초구 소아과"·"오디세이 영화정보 알려줘" 가 2/2 weather(llmFollowUp=new).
//   **대조군(카드 없음)에서는 각각 hospital/movie 로 정상**이라, 카드의 존재 자체가 원인이다.
//   라우터 프롬프트가 "화면에 날씨 카드가 있다" 를 알려주니 지명을 새 도시로 읽는다.
//   `decideWeatherFollowup` 은 날씨 어휘가 없어 'none' 을 돌려주고 아무 교정도 하지 않았다.
{
    let bad = 0;
    const t = (text: string, shown: boolean, want: string) => {
        const got = resolveWeatherStickiness('weather', classifyIntentByRules(text, false), shown);
        if (got !== want) { bad++; console.log(`  🔴 ${got} (기대 ${want}) ← 카드=${shown} "${text}"`); }
    };
    // 카드가 떠 있고 규칙이 **다른 카드 의도**를 가리키면 규칙이 이긴다
    t('서초구 소아과', true, 'hospital_search');
    t('오디세이 영화정보 알려줘', true, 'movie_search');
    t('강남역 근처 약국', true, 'pharmacy_search');
    t('근처 동물병원', true, 'vet_search');
    t('근로기준법 연차 규정', true, 'law_search');
    // 진짜 날씨 후속은 건드리지 않는다 — 규칙이 weather 이거나 general 이면 그대로
    t('부산 날씨 어때', true, 'weather');   // 규칙도 weather
    t('내일은?', true, 'weather');          // 규칙 general — 판단할 근거가 없으니 LLM 을 믿는다
    t('부산은?', true, 'weather');
    t('우산 챙길까?', true, 'weather');
    // 카드가 없으면 이 가드는 아예 돌지 않는다
    t('서초구 소아과', false, 'weather');
    console.log(bad ? `\n🚨 날씨 흡입 가드 ${bad}건 실패` : '✅ 날씨 흡입 가드 통과');
    if (bad) process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════
// 5. 논문↔소프트웨어 산출물 가드 (resolvePaperArtifactIntent)
//
// 🔴 실측(2026-09-02, 라우터 프롬프트 그대로 재현 · temperature 0 · 2/2 동일):
//   "클로드 skills 관련된 레포 검색" → intent=paper_search · paper_source=arxiv.
//   화면에는 arXiv 논문 카드가 떴고 사용자는 GitHub 레포를 물었다.
//   `레포지토리`·`repo`·`깃허브` 로 풀어 쓰면 전부 general 이다 — 축약형 `레포` 가
//   해소되지 않은 자리에 `관련된 … 검색` 이 프롬프트의 "관련 논문 찾아줘" 와 같은 모양이라
//   주제(AI)가 그대로 arXiv 로 떨어졌다.
//
// ⚖️ isNonBiomedicalPaperTopic 은 `arxiv_search` 에 **적용하지 않는다**(CS 어휘는 arXiv 에서
//   정상). 그래서 arXiv 쪽에는 안전망이 없었다. 이 가드가 그 자리를 메운다.
//   오탐 비용은 낮다 — general 로 내려가면 검색 붙은 산문이 받는다.
// ══════════════════════════════════════════════════════════════════════
{
    console.log(`\n${'='.repeat(76)}\n5. 논문↔소프트웨어 산출물 가드\n${'='.repeat(76)}`);
    let bad = 0;
    const t = (llm: IntentType, text: string, want: IntentType) => {
        const got = resolvePaperArtifactIntent(llm, text);
        if (got !== want) { bad++; console.log(`  🔴 ${got} (기대 ${want}) ← ${llm} "${text}"`); }
    };
    // 소프트웨어 산출물을 찾는데 논문 의도로 분류됐다 → general 로 되돌린다
    t('arxiv_search', '클로드 skills 관련된 레포 검색', 'general');
    t('arxiv_search', 'MCP 서버 오픈소스 프로젝트 검색', 'general');
    t('paper_search', '단백질 구조 예측 깃허브 저장소 찾아줘', 'general');
    t('arxiv_search', 'rag 라이브러리 추천해줘', 'general');
    t('arxiv_search', 'github 에서 claude skills repo 찾아줘', 'general');
    // 진짜 논문 요청은 건드리지 않는다 — 산출물 어휘가 있어도 논문/연구를 명시하면 유지
    t('arxiv_search', '트랜스포머 논문 찾아줘', 'arxiv_search');
    t('arxiv_search', '오픈소스 라이선스 관련 연구 있어?', 'arxiv_search');
    t('paper_search', '깃허브 코파일럿 생산성 논문 있나', 'paper_search');
    t('paper_search', '고혈압 임상시험 결과 알려줘', 'paper_search');
    // 논문 의도가 아니면 이 가드는 아예 돌지 않는다
    t('general', '클로드 skills 관련된 레포 검색', 'general');
    t('drug_info', '타이레놀 성분', 'drug_info');
    console.log(bad ? `\n🚨 산출물 가드 ${bad}건 실패` : '✅ 산출물 가드 통과');
    if (bad) process.exit(1);
}

const r1 = run('1. 잡아야 하는 것 (회귀 가드)', TRUE_POSITIVES);
const r2 = run('2. 잡으면 안 되는 것 (오탐)', FALSE_POSITIVES);
const r3 = run('3. 미포착 (관측용, 우선순위 낮음)', MISSES);

const sum = (k: 'pass' | 'knownRed' | 'regression' | 'fixed') => r1[k] + r2[k] + r3[k];

console.log(`\n${'#'.repeat(76)}`);
console.log(`총계  통과 ${sum('pass')} · 알려진 결함 ${sum('knownRed')} · 고쳐짐 ${sum('fixed')} · 🚨회귀 ${sum('regression')}`);

// 회귀만 실패로 본다. 알려진 결함은 아직 착수 전이라 RED가 정상이다.
// 고쳐진 케이스도 실패로 잡는다 — red 태그가 남아 있으면 다음 사람이 "아직 결함"으로 오해한다.
if (sum('regression') > 0) {
    console.log(`🚨 회귀 발생. 패턴을 과하게 좁혔다 — 잡아야 할 것까지 놓치고 있다.`);
    process.exit(1);
}
if (sum('fixed') > 0) {
    console.log(`🎉 ${sum('fixed')}건이 고쳐졌다. 위 FIXED 케이스에서 \`red: true\`를 지우고 다시 돌릴 것.`);
    process.exit(1);
}
console.log(`✅ 회귀 없음.`);
