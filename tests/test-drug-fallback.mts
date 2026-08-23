/** 약품 제품명/성분명 분기와 내부 fallback 비노출 회귀 하니스. */
import fs from 'node:fs';
import {
    buildDrugFallbackInstruction,
    shouldQueryMfdsProductDatabase,
} from '../server/agent/drug-fallback-policy.js';

let pass = 0;
let fail = 0;
const check = (name: string, condition: boolean, detail = '') => {
    if (condition) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const ingredientFallback = buildDrugFallbackInstruction(
    '우파다시티닙',
    { kind: 'quota', reason: '웹 검색 할당량 소진(429)' },
    'ingredient_or_class',
);
check('성분 fallback에 식약처 알약식별 안내 비노출', !ingredientFallback.includes('식약처 알약식별'));
check('성분 fallback에 사용자용 쿼터 문구 비노출', !ingredientFallback.includes('웹 검색 할당량이 소진'));
check('성분 fallback에 제품·이미지 제공 불가 문구 비노출', !ingredientFallback.includes('구체적인 제품명이나 이미지'));
check('성분 fallback은 내부 상태 재서술 금지', ingredientFallback.includes('Do not mention internal MFDS lookup'));
check('성분 fallback은 제품 카드 금지', ingredientFallback.includes('Do not generate a json:drug block'));

const productFallback = buildDrugFallbackInstruction('가상제품정', null, 'product');
check('제품 미확인도 미등재로 단정하지 않음', !productFallback.includes('등록 대상이 아닙니다'));
check('제품 미확인 시 검증되지 않은 브랜드 금지', productFallback.includes('Do not list product names'));

const toolSource = fs.readFileSync(new URL('../server/agent/drug-info-tool.ts', import.meta.url), 'utf8');
const promptSource = fs.readFileSync(new URL('../server/agent/prompt.ts', import.meta.url), 'utf8');
check('약품 웹 검색 모델은 Search 가능한 Gemini 2.5 레지스트리 사용',
    toolSource.includes('DRUG_SEARCH_MODEL = SERVER_MODELS.FLASH'));
check('도구 스키마가 query_kind를 필수 요구',
    toolSource.includes("query_kind: z.enum(['product', 'ingredient_or_class'])"));
check('성분 질문은 MFDS 제품명 조회를 건너뜀',
    !shouldQueryMfdsProductDatabase('ingredient_or_class') && shouldQueryMfdsProductDatabase('product'));
check('도구가 순수 MFDS 분기 정책을 실제 사용',
    toolSource.includes('shouldQueryMfdsProductDatabase(query_kind)'));
check('성분명은 고정 오타 예시 없이 검색 근거로 교정',
    !promptSource.includes('우파다시티닙')
    && !promptSource.includes('유파다시티닙')
    && promptSource.includes('query_kind="ingredient_or_class"'));
check('성분명 후속 질문은 짧게 답하고 요청 없는 세부 용량을 금지',
    promptSource.includes('at most three short sections')
    && promptSource.includes('If the user did not ask about dosage'));
check('사용자 표기와 공식 성분명 차이를 검색 근거로만 안내',
    promptSource.includes('returned search evidence')
    && promptSource.includes('never infer or hard-code')
    && toolSource.includes('오타나 음역 차이'));
check('Google 429 키 cooldown·회전 배선',
    toolSource.includes('markKeyDailyExhausted(apiKey)') &&
    toolSource.includes('markKeyRateLimited(apiKey)') &&
    toolSource.includes('attemptedKeys'));

console.log(`\n통과 ${pass} · 실패 ${fail}`);
if (fail > 0) process.exit(1);
