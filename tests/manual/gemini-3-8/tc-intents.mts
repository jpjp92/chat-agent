/** Intent test cases with deterministic answers, plus their scorer.
 *
 * Every case has ONE verifiable answer so accuracy is scored without an LLM judge.
 * Two deliberate constraints:
 *  - Prose and renderer blocks are scored separately. A number that appears only inside a
 *    json block (a diagram magnitude, a chart datum) does not count as the stated answer.
 *  - Fixtures avoid molecules/constellations that `server/agent/prompt.ts` already shows as
 *    examples (ethanol/CCO, Orion). Copying the prompt must not score as knowing the answer.
 */
import type { IntentType } from '../../../server/agent/state';

export type TC = {
    id: string;
    intent: IntentType;
    q: string;
    /** Required `json:<kind>` block. */
    block?: 'chart' | 'smiles' | 'diagram' | 'bio' | 'constellation';
    /** No renderer block may appear at all. */
    noBlocks?: boolean;
    /** Numbers that must appear in the prose, compared numerically. */
    expectNumbers?: number[];
    /** Strings that must appear in the prose after LaTeX/subscript normalization. */
    expectText?: string[];
    /** Exact chart categories and single-series values. */
    chart?: { categories: string[]; data: number[] };
    /** `json:bio` must be a 3D structure with a PDB id, not a 1D sequence. */
    pdb?: boolean;
    /** `json:constellation` lines must be real [id,id] pairs (prompt.ts CRITICAL JSON RULE). */
    lines?: boolean;
};

export const tcs: TC[] = [
    // --- general: arithmetic and counting, no renderer block expected ---
    { id: 'general/pencils', intent: 'general', noBlocks: true, expectNumbers: [65],
        q: '연필이 한 상자에 12자루씩 들어 있고 상자가 7개 있다. 이 중 19자루를 사용했다면 남은 연필은 몇 자루인가? 숫자만 답해줘.' },
    { id: 'general/primes', intent: 'general', noBlocks: true, expectNumbers: [8],
        q: '1부터 20까지의 정수 중 소수는 모두 몇 개인가? 숫자만 답해줘.' },

    // --- data_viz: value preservation, and values the model must derive first ---
    { id: 'data_viz/cities', intent: 'data_viz', block: 'chart',
        chart: { categories: ['서울', '부산', '대구'], data: [120, 85, 60] },
        q: '막대 그래프로 서울 120, 부산 85, 대구 60을 그려줘. 카테고리는 서울·부산·대구 순서로, 시리즈는 하나만.' },
    { id: 'data_viz/derived', intent: 'data_viz', block: 'chart',
        chart: { categories: ['A', 'B', 'C'], data: [40, 80, 120] },
        q: 'A는 40이고, B는 A의 2배, C는 A와 B의 합이야. A·B·C를 이 순서로 막대 그래프로 그려줘. 시리즈는 하나만.' },

    // --- chemistry: structure block required; the scored answer is the molecular formula ---
    { id: 'chemistry/acetic-acid', intent: 'chemistry', block: 'smiles', expectText: ['C2H4O2'],
        q: '아세트산의 분자 구조를 보여주고, 분자식도 함께 알려줘.' },
    { id: 'chemistry/caffeine', intent: 'chemistry', block: 'smiles', expectText: ['C8H10N4O2'],
        q: '카페인의 분자 구조를 보여주고, 분자식도 함께 알려줘.' },

    // --- physics: diagram block required; the scored answer is the computed magnitude ---
    { id: 'physics/incline', intent: 'physics', block: 'diagram', expectNumbers: [4.9],
        q: '마찰이 없는 30도 경사면 위 물체의 가속도를 g=9.8 m/s^2 로 계산하고, 자유물체도로도 보여줘. 가속도는 소수점 한 자리까지 적어줘.' },
    { id: 'physics/newton', intent: 'physics', block: 'diagram', expectNumbers: [5],
        q: '질량 2kg 물체에 알짜힘 10N이 작용할 때 가속도를 구하고, 자유물체도로도 보여줘. 가속도는 정수로 적어줘.' },

    // --- biology: 3D structure preferred over sequence (prompt.ts SELECTION RULE) ---
    { id: 'biology/hemoglobin', intent: 'biology', block: 'bio', pdb: true, expectNumbers: [4],
        q: '헤모글로빈의 3차원 단백질 구조를 보여주고, 헤모글로빈이 몇 개의 폴리펩타이드 사슬로 이루어져 있는지도 알려줘.' },
    { id: 'biology/insulin', intent: 'biology', block: 'bio', pdb: true, expectNumbers: [21],
        q: '인슐린의 3차원 단백질 구조를 보여주고, 인슐린 A사슬의 아미노산이 몇 개인지도 알려줘.' },

    // --- astronomy: star map with real connecting lines ---
    { id: 'astronomy/cassiopeia', intent: 'astronomy', block: 'constellation', lines: true, expectNumbers: [5],
        q: '카시오페이아자리를 별자리 지도로 보여주고, W 모양을 이루는 주요 별이 몇 개인지도 알려줘.' },
    { id: 'astronomy/big-dipper', intent: 'astronomy', block: 'constellation', lines: true, expectNumbers: [7],
        q: '북두칠성을 별자리 지도로 보여주고, 북두칠성을 이루는 별이 몇 개인지도 알려줘.' },

    // --- medical_qa: standard reference values, both bounds required ---
    { id: 'medical_qa/resting-heart-rate', intent: 'medical_qa', expectNumbers: [60, 100],
        q: '성인의 정상 안정시 심박수 범위를 분당 횟수(bpm)의 하한과 상한으로 알려줘.' },
    { id: 'medical_qa/rbc-lifespan', intent: 'medical_qa', expectNumbers: [120],
        q: '성인의 정상 적혈구 수명은 대략 며칠인가? 일 단위 숫자로 알려줘.' },
];

const BLOCK_RE = /```json:(\w+)\s*([\s\S]*?)```/g;

/** Digits that stand alone — so "4HHB" yields no 4 and "650" never satisfies an expected 65. */
const NUMBER_RE = /(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g;

const normalize = (value: string) => value.normalize('NFKC')
    .replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, '$1')
    .replace(/[\s{}$\\*_]/g, '')
    .toUpperCase();

export function score(tc: TC, text: string): Record<string, boolean> {
    const blocks = [...text.matchAll(BLOCK_RE)].map(m => {
        try { return { kind: m[1], data: JSON.parse(m[2]) as any }; }
        catch { return { kind: m[1], data: null }; }
    });
    // Renderer output must never be mistaken for the model stating the answer.
    const prose = text.replace(BLOCK_RE, ' ');
    const proseNumbers = (prose.match(NUMBER_RE) ?? []).map(Number);
    const proseText = normalize(prose);

    const checks: Record<string, boolean> = {
        nonempty: !!text.trim(),
        validJsonBlocks: blocks.every(b => b.data !== null),
    };
    if (tc.noBlocks) checks.noBlocks = blocks.length === 0;
    if (tc.expectNumbers) checks.expectedNumbers = tc.expectNumbers.every(n => proseNumbers.includes(n));
    if (tc.expectText) checks.expectedText = tc.expectText.every(s => proseText.includes(normalize(s)));

    if (tc.block) {
        const found = blocks.filter(b => b.kind === tc.block && b.data);
        checks.requiredBlock = found.length > 0
            && (!tc.pdb || found.some(b => b.data.type === 'pdb' && /^[0-9A-Za-z]{4}$/.test(b.data.data?.pdbId ?? '')))
            && (!tc.lines || found.some(b => (b.data.constellations ?? []).some((c: any) =>
                Array.isArray(c.lines) && c.lines.length > 0
                && c.lines.every((l: any) => Array.isArray(l) && l.length === 2 && l.every(Number.isInteger)))));
    }
    if (tc.chart) {
        const chart = blocks.find(b => b.kind === 'chart')?.data;
        checks.chartData = JSON.stringify(chart?.data?.categories) === JSON.stringify(tc.chart.categories)
            && chart?.data?.series?.length === 1
            && JSON.stringify(chart.data.series[0]?.data) === JSON.stringify(tc.chart.data);
    }
    return checks;
}

/** A case passes only when every one of its checks passes. */
export const passed = (checks: Record<string, boolean>) => Object.values(checks).every(Boolean);
