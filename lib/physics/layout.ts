/** 도해 배치 공용 — 라벨 사각형·겹침 판정·내용 맞춤 viewBox. 경사면·포물선 장면이 같이 쓴다. */
import type { Vec } from './model';

export type Rect = { x: number; y: number; w: number; h: number };

export const textRect = (cx: number, cy: number, text: string, fs: number): Rect => {
    const w = [...text].length * fs * 0.62 + 6, h = fs * 1.15;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
};
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inside = (r: Rect, v: Rect) => r.x >= v.x && r.y >= v.y && r.x + r.w <= v.x + v.w && r.y + r.h <= v.y + v.h;
export const hitsSegment = (r: Rect, p: Vec, q: Vec) => {
    for (let i = 0; i <= 12; i++) {
        const x = p.x + (q.x - p.x) * i / 12, y = p.y + (q.y - p.y) * i / 12;
        if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
    }
    return false;
};
export const bounds = (pts: Vec[], rects: Rect[]): Rect => {
    const xs = [...pts.map(p => p.x), ...rects.flatMap(r => [r.x, r.x + r.w])], ys = [...pts.map(p => p.y), ...rects.flatMap(r => [r.y, r.y + r.h])];
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
// 가로세로 비율 고정 — 폭이 정해진 카드 안에서 도해 높이가 답마다 들쭉날쭉하지 않게.
// maxAspect 를 주면 그 비율까지는 납작해지는 것을 허용한다 — 낮은 발사각 포물선은 고정 비율이면 위아래가 절반 넘게 비었다
export const fitViewBox = (content: Rect, narrow: boolean, maxAspect?: number): Rect => {
    const aspect = narrow ? 620 / 380 : 760 / 440, pad = narrow ? 20 : 30;
    let w = content.w + pad * 2, h = content.h + pad * 2;
    if (w / h < aspect) w = h * aspect;
    else if (w / h > (maxAspect ?? aspect)) h = w / (maxAspect ?? aspect);
    return { x: content.x + content.w / 2 - w / 2, y: content.y + content.h / 2 - h / 2, w, h };
};
