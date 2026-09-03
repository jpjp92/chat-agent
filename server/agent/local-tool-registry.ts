import { searchDrugInfoTool } from './drug-info-tool';
import { pharmacyTool } from './pharmacy-tool';
import { hospitalTool } from './hospital-tool';
import { vetTool } from './vet-tool';
import { lawTool } from './law-tool';
import { movieTool } from './movie-tool';
import { worldCupTool } from './worldcup-tool';
import { weatherTool } from './weather-tool';
import { paperTool } from './paper-tool';
import { arxivTool, ARXIV_QUERY_DESCRIPTION } from './arxiv-tool';
import type { FastPassCardType } from './card-tool-output';

export type LocalToolResultMode = 'fast-pass' | 'synthesize';

export type LocalFunctionTool = {
    intent: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    resultMode: LocalToolResultMode;
    cardType?: FastPassCardType;
    followupWebSearch?: boolean;
    execute: (argumentsValue: Record<string, unknown>) => Promise<string>;
};

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const strictObject = (properties: Record<string, unknown>) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
});

const executeTool = (
    tool: { invoke: (...args: any[]) => Promise<unknown> },
    injectedArguments: Record<string, unknown> = {},
) => async (argumentsValue: Record<string, unknown>) => {
    // OpenAI strict mode에서는 optional을 nullable+required로 표현한다. 기존 도구는 undefined를
    // optional로 사용하므로 경계에서 null만 제거한다. 빈 문자열/0/false는 유효한 값이라 보존한다.
    const normalized = Object.fromEntries(
        Object.entries(argumentsValue).filter(([, value]) => value !== null),
    );
    const result = await tool.invoke({ ...normalized, ...injectedArguments });
    return typeof result === 'string' ? result : JSON.stringify(result);
};

const tools: LocalFunctionTool[] = [
    {
        intent: 'drug_info',
        name: 'search_drug_info',
        description: '식약처 데이터와 공식 용어 및 보조 검색 근거로 특정 의약품, 성분 또는 약물 계열 정보를 조회한다. 오타 가능성이 있으면 근거가 공식 표기를 확인하도록 원문 용어를 보존한다.',
        parameters: strictObject({
            drug_name: { type: 'string', description: '조회할 제품명, 성분명 또는 약물 계열명' },
            query_kind: { type: 'string', enum: ['product', 'ingredient_or_class'], description: '특정 판매 제품이면 product, 성분·기전·계열이면 ingredient_or_class' },
        }),
        resultMode: 'synthesize',
        followupWebSearch: true,
        execute: executeTool(searchDrugInfoTool, { reference_search: 'none' }),
    },
    {
        intent: 'pharmacy_search',
        name: 'search_pharmacies',
        description: '전국 약국의 위치와 영업시간을 조회해 UI 카드 데이터를 반환한다.',
        parameters: strictObject({
            sido: { type: 'string', description: '공식 시/도 명칭' },
            sigungu: nullable({ type: 'string', description: '시/군/구 명칭' }),
            keyword: nullable({ type: 'string', description: '동, 약국명 또는 세부 주소 키워드' }),
            current_time_kst: nullable({ type: 'string', description: '한국 표준시 현재 요일과 시간' }),
        }),
        resultMode: 'fast-pass',
        cardType: 'pharmacy',
        execute: executeTool(pharmacyTool),
    },
    {
        intent: 'hospital_search',
        name: 'search_hospitals',
        description: '전국 병원·의원의 위치, 종별, 의사 수를 조회해 UI 카드 데이터를 반환한다.',
        parameters: strictObject({
            sido_name: { type: 'string', description: '공식 시/도 명칭' },
            sigungu_name: nullable({ type: 'string', description: '시/군/구 명칭' }),
            dong_name: nullable({ type: 'string', description: '읍/면/동 명칭' }),
            hospital_name: nullable({ type: 'string', description: '특정 병원명' }),
            hospital_type: nullable({ type: 'string', description: '병원 종별' }),
        }),
        resultMode: 'fast-pass',
        cardType: 'hospital',
        execute: executeTool(hospitalTool),
    },
    {
        intent: 'vet_search',
        name: 'search_veterinary_hospitals',
        description: '행정안전부 인허가 데이터에서 영업 중인 동물병원을 우선 조회해 UI 카드 데이터를 반환한다.',
        parameters: strictObject({
            sido: nullable({ type: 'string', description: '시/도 명칭' }),
            sigungu: nullable({ type: 'string', description: '시/군/구 명칭' }),
            dong_name: nullable({ type: 'string', description: '읍/면/동 명칭' }),
            hospital_name: nullable({ type: 'string', description: '특정 동물병원명' }),
        }),
        resultMode: 'fast-pass',
        cardType: 'vet',
        execute: executeTool(vetTool),
    },
    {
        intent: 'law_search',
        name: 'search_law',
        description: '국가법령정보센터에서 현행 법령 목록, 본문 또는 특정 조문을 조회해 UI 카드 데이터를 반환한다.',
        parameters: strictObject({
            query: { type: 'string', description: '사용자 질의 원문 또는 법령 검색어' },
            law_name: nullable({ type: 'string', description: '법령명 또는 공식 법령명 후보' }),
            article_no: nullable({ type: 'string', description: '특정 조문 번호' }),
            mode: nullable({ type: 'string', enum: ['list', 'body', 'article'], description: '조회 모드' }),
        }),
        resultMode: 'fast-pass',
        cardType: 'law',
        execute: executeTool(lawTool, { interpret_with_gemini: false }),
    },
    {
        intent: 'law_qa',
        name: 'search_law',
        description: '국가법령정보센터에서 현행 법령과 특정 조문을 조회하여 법률 설명의 근거를 제공한다.',
        parameters: strictObject({
            query: { type: 'string', description: '설명 또는 시나리오 질의를 포함한 사용자 원문' },
            law_name: nullable({ type: 'string', description: '법령명 또는 공식 법령명 후보' }),
            article_no: nullable({ type: 'string', description: '특정 조문 번호' }),
            mode: nullable({ type: 'string', enum: ['list', 'body', 'article'], description: '조회 모드' }),
        }),
        resultMode: 'synthesize',
        execute: executeTool(lawTool, { interpret_with_gemini: false }),
    },
    {
        intent: 'movie_search',
        name: 'show_movie_schedule',
        description: 'CGV·롯데시네마·메가박스의 오늘 상영시간표 UI 카드를 표시한다.',
        parameters: strictObject({
            region: nullable({ type: 'string', description: '지역 또는 동네 이름. 미지정이면 null' }),
        }),
        resultMode: 'fast-pass',
        cardType: 'movie',
        execute: executeTool(movieTool),
    },
    {
        intent: 'sports',
        name: 'search_world_cup',
        description: '현재 진행 중인 2026 FIFA 월드컵 조별 순위, 경기·대진 또는 득점왕 정보를 조회한다.',
        parameters: strictObject({
            resource: { type: 'string', enum: ['standings', 'matches', 'scorers'], description: '조회 데이터 종류' },
            stage: nullable({ type: 'string', enum: ['GROUP_STAGE', 'LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL'], description: '경기 단계' }),
            status: nullable({ type: 'string', enum: ['SCHEDULED', 'TIMED', 'FINISHED', 'IN_PLAY', 'PAUSED'], description: '경기 상태' }),
            limit: nullable({ type: 'number', description: '득점왕 표시 인원 수' }),
        }),
        resultMode: 'synthesize',
        execute: executeTool(worldCupTool),
    },
    {
        intent: 'paper_search',
        name: 'search_papers',
        description: 'PubMed 에서 의학·생명과학 논문을 검색해 제목·저널·연도·저자·DOI·인용 URL 과 초록 결론을 UI 카드 데이터로 반환한다.',
        parameters: strictObject({
            query: { type: 'string', description: 'PubMed 검색어. 한국어 질문이라도 의학 용어는 영어로 변환한다.' },
            limit: nullable({ type: 'number', description: '반환할 논문 수. 기본 5, 최대 8' }),
        }),
        // synthesize 지만 cardType 을 준다 — 산문은 모델이 쓰고 카드는 도구 출력으로 고정된다.
        resultMode: 'synthesize',
        cardType: 'paper',
        execute: executeTool(paperTool),
    },
    {
        // 같은 json:paper 카드를 쓰지만 출처가 다르다 — 렌더러가 source 로 배지·문구를 가른다.
        intent: 'arxiv_search',
        name: 'search_arxiv',
        description: 'arXiv 에서 물리·수학·전산·통계·공학·계량경제 논문을 검색해 제목·저자·연도·분류·arXiv ID·인용 URL 을 UI 카드 데이터로 반환한다.',
        parameters: strictObject({
            // 🔴 문안을 여기에 다시 쓰지 않는다 — 두 벌이던 시절 LangChain 쪽만 고쳐져
            //   이 경로가 범용어를 덧붙인 채 남았다(arxiv-tool.ts 의 상수 주석 참고).
            query: { type: 'string', description: ARXIV_QUERY_DESCRIPTION },
            limit: nullable({ type: 'number', description: '반환할 논문 수. 기본 5, 최대 8' }),
        }),
        resultMode: 'synthesize',
        cardType: 'paper',
        execute: executeTool(arxivTool),
    },
    {
        intent: 'weather',
        name: 'show_weather',
        description: '특정 지역의 현재 날씨, 기온, 강수, 단기예보 UI 카드를 반환한다.',
        parameters: strictObject({
            cities: nullable({ type: 'array', items: { type: 'string' }, description: '최대 4개의 지역명 배열. 미지정이면 null' }),
        }),
        resultMode: 'fast-pass',
        cardType: 'weather',
        execute: executeTool(weatherTool),
    },
];

const byIntent = new Map(tools.map(tool => [tool.intent, tool]));

export const getLocalFunctionTool = (intent: string | undefined): LocalFunctionTool | undefined =>
    intent ? byIntent.get(intent) : undefined;
