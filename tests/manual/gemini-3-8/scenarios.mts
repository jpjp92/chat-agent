import type { IntentType } from '../../../server/agent/state';
export type Turn = { q: string; intents: IntentType[]; block?: string;
    value?: string; formula?: boolean; chartValues?: number[]; noBlocks?: boolean };
export type Scenario = { id: string; turns: Turn[] };
export const scenarios: Scenario[] = [
    { id: 'memory-correction', turns: [
        { q: '가상 프로젝트 보관 코드는 ALPHA_731이고 담당자는 민수야. 이 두 값만 기억했다고 답해줘.', intents: ['general'], value: 'ALPHA_731', noBlocks: true },
        { q: '담당자를 지수로 바꿔. 보관 코드는 그대로야. 최종 코드와 담당자만 출력해줘.', intents: ['general'], value: '지수', noBlocks: true },
        { q: '그 보관 코드만 출력해줘.', intents: ['general'], value: 'ALPHA_731', noBlocks: true },
    ] },
    { id: 'chart-edit-topic-switch', turns: [
        { q: '막대 그래프로 A=10, B=20, C=30을 그려줘. 시리즈는 하나만.', intents: ['data_viz'], block: 'chart', chartValues: [10,20,30] },
        { q: '그 그래프에서 B만 25로 바꿔서 다시 그려줘. A와 C는 유지해.', intents: ['data_viz'], block: 'chart', chartValues: [10,25,30] },
        { q: '새 주제야. 17 더하기 25 결과를 숫자만 답해줘. 그래프는 필요 없어.', intents: ['general'], value: '42', noBlocks: true },
    ] },
    { id: 'chemistry-followup', turns: [
        { q: '에탄올의 분자 구조를 보여줘.', intents: ['chemistry'], block: 'smiles' },
        { q: '방금 분자의 분자식만 적어줘.', intents: ['chemistry','general'], value: 'C2H6O', formula: true },
    ] },
    { id: 'physics', turns: [{ q: '마찰 없는 경사면 위 물체의 힘을 자유물체도로 그려서 설명해줘.', intents: ['physics'], block: 'diagram' }] },
    { id: 'biology', turns: [{ q: '헤모글로빈의 3차원 단백질 구조를 PDB 4HHB로 보여줘.', intents: ['biology'], block: 'bio', value: '4HHB' }] },
    { id: 'astronomy', turns: [{ q: '오리온자리의 별 배치를 별자리 지도로 보여줘.', intents: ['astronomy'], block: 'constellation' }] },
    { id: 'medical', turns: [{ q: '바이러스와 세균은 생물학적으로 무엇이 다른지 간단히 설명해줘.', intents: ['medical_qa','biology'] }] },
];
export const routing: Array<{ id: string; q: string; intents: IntentType[]; seed?: string; noFollowup?: boolean; image?: boolean }> = [
    ...scenarios.filter(s => !['memory-correction','chart-edit-topic-switch'].includes(s.id)).map(s => ({id:s.id,...s.turns[0]})),
    { id:'general', q:'안녕하세요', intents:['general'] },
    { id:'data_viz', q:'A=10 B=20 C=30을 막대 그래프로 그려줘', intents:['data_viz'] },
    { id:'drug_info', q:'타이레놀의 성분과 용법을 알려줘', intents:['drug_info'] },
    { id:'drug_id', q:'이 사진의 알약이 무엇인지 식별해줘', intents:['drug_id'], image:true },
    { id:'pharmacy', q:'서울 서초구 지금 문 연 약국 찾아줘', intents:['pharmacy_search'] },
    { id:'hospital', q:'서울 서초구 근처 이비인후과 찾아줘', intents:['hospital_search'] },
    { id:'vet', q:'서울 마포구 동물병원 찾아줘', intents:['vet_search'] },
    { id:'law_search', q:'민법 제750조 조문을 찾아줘', intents:['law_search'] },
    { id:'law_qa', q:'민법 제750조를 근거로 불법행위 손해배상 성립 요건을 사례로 설명해줘', intents:['law_qa'] },
    { id:'movie', q:'오늘 CGV 강남 영화 상영시간표 찾아줘', intents:['movie_search'] },
    { id:'sports-history', q:'2026 월드컵 득점왕 순위 찾아줘', intents:['general'] },
    { id:'sports-current', q:'현재 진행 중인 월드컵 조별 순위 찾아줘', intents:['sports'] },
    { id:'medical_qa', q:'고혈압과 저혈압이 무엇인지 차이를 설명해줘', intents:['medical_qa'] },
    { id:'weather', q:'내일 서울 날씨 알려줘', intents:['weather'] },
    { id:'pubmed', q:'프로바이오틱스 감기 예방 무작위 대조시험 논문 찾아줘', intents:['paper_search'] },
    { id:'arxiv', q:'graph neural network 관련 arXiv 논문 찾아줘', intents:['arxiv_search'] },
    { id:'software-not-paper', q:'클로드 skills 관련된 GitHub 레포 검색해줘', intents:['general'] },
    { id:'vet-not-search', q:'강아지 사료 추천해줘', intents:['general'] },
    { id:'law-not-search', q:'변호사 시험 언제야', intents:['general'] },
    { id:'chart-topic-switch', q:'새 주제야. 17 더하기 25는?', intents:['general'], noFollowup:true,
        seed:'```json:chart\n{"type":"bar","title":"항목","data":{"categories":["A"],"series":[{"name":"값","data":[10]}]}}\n```' },
    { id:'paper-topic-switch', q:'새 주제야. 파이썬으로 리스트 정렬하는 법 알려줘', intents:['general'], noFollowup:true,
        seed:'```json:paper\n{"papers":[{"title":"Synthetic study","pmid":"99999999","summary":"가상 테스트 데이터"}]}\n```' },
];
export function assess(turn: Turn, intent: string, text: string): Record<string, boolean> {
    const blocks = [...text.matchAll(/```json:(\w+)\s*([\s\S]*?)```/g)];
    const parsed = blocks.map(b => { try { return { kind:b[1], data:JSON.parse(b[2]) }; } catch { return { kind:b[1], data:null }; } });
    const normalize = (value: string) => value.normalize('NFKC')
        .replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, '$1')
        .replace(/[\s{}$\\*]/g,'').toUpperCase();
    const normalizeValue = (value: string) => turn.formula ? normalize(value).replace(/_/g, '') : normalize(value);
    const normalized = normalizeValue(text);
    const checks: Record<string, boolean> = { intent: turn.intents.some(i => i === intent), nonempty: !!text.trim(),
        validJsonBlocks: parsed.every(b => b.data !== null) };
    if (turn.block) checks.requiredBlock = parsed.some(b => b.kind === turn.block && b.data);
    if (turn.noBlocks) checks.noBlocks = blocks.length === 0;
    if (turn.value) checks.expectedValue = normalized.includes(normalizeValue(turn.value));
    if (turn.chartValues) {
        const chart = parsed.find(b => b.kind === 'chart')?.data;
        checks.chartData = JSON.stringify(chart?.data?.categories) === '["A","B","C"]' &&
            chart?.data?.series?.length === 1 && JSON.stringify(chart.data.series[0].data) === JSON.stringify(turn.chartValues);
    }
    return checks;
}
