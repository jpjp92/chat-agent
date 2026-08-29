/**
 * 모델 선택 UI 문자열 회귀 하니스 — **리팩터링 전후 동작 동일성 계약**.
 *
 * 예전엔 모델 라벨/설명이 `Header.tsx`(모바일)와 `ChatInput.tsx`(데스크톱) **양쪽에**
 * 4개 언어 × 15키로 중복돼 있었다. 2026-08-29 에 문자열을 `src/lib/models.ts` 레지스트리로
 * 합치면서, 그 이전에 화면에 나가던 값을 GOLDEN 으로 먼저 고정하고 리팩터링했다.
 *
 * ▸ GOLDEN 은 **리팩터링 전** 실제 값이다. 리팩터링 후에도 이 표는 바뀌지 않았다 —
 *   바뀌면 그건 리팩터링이 아니라 문구 변경이다.
 * ▸ 지금은 문자열이 순수 모듈에 있으므로 **프로덕션 코드를 그대로 import** 해서 잰다.
 *   (중복 시절엔 React 컴포넌트 소스를 파싱해 읽었다. §READER 만 갈아끼웠고 GOLDEN·검사는 유지.)
 * ▸ 드리프트는 이제 **구조적으로 불가능**하다 — §3 이 그 구조 자체를 지킨다.
 */
import fs from 'node:fs';
import { CHAT_MODEL_OPTIONS, CHAT_MODEL_SECTIONS, pickLabel } from '../src/lib/models.js';
import type { Language } from '../types.js';

const LANGS: Language[] = ['ko', 'en', 'es', 'fr'];

let pass = 0;
let fail = 0;
const check = (name: string, condition: boolean, detail = '') => {
    if (condition) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

// ────────────────────────────────────────────────────────────────────────────
// GOLDEN — 리팩터링 전 화면에 실제로 나가던 문자열 (2026-08-29 채취)
// ────────────────────────────────────────────────────────────────────────────

type L10n = Record<Language, string>;

const GOLDEN_SECTIONS: Record<string, L10n> = {
    gemini: { ko: 'Google Gemini', en: 'Google Gemini', es: 'Google Gemini', fr: 'Google Gemini' },
    openai: { ko: 'OpenAI', en: 'OpenAI', es: 'OpenAI', fr: 'OpenAI' },
    legacy: { ko: '이전 모델', en: 'Previous models', es: 'Modelos anteriores', fr: 'Modèles précédents' },
};

const GOLDEN_MODELS: Record<string, { section: string; label: L10n; description: L10n }> = {
    'gemini-3.7-flash': {
        section: 'gemini',
        label: { ko: 'Gemini 3.7 Flash', en: 'Gemini 3.7 Flash', es: 'Gemini 3.7 Flash', fr: 'Gemini 3.7 Flash' },
        description: {
            ko: '최신 Gemini Flash', en: 'Latest Gemini Flash',
            es: 'El Gemini Flash más reciente', fr: 'Le dernier Gemini Flash',
        },
    },
    'gemini-3.6-flash': {
        section: 'gemini',
        label: { ko: 'Gemini 3.6 Flash', en: 'Gemini 3.6 Flash', es: 'Gemini 3.6 Flash', fr: 'Gemini 3.6 Flash' },
        description: {
            ko: '빠르고 안정적인 기본 모델', en: 'Fast, stable default',
            es: 'Modelo predeterminado rápido y estable', fr: 'Modèle rapide et stable par défaut',
        },
    },
    'gpt-5.6-luna': {
        section: 'openai',
        label: { ko: 'GPT-5.6 luna', en: 'GPT-5.6 luna', es: 'GPT-5.6 luna', fr: 'GPT-5.6 luna' },
        description: {
            ko: '균형 잡힌 OpenAI 모델', en: 'Balanced OpenAI model',
            es: 'Modelo OpenAI equilibrado', fr: 'Modèle OpenAI équilibré',
        },
    },
    'gpt-5.4-mini': {
        section: 'openai',
        label: { ko: 'GPT-5.4 mini', en: 'GPT-5.4 mini', es: 'GPT-5.4 mini', fr: 'GPT-5.4 mini' },
        description: {
            ko: '빠르고 효율적인 OpenAI 모델', en: 'Fast, efficient OpenAI model',
            es: 'Modelo OpenAI rápido y eficiente', fr: 'Modèle OpenAI rapide et efficace',
        },
    },
    'gemini-3.5-flash': {
        section: 'legacy',
        label: { ko: 'Gemini 3.5 Flash', en: 'Gemini 3.5 Flash', es: 'Gemini 3.5 Flash', fr: 'Gemini 3.5 Flash' },
        description: {
            ko: '균형 잡힌 이전 세대 모델', en: 'Balanced previous-generation model',
            es: 'Modelo equilibrado de generación anterior', fr: 'Modèle équilibré de génération précédente',
        },
    },
    'gemini-2.5-flash': {
        section: 'legacy',
        label: { ko: 'Gemini 2.5 Flash', en: 'Gemini 2.5 Flash', es: 'Gemini 2.5 Flash', fr: 'Gemini 2.5 Flash' },
        description: {
            ko: '빠르고 균형 잡힌 응답', en: 'Fast & balanced',
            es: 'Rápido y equilibrado', fr: 'Rapide et équilibré',
        },
    },
};

// ────────────────────────────────────────────────────────────────────────────
// §READER — 화면에 나가는 값을 프로덕션 코드로 직접 만든다
//   (리팩터링 전에는 컴포넌트 소스를 파싱했다. 이 두 함수만 바뀌었다.)
// ────────────────────────────────────────────────────────────────────────────

const UI_FILES = ['components/Header.tsx', 'components/ChatInput.tsx'] as const;

const readSectionLabel = (sectionId: string, lang: Language): string | undefined => {
    const section = CHAT_MODEL_SECTIONS.find(s => s.id === sectionId);
    return section && pickLabel(section.label, lang);
};

const readModelText = (
    modelId: string, field: 'label' | 'description', lang: Language,
): string | undefined => {
    const option = CHAT_MODEL_OPTIONS.find(o => o.id === modelId);
    return option && pickLabel(option[field], lang);
};

// ────────────────────────────────────────────────────────────────────────────
// 1. 골든과 레지스트리가 같은 모델 집합을 말하는가
// ────────────────────────────────────────────────────────────────────────────

const registryIds = CHAT_MODEL_OPTIONS.map(o => o.id).slice().sort();
const goldenIds = Object.keys(GOLDEN_MODELS).sort();
check('1. 집합  레지스트리 모델 = 골든 모델',
    registryIds.join(',') === goldenIds.join(','),
    `레지스트리 ${registryIds.join(',')}\n     골든     ${goldenIds.join(',')}`);

const registrySections = CHAT_MODEL_SECTIONS.map(s => s.id).slice().sort();
check('1. 집합  레지스트리 섹션 = 골든 섹션',
    registrySections.join(',') === Object.keys(GOLDEN_SECTIONS).sort().join(','));

for (const option of CHAT_MODEL_OPTIONS) {
    check(`1. 집합  ${option.id} 섹션 배치`,
        GOLDEN_MODELS[option.id]?.section === option.section,
        `레지스트리 ${option.section} vs 골든 ${GOLDEN_MODELS[option.id]?.section}`);
}

// ────────────────────────────────────────────────────────────────────────────
// 2. 레지스트리가 리팩터링 전과 정확히 같은 문자열을 낸다
// ────────────────────────────────────────────────────────────────────────────

for (const sectionId of Object.keys(GOLDEN_SECTIONS)) {
    const bad = LANGS.filter(l => readSectionLabel(sectionId, l) !== GOLDEN_SECTIONS[sectionId][l]);
    check(`2. 골든  섹션 ${sectionId} (4개 언어)`, bad.length === 0,
        bad.map(l => `${l}: ${readSectionLabel(sectionId, l)} ≠ ${GOLDEN_SECTIONS[sectionId][l]}`).join('\n     '));
}

for (const [modelId, golden] of Object.entries(GOLDEN_MODELS)) {
    for (const field of ['label', 'description'] as const) {
        const bad = LANGS.filter(l => readModelText(modelId, field, l) !== golden[field][l]);
        check(`2. 골든  ${modelId} ${field} (4개 언어)`, bad.length === 0,
            bad.map(l => `${l}: ${readModelText(modelId, field, l)} ≠ ${golden[field][l]}`).join('\n     '));
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 3. 드리프트가 **구조적으로** 불가능하다
//    두 화면이 각자 문자열을 갖는 순간 "한쪽만 고치는" 사고가 되돌아온다.
//    리팩터링의 목적이 이것이므로, 값이 아니라 구조를 지킨다.
// ────────────────────────────────────────────────────────────────────────────

const knownStrings = [
    ...Object.values(GOLDEN_SECTIONS).flatMap(v => Object.values(v)),
    ...Object.values(GOLDEN_MODELS).flatMap(m => [...Object.values(m.label), ...Object.values(m.description)]),
];

for (const file of UI_FILES) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const short = file.replace('components/', '');
    const leaked = [...new Set(knownStrings.filter(s => src.includes(`"${s}"`) || src.includes(`'${s}'`)))];
    check(`3. 구조  ${short} 안에 모델 문자열이 없다`, leaked.length === 0,
        `컴포넌트로 되돌아온 문자열: ${leaked.join(' · ')}`);
    check(`3. 구조  ${short} 에 모델 i18n 맵이 없다`, !/model(I18n|SectionGemini)/.test(src));
}

// ────────────────────────────────────────────────────────────────────────────
// 4. 조회 실패가 없다 — 값이 비면 화면에 빈 칸이 렌더된다
// ────────────────────────────────────────────────────────────────────────────

const empty: string[] = [];
for (const lang of LANGS) {
    for (const s of CHAT_MODEL_SECTIONS) {
        if (!readSectionLabel(s.id, lang)) empty.push(`${lang} 섹션 ${s.id}`);
    }
    for (const o of CHAT_MODEL_OPTIONS) {
        for (const field of ['label', 'description'] as const) {
            if (!readModelText(o.id, field, lang)) empty.push(`${lang} ${o.id}.${field}`);
        }
    }
}
check('4. 조회  모든 값이 채워져 있다 (빈 칸 렌더 없음)', empty.length === 0, empty.join('\n     '));

// 알 수 없는 언어가 들어와도 ko 로 떨어진다 (타입 밖 값이 런타임에 오는 경우)
check('4. 조회  미지원 언어는 ko 폴백',
    pickLabel({ ko: '가', en: 'a', es: 'a', fr: 'a' }, 'de' as Language) === '가');
check('4. 조회  제품명은 언어와 무관하게 그대로',
    LANGS.every(l => pickLabel('Gemini 3.7 Flash', l) === 'Gemini 3.7 Flash'));

// ────────────────────────────────────────────────────────────────────────────
// 5. 배선 — 두 화면이 정말 레지스트리 값을 렌더하는가
//    (레지스트리만 맞고 렌더 지점이 딴 걸 쓰면 하니스는 통과하는데 화면은 틀린다)
// ────────────────────────────────────────────────────────────────────────────

for (const file of UI_FILES) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const short = file.replace('components/', '');
    check(`5. 배선  ${short}  pickLabel import`, /import \{[^}]*\bpickLabel\b[^}]*\} from '\.\.\/src\/lib\/models'/.test(src));
    check(`5. 배선  ${short}  선택된 모델 라벨 렌더`, /pickLabel\(selectedModelOption\.label, language\)/.test(src));
    check(`5. 배선  ${short}  섹션 라벨 렌더`, /pickLabel\(section\.label, language\)/.test(src));
    check(`5. 배선  ${short}  옵션 라벨 렌더`, /pickLabel\(option\.label, language\)/.test(src));
    check(`5. 배선  ${short}  옵션 설명 렌더`, /pickLabel\(option\.description, language\)/.test(src));
}

console.log(`\n${fail === 0 ? '🟢' : '🔴'} pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
