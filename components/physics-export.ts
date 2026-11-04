/**
 * 물리 도해 PNG 저장 — 카드 안 SVG 를 복제해 제목·조건을 위에 붙이고 2배로 래스터화한다.
 * 도해 색은 Tailwind 클래스(`fill-slate-…`, `dark:`)·currentColor 로 칠해져 있어 복제본만으로는 색이 빠진다 —
 * 원본 요소의 계산된 스타일을 복제본 속성으로 옮긴다. 슬라이더·버튼은 SVG 밖이라 자연히 빠진다.
 */
const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity', 'fill-opacity', 'stroke-opacity',
    'font-size', 'font-weight', 'font-family', 'paint-order'] as const;

const inlineStyles = (src: Element, dst: Element) => {
    const cs = getComputedStyle(src);
    for (const p of PROPS) {
        const v = cs.getPropertyValue(p);
        if (v) dst.setAttribute(p, v);
    }
    dst.removeAttribute('class');
    for (let i = 0; i < src.children.length; i++) inlineStyles(src.children[i], dst.children[i]);
};

const renderPhysicsPng = async (svg: SVGSVGElement, opts: { title: string; sub: string }): Promise<Blob | null> => {
    const vb = svg.viewBox.baseVal;
    const W = 1200, scale = W / vb.width, head = 96, H = Math.round(vb.height * scale) + head;
    const card = svg.closest('figure') ?? svg;
    const bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
    const text = getComputedStyle(card).color || '#1e293b';

    const clone = svg.cloneNode(true) as SVGSVGElement;
    inlineStyles(svg, clone);
    // 투명 상태(선택 안 된 화살표 흐림)는 그대로 둔다 — 지금 화면 그대로 저장
    clone.setAttribute('x', '0'); clone.setAttribute('y', String(head));
    clone.setAttribute('width', String(W)); clone.setAttribute('height', String(H - head));

    const NS = 'http://www.w3.org/2000/svg';
    const root = document.createElementNS(NS, 'svg');
    root.setAttribute('xmlns', NS);
    root.setAttribute('width', String(W)); root.setAttribute('height', String(H));
    root.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%'); rect.setAttribute('fill', bg);
    root.appendChild(rect);
    const line = (y: number, s: string, size: number, weight: number, opacity = 1) => {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', '40'); t.setAttribute('y', String(y)); t.setAttribute('fill', text); t.setAttribute('opacity', String(opacity));
        t.setAttribute('font-size', String(size)); t.setAttribute('font-weight', String(weight));
        t.setAttribute('font-family', getComputedStyle(card).fontFamily || 'sans-serif');
        t.textContent = s;
        root.appendChild(t);
    };
    line(48, opts.title, 30, 700);
    line(82, opts.sub, 20, 400, 0.65);
    root.appendChild(clone);

    const data = new XMLSerializer().serializeToString(root);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = W * 2; canvas.height = H * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    return new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
};

export const downloadPhysicsPng = async (svg: SVGSVGElement, opts: { title: string; sub: string; filename: string }) => {
    const blob = await renderPhysicsPng(svg, opts);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = opts.filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
