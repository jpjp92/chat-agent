/** Contrast checks for the intent scorer. A scorer that only accepts right answers is not enough —
 * each check below also proves it REJECTS a specific wrong answer. No network. */
import assert from 'node:assert/strict';
import { score, tcs, type TC } from './tc-intents.mjs';

const find = (id: string): TC => {
    const tc = tcs.find(t => t.id === id);
    if (!tc) throw new Error(`Unknown fixture ${id}`);
    return tc;
};
const chartBlock = (categories: string[], data: number[]) =>
    '```json:chart\n' + JSON.stringify({ type: 'bar', title: 't',
        data: { categories, series: [{ name: '값', data }] } }) + '\n```';
const bioBlock = (body: unknown) => '```json:bio\n' + JSON.stringify(body) + '\n```';
const skyBlock = (lines: number[][]) => '```json:constellation\n' + JSON.stringify({
    stars: [{ id: 0, ra: 1, dec: 2, mag: 3 }], constellations: [{ id: 'x',
        name: { ko: 'ㄱ', en: 'x', es: 'x', fr: 'x' }, lines }] }) + '\n```';

let n = 0;
const check = (label: string, actual: unknown, expected: unknown) => { n++; assert.deepEqual(actual, expected, label); };

// --- general: numeric answers must match as whole numbers, not substrings ---
const g1 = find('general/pencils');           // 12 * 7 - 19 = 65
check('65 accepted', score(g1, '남은 연필은 65자루입니다.').expectedNumbers, true);
check('650 rejected as substring', score(g1, '남은 연필은 650자루입니다.').expectedNumbers, false);
check('64 rejected', score(g1, '남은 연필은 64자루입니다.').expectedNumbers, false);
check('empty rejected', score(g1, '').nonempty, false);

// A renderer block in a general answer is a failure, not a bonus.
check('block in general rejected', score(g1, '65\n' + chartBlock(['A'], [1])).noBlocks, false);
check('no block accepted', score(g1, '65자루').noBlocks, true);

// --- data_viz: the chart must carry the requested values, not merely parse ---
const d2 = find('data_viz/derived');          // A=40, B=2A=80, C=A+B=120
check('exact chart accepted', score(d2, chartBlock(['A', 'B', 'C'], [40, 80, 120])).chartData, true);
check('wrong value rejected', score(d2, chartBlock(['A', 'B', 'C'], [40, 80, 100])).chartData, false);
check('wrong categories rejected', score(d2, chartBlock(['A', 'B'], [40, 80])).chartData, false);
check('malformed block rejected', score(d2, '```json:chart\n{nope}\n```').validJsonBlocks, false);
check('missing chart rejected', score(d2, '값은 40, 80, 120입니다.').requiredBlock, false);

// --- chemistry: formula recall survives LaTeX and subscript spellings, but not wrong atoms ---
const c1 = find('chemistry/acetic-acid');     // C2H4O2
const smiles = '```json:smiles\n{"smiles":"CC(=O)O","text":"acetic acid"}\n```';
check('plain formula accepted', score(c1, smiles + '\n분자식은 C2H4O2입니다.').expectedText, true);
check('latex formula accepted', score(c1, smiles + '\n$$\\text{C}_2\\text{H}_4\\text{O}_2$$').expectedText, true);
check('subscript formula accepted', score(c1, smiles + '\n분자식은 C₂H₄O₂입니다.').expectedText, true);
check('wrong formula rejected', score(c1, smiles + '\n분자식은 C2H6O2입니다.').expectedText, false);
check('missing smiles rejected', score(c1, '분자식은 C2H4O2입니다.').requiredBlock, false);

// --- physics: a decimal result is scored numerically, so 4.90 passes and 49 does not ---
const p1 = find('physics/incline');           // 9.8 * sin(30) = 4.9
const diagram = '```json:diagram\n{"type":"inclined_plane","angle":30}\n```';
check('4.9 accepted', score(p1, diagram + '\n가속도는 4.9 m/s^2 입니다.').expectedNumbers, true);
check('4.90 accepted', score(p1, diagram + '\n가속도는 4.90 m/s^2 입니다.').expectedNumbers, true);
check('49 rejected', score(p1, diagram + '\n가속도는 49 m/s^2 입니다.').expectedNumbers, false);

// The answer must be in the prose, not smuggled in from a diagram magnitude.
check('number only inside block rejected',
    score(p1, '```json:diagram\n{"type":"inclined_plane","forces":[{"magnitude":4.9}]}\n```\n가속도는 9.8입니다.').expectedNumbers, false);

// --- biology: a 3D structure is required, and the PDB id must not be read as the chain count ---
const b1 = find('biology/hemoglobin');        // pdb block + 4 chains
const pdb = bioBlock({ type: 'pdb', title: 'Hb', data: { pdbId: '4HHB', name: 'Hemoglobin' } });
check('pdb block accepted', score(b1, pdb + '\n사슬은 4개입니다.').requiredBlock, true);
check('sequence block rejected', score(b1, bioBlock({ type: 'sequence', title: 'Hb',
    data: { sequence: 'GIVEQ' } }) + '\n사슬은 4개입니다.').requiredBlock, false);
check('missing pdbId rejected', score(b1, bioBlock({ type: 'pdb', title: 'Hb', data: {} }) + '\n사슬은 4개입니다.').requiredBlock, false);
check('4HHB alone is not the chain count', score(b1, pdb + '\nPDB ID는 4HHB입니다.').expectedNumbers, false);

// --- astronomy: constellation lines must be real pairs, per the prompt's own CRITICAL JSON RULE ---
const a2 = find('astronomy/big-dipper');      // 7 stars
check('lines accepted', score(a2, skyBlock([[0, 1], [1, 2]]) + '\n별은 7개입니다.').requiredBlock, true);
check('empty lines rejected', score(a2, skyBlock([]) + '\n별은 7개입니다.').requiredBlock, false);

// --- medical_qa: every expected number is required, not just one of them ---
const m1 = find('medical_qa/resting-heart-rate');   // 60 and 100
check('both numbers accepted', score(m1, '정상 안정시 심박수는 60~100회/분입니다.').expectedNumbers, true);
check('one number rejected', score(m1, '정상 안정시 심박수는 60회/분 정도입니다.').expectedNumbers, false);

// --- fixture integrity: the suite is only meaningful if every intent is actually covered ---
const intents = [...new Set(tcs.map(t => t.intent))].sort();
check('7 generation intents covered', intents,
    ['astronomy', 'biology', 'chemistry', 'data_viz', 'general', 'medical_qa', 'physics']);
check('two cases per intent', intents.every(i => tcs.filter(t => t.intent === i).length === 2), true);
check('14 cases total', tcs.length, 14);
check('every case is scorable', tcs.every(t =>
    t.noBlocks || t.block || t.chart || t.expectNumbers?.length || t.expectText?.length), true);

console.log(`${n} scorer contrast assertions passed (right answers accepted, listed wrong answers rejected).`);
