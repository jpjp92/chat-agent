/**
 * 수식 후처리 하니스 — `npx tsx tests/test-math-normalize.mts`
 *
 * 실제 렌더 체인(remark-parse → remark-math → remark-rehype → rehype-katex)을 그대로 돌려
 * **보정 전/후**를 비교한다. 판정 기준은 화면이 보는 것과 같다:
 *   · `katex-error` 노드 수 (빨간 원문)
 *   · 수식 노드 밖에 남아야 할 문장이 실제로 밖에 있는가 (삼켜졌는가)
 *
 * 실측(2026-10-09, GPT-5.6 이미지 분석): 줄 첫머리 `$$식$$ 문장` 이 디스플레이 블록으로
 * 열려 답변 끝까지 삼켜졌다 → 후반부 전체가 빨간 원문.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import { splitInlineDisplayMath } from '../utils/mathNormalize.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};

type Render = { errors: number; mathNodes: number; proseText: string };
const render = (md: string): Render => {
    const proc = unified().use(remarkParse).use(remarkMath).use(remarkRehype).use(rehypeKatex);
    const tree: any = proc.runSync(proc.parse(md));
    let errors = 0, mathNodes = 0, proseText = '';
    const walk = (n: any, inMath: boolean) => {
        const cls: string[] = n.properties?.className ?? [];
        if (cls.includes('katex-error')) errors++;
        const isMath = cls.includes('katex') || cls.includes('katex-display') || cls.includes('katex-error');
        if (isMath && !inMath) mathNodes++;
        if (n.type === 'text' && !inMath && !isMath) proseText += n.value;
        for (const c of n.children ?? []) walk(c, inMath || isMath);
    };
    walk(tree, false);
    return { errors, mathNodes, proseText };
};

// ── ① 실측 재현: 보정 전에는 깨지고, 보정 후에는 고쳐져야 한다 ─────────────────
// 스크린샷(GPT-5.6) 후반부를 그대로 옮겼다. 줄바꿈 위치도 실제 응답과 같은 꼴.
const REAL = [
    '### 8. 출력층과 소프트맥스',
    '',
    '마지막 은닉 상태를 어휘 크기의 로짓으로 바꾼 뒤 확률로 변환합니다.',
    '',
    '$$p_i=\\frac{\\exp(z_i)}',
    '{\\sum_{j=1}^{V}\\exp(z_j)}$$ 추론 과정에서는 확률이 가장 높은 토큰을 선택하거나 별도의 디코딩 전략을 사용합니다.',
    '',
    '### 9. 학습 목표',
    '',
    '모델은 지금까지 나온 토큰을 이용해 다음 토큰을 예측하도록 학습합니다.',
    '',
    '$$P(x_t\\mid x_1,\\ldots,x_{t-1})=\\mathrm{softmax}(z_t)$$ 학습 손실은 크로스엔트로피입니다.',
    '',
    '$$\\mathcal{L}=-\\frac{1}{n}\\sum_{t=1}^{n}\\log P(x_t\\mid x_1,\\ldots,x_{t-1})$$',
    '',
    '> **한 줄 요약**',
    '> 디코더 전용 트랜스포머 LLM은 다음 토큰의 확률을 예측하도록 학습합니다.',
].join('\n');

console.log('── ① 실측 재현 ──');
const before = render(REAL);
const after = render(splitInlineDisplayMath(REAL));
console.log(`   보정 전: katex-error ${before.errors} · 수식 ${before.mathNodes}`);
console.log(`   보정 후: katex-error ${after.errors} · 수식 ${after.mathNodes}`);
check('보정 전에는 결함이 재현된다 (하니스가 실패할 수 있음을 증명)',
    before.errors > 0 || !before.proseText.includes('학습 목표'),
    JSON.stringify({ errors: before.errors }));
check('보정 후 katex-error 0', after.errors === 0, `errors=${after.errors}`);
for (const must of ['추론 과정에서는', '학습 목표', '학습 손실은', '한 줄 요약']) {
    check(`보정 후 "${must}" 가 수식 밖 본문에 있다`, after.proseText.includes(must));
}
check('보정 후 수식 3개가 각각 렌더된다', after.mathNodes === 3, `mathNodes=${after.mathNodes}`);

// ── ①-b 실측 2: 펜스 블록 + 목록 항목 (GPT-5.6, 2026-10-09) ─────────────────
// 첫 버전 정규식이 **닫는 펜스 `$$`** 를 여는 줄로 오인해 `- ` 를 식으로 묶었다 →
// 빈 불릿 + `n$$: 토큰 개수…` 빨간 원문 + 이후 `$$` 짝이 한 칸씩 밀려 한글이 수식 상자로.
const REAL2 = [
    '입력 토큰을 벡터로 바꾼 행렬을 다음과 같이 둡니다.',
    '$$', 'X \\in \\mathbb{R}^{n\\times d_{\\text{model}}}', '$$',
    '- $$n$$: 토큰 개수',
    '- $$d_{\\text{model}}$$: 임베딩 차원',
    '',
    '예를 들어 토큰이 4개이고 임베딩 차원이 512라면,',
    '$$', 'X \\in \\mathbb{R}^{4 \\times 512}', '$$',
    '입니다.', '', '---', '', '## 2. 쿼리, 키, 밸류 계산', '',
    '각 행에 소프트맥스를 적용합니다.',
    '$$', 'A=\\mathrm{softmax}(S)', '$$',
    '행 $$i$$에 대한 원소별 표현은 다음과 같습니다.',
    '$$', 'S\\in\\mathbb{R}^{n\\times n}', '$$',
    '그러면 점수 행렬의 크기는 다음과 같습니다.',
].join('\n');
console.log('\n── ①-b 실측 2 (펜스 + 목록) ──');
const after2 = render(splitInlineDisplayMath(REAL2));
check('펜스 + 목록: katex-error 0', after2.errors === 0, `errors=${after2.errors}`);
for (const must of ['토큰 개수', '임베딩 차원', '쿼리, 키, 밸류', '원소별 표현은', '그러면 점수 행렬의']) {
    check(`펜스 + 목록: "${must}" 가 수식 밖 본문에 있다`, after2.proseText.includes(must));
}
check('펜스 + 목록: 이미 정상인 입력은 바이트 동일', splitInlineDisplayMath(REAL2) === REAL2);

// ── ② 바뀌면 안 되는 입력 — 바이트 동일 ─────────────────────────────────────
console.log('\n── ② 불변 ──');
const UNCHANGED: Array<[string, string]> = [
    ['문장 중간 인라인', '질량은 $$m$$ 이고 힘은 $$F=ma$$ 입니다.'],
    ['통화', '가격은 $5 이고 할인 후 $3 입니다.'],
    ['정상 블록', '앞 문장.\n\n$$\nE=mc^2\n$$\n\n뒤 문장.'],
    ['줄 단독 한 줄 수식', '앞 문장.\n\n$$E=mc^2$$\n\n뒤 문장.'],
    ['수식 없음', '그냥 문장입니다.\n\n### 제목\n\n- 항목'],
    ['코드 블록 안 달러', '```bash\necho $HOME\n```'],
];
for (const [name, md] of UNCHANGED) {
    check(`불변  ${name}`, splitInlineDisplayMath(md) === md, JSON.stringify(splitInlineDisplayMath(md)));
}

// ── ③ 고쳐야 하는 변형들 — 렌더 결과로 판정 ────────────────────────────────
console.log('\n── ③ 변형 ──');
const VARIANTS: Array<[string, string, string]> = [
    ['한 줄 식 + 문장', '$$a^2+b^2=c^2$$ 피타고라스 정리입니다.\n\n### 다음', '피타고라스'],
    ['들여쓰기', '  $$x=1$$ 그래서 x 는 1 입니다.\n\n끝 문단', '그래서'],
    ['문서 첫 줄', '$$y=2x$$ 기울기는 2 입니다.', '기울기'],
    ['같은 줄 뒤에 인라인 수식', '$$a=1$$ 그리고 $$b=2$$ 입니다.\n\n### 끝', '그리고'],
    ['여러 줄 식 + 문장', '$$\nf(x)=\n x^2\n$$ 이 함수는 포물선입니다.\n\n끝', '포물선'],
    ['줄바꿈 낀 식 + 문장', '$$p=\\frac{a}\n{b}$$ 추론 과정입니다.\n\n끝', '추론 과정'],
];
for (const [name, md, prose] of VARIANTS) {
    const r = render(splitInlineDisplayMath(md));
    check(`변형  ${name}: katex-error 0 · "${prose}" 본문`, r.errors === 0 && r.proseText.includes(prose),
        JSON.stringify({ errors: r.errors, out: splitInlineDisplayMath(md) }));
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
