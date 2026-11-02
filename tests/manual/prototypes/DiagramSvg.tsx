/**
 * DiagramRenderer SVG 시제품 — 운영 미반영. 비교: tests/manual/compare-diagram-svg.mts
 * 같은 json:diagram 계약을 받는다(하위 호환). 차이: 요소가 DOM 이라 선택·키보드·스크린리더가 되고,
 * 파라미터 슬라이더로 그림을 다시 계산한다.
 */
import React, { useMemo, useState } from 'react';

interface Force { label: string; angle: number; magnitude: number; color: string }
interface CollisionObject { label: string; mass?: string; velocity: number; color: string }
export interface DiagramData {
    title?: string;
    type: 'inclined_plane' | 'free_body' | 'projectile' | 'collision';
    angle?: number; showBaseline?: boolean; showAngle?: boolean; forces?: Force[];
    object?: { shape?: 'circle' | 'rectangle'; label?: string };
    launchAngle?: number; label?: string; showComponents?: boolean;
    before?: CollisionObject[]; after?: CollisionObject[]; elastic?: boolean;
}

const W = 800, H = 500;
const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const Arrow: React.FC<{ x1: number; y1: number; x2: number; y2: number; color: string; label?: string; lx?: number; ly?: number;
    dashed?: boolean; active?: boolean; dim?: boolean; onSelect?: () => void }> =
    ({ x1, y1, x2, y2, color, label, lx, ly, dashed, active, dim, onSelect }) => {
    const a = Math.atan2(y2 - y1, x2 - x1), hl = 14;
    const p = `${x2},${y2} ${x2 - hl * Math.cos(a - Math.PI / 6)},${y2 - hl * Math.sin(a - Math.PI / 6)} ${x2 - hl * Math.cos(a + Math.PI / 6)},${y2 - hl * Math.sin(a + Math.PI / 6)}`;
    const interactive = !!onSelect;
    return (
        <g opacity={dim ? 0.25 : 1} style={{ cursor: interactive ? 'pointer' : undefined, transition: 'opacity .2s' }}
            role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined} aria-label={label}
            aria-pressed={interactive ? !!active : undefined}
            onClick={onSelect} onKeyDown={e => { if (interactive && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect!(); } }}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={22} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={active ? 5 : 3.5} strokeLinecap="round" strokeDasharray={dashed ? '6 4' : undefined} />
            <polygon points={p} fill={color} />
            {label && <text x={clamp(lx ?? x2 + Math.cos(a) * 22, 30, W - 30)} y={clamp(ly ?? y2 + Math.sin(a) * 22, 16, H - 16)}
                fill={color} fontSize={15} fontWeight={700} textAnchor="middle" dominantBaseline="middle">{label}</text>}
        </g>
    );
};

const Slider: React.FC<{ label: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({ label, value, min, max, onChange }) => (
    <label className="dsvg-slider">
        <span>{label} <b>{value}°</b></span>
        <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
);

export const DiagramSvg: React.FC<{ data: DiagramData }> = ({ data }) => {
    const [sel, setSel] = useState<number | null>(null);
    const [angle, setAngle] = useState(clamp(data.angle ?? 30, 5, 70));
    const [launch, setLaunch] = useState(clamp(data.launchAngle ?? 45, 5, 85));
    const toggle = (i: number) => setSel(s => (s === i ? null : i));
    const forces = data.forces ?? [];

    const body = useMemo(() => {
        switch (data.type) {
            case 'free_body': {
                const cx = W / 2, cy = H / 2, R = 46;
                const fScale = Math.min(115, 140 / Math.max(1, ...forces.map(f => f.magnitude)));
                return (<>
                    {data.object?.shape === 'rectangle'
                        ? <rect x={cx - 64} y={cy - 64} width={128} height={128} className="dsvg-obj" />
                        : <circle cx={cx} cy={cy} r={R} className="dsvg-obj" />}
                    {data.object?.label && <text x={cx} y={cy} className="dsvg-text" textAnchor="middle" dominantBaseline="middle" fontWeight={700}>{data.object.label}</text>}
                    {forces.map((f, i) => {
                        const dx = Math.cos(rad(f.angle)), dy = -Math.sin(rad(f.angle));
                        const sx = cx + dx * (R + 6), sy = cy + dy * (R + 6), ex = sx + dx * f.magnitude * fScale, ey = sy + dy * f.magnitude * fScale;
                        return <Arrow key={i} x1={sx} y1={sy} x2={ex} y2={ey} color={f.color} label={f.label} lx={ex + dx * 30} ly={ey + dy * 30}
                            active={sel === i} dim={sel !== null && sel !== i} onSelect={() => toggle(i)} />;
                    })}
                </>);
            }
            case 'projectile': {
                // 실제 비율 H/R = tanθ/4 를 지킨 채 상자에 맞춘다 — canvas 판은 높이를 280px 로 잘라 급각에서 모양이 틀린다
                const th = rad(launch), ratio = Math.tan(th) / 4;
                const range = Math.min(640, 320 / ratio), peak = range * ratio;
                const sx = 80, gy = 420, ex = sx + range, px = sx + range / 2, py = gy - peak;
                const v0 = Math.min(95, peak * 0.75 + 30), vx = Math.cos(th) * v0, vy = Math.sin(th) * v0;
                const pts = Array.from({ length: 101 }, (_, i) => { const f = i / 100; return `${sx + f * range},${gy - 4 * peak * f * (1 - f)}`; }).join(' ');
                return (<>
                    <line x1={40} y1={gy} x2={W - 40} y2={gy} className="dsvg-border" strokeWidth={2} />
                    <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeDasharray="8 4" />
                    <circle cx={sx} cy={gy} r={9} fill="#2563eb" />
                    <text x={sx + 13} y={gy - 8} className="dsvg-text" fontWeight={700}>{data.label ?? data.object?.label ?? '물체'}</text>
                    <Arrow x1={sx} y1={gy} x2={sx + vx} y2={gy - vy} color="#d97706" label="v₀" />
                    {data.showComponents !== false && <>
                        <Arrow x1={sx} y1={gy} x2={sx + vx} y2={gy} color="#10b981" label="vₓ" lx={sx + vx / 2} ly={gy + 20} dashed />
                        <Arrow x1={sx + vx} y1={gy} x2={sx + vx} y2={gy - vy} color="#f43f5e" label="v₀y" lx={sx + vx + 30} ly={gy - vy / 2} dashed />
                        <path d={`M ${sx + 50} ${gy} A 50 50 0 0 0 ${sx + 50 * Math.cos(th)} ${gy - 50 * Math.sin(th)}`} fill="none" className="dsvg-border" strokeWidth={1.5} />
                        <text x={sx + 58} y={gy - 22} className="dsvg-text" fontWeight={700}>θ={launch}°</text>
                    </>}
                    <circle cx={px} cy={py} r={6} fill="#7c3aed" /><text x={px} y={py - 10} className="dsvg-text" textAnchor="middle">최고점</text>
                    <line x1={px} y1={py} x2={px} y2={gy} className="dsvg-muted" strokeDasharray="4 3" />
                    <text x={px + 6} y={(py + gy) / 2} className="dsvg-mutedtext">H</text>
                    <circle cx={ex} cy={gy} r={8} fill="#dc2626" /><text x={ex} y={gy + 24} className="dsvg-text" textAnchor="middle">착지점</text>
                    <line x1={sx} y1={gy + 45} x2={ex} y2={gy + 45} className="dsvg-muted" />
                    <text x={(sx + ex) / 2} y={gy + 64} className="dsvg-mutedtext" textAnchor="middle">수평 이동 거리 (R) · H/R = {ratio.toFixed(2)}</text>
                </>);
            }
            case 'collision': {
                const mid = W / 2, R = 32;
                const group = (objs: CollisionObject[], cx: number, k: string) => objs.map((o, i) => {
                    const sp = Math.min(130, (H - 80) / Math.max(objs.length, 1)), oy = H / 2 - (objs.length - 1) * sp / 2 + i * sp;
                    const dir = o.velocity > 0 ? 1 : -1, len = Math.min(Math.abs(o.velocity) * 55, 145), ax = cx + dir * (R + 8);
                    return (<g key={k + i}>
                        <circle cx={cx} cy={oy} r={R} fill={o.color + '44'} stroke={o.color} strokeWidth={2.5} />
                        <text x={cx} y={oy - 6} className="dsvg-text" textAnchor="middle" fontWeight={700} fontSize={12}>{o.label}</text>
                        {o.mass && <text x={cx} y={oy + 10} className="dsvg-mutedtext" textAnchor="middle" fontSize={11}>{o.mass}</text>}
                        {Math.abs(o.velocity) > 0.001
                            ? <Arrow x1={ax} y1={oy} x2={ax + dir * len} y2={oy} color={o.color} label={`${o.velocity > 0 ? '+' : ''}${o.velocity}m/s`} lx={ax + dir * len / 2} ly={oy - 22} />
                            : <text x={cx} y={oy + R + 16} className="dsvg-mutedtext" textAnchor="middle">v = 0</text>}
                    </g>);
                });
                return (<>
                    <text x={mid / 2} y={30} className="dsvg-text" textAnchor="middle" fontWeight={700} fontSize={16}>충돌 전</text>
                    <text x={mid * 1.5} y={30} className="dsvg-text" textAnchor="middle" fontWeight={700} fontSize={16}>충돌 후</text>
                    <line x1={mid} y1={12} x2={mid} y2={H - 12} className="dsvg-border" strokeDasharray="6 4" />
                    {data.elastic !== undefined && <text x={mid} y={H / 2 + 26} className="dsvg-mutedtext" textAnchor="middle" fontSize={11}>{data.elastic ? '완전탄성충돌' : '비탄성충돌'}</text>}
                    {group(data.before ?? [], mid / 2, 'b')}{group(data.after ?? [], mid * 1.5, 'a')}
                </>);
            }
            default: {
                // 경사면: 라벨 키워드로 역할을 고르되, 못 고른 힘도 angle 그대로 그린다 — canvas 판은 키워드 밖 라벨(es·fr 등)을 버린다
                const t = rad(angle), left = 120, base = H - 100, box = 60;
                const len = Math.min(500, (base - 60) / Math.max(Math.sin(t), 0.1));
                const rx = left + len * Math.cos(t), ty = base - len * Math.sin(t);
                const along = len * 0.45, bx = left + along * Math.cos(t), by = base - along * Math.sin(t);
                const cx = bx - (box / 2) * Math.sin(t), cy = by - (box / 2) * Math.cos(t);
                const roles: [string[], (l: number) => [number, number]][] = [
                    [['중력', 'mg', 'gravity'], l => [cx, cy + l]],
                    [['수직항력', 'normal', 'N)'], l => [cx - l * Math.sin(t), cy - l * Math.cos(t)]],
                    [['평행', 'parallel', 'sinθ'], l => [cx + l * Math.cos(t), cy + l * Math.sin(t)]],
                    [['수직 분력', 'perpendicular', 'cosθ'], l => [cx + l * Math.sin(t), cy + l * Math.cos(t)]],
                    [['마찰', 'friction'], l => [cx - l * Math.cos(t), cy - l * Math.sin(t)]],
                ];
                return (<>
                    {data.showBaseline !== false && <line x1={50} y1={base} x2={W - 50} y2={base} className="dsvg-border" strokeWidth={1.5} />}
                    <polygon points={`${left},${base} ${rx},${ty} ${rx},${base}`} className="dsvg-wedge" />
                    {data.showAngle !== false && <>
                        <path d={`M ${left + 80} ${base} A 80 80 0 0 0 ${left + 80 * Math.cos(t)} ${base - 80 * Math.sin(t)}`} fill="none" className="dsvg-border" strokeWidth={2} />
                        <text x={left + 104 * Math.cos(t / 2)} y={base - 56 * Math.sin(t / 2)} className="dsvg-text" fontSize={22} fontWeight={700} textAnchor="middle">θ={angle}°</text>
                    </>}
                    <rect x={cx - box / 2} y={cy - box / 2} width={box} height={box} className="dsvg-obj" transform={`rotate(${-angle} ${cx} ${cy})`} />
                    {forces.map((f, i) => {
                        const role = roles.find(([ks]) => ks.some(k => f.label.includes(k)));
                        const l = f.magnitude * 110;
                        const [x2, y2] = role ? role[1](l) : [cx + Math.cos(rad(f.angle)) * l, cy - Math.sin(rad(f.angle)) * l];
                        return <Arrow key={i} x1={cx} y1={cy} x2={x2} y2={y2} color={f.color} label={f.label}
                            active={sel === i} dim={sel !== null && sel !== i} onSelect={() => toggle(i)} />;
                    })}
                </>);
            }
        }
    }, [data, angle, launch, sel]);

    const picked = sel !== null ? forces[sel] : null;
    return (
        <figure className="dsvg">
            <figcaption>{data.title ?? data.type}</figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${data.title ?? data.type} 다이어그램`}>{body}</svg>
            {data.type === 'inclined_plane' && <Slider label="경사각" value={angle} min={5} max={70} onChange={setAngle} />}
            {data.type === 'projectile' && <Slider label="발사각" value={launch} min={5} max={85} onChange={setLaunch} />}
            {forces.length > 0 && <p className="dsvg-detail" aria-live="polite">
                {picked ? <><b style={{ color: picked.color }}>{picked.label}</b> · 방향 {picked.angle}° · 상대 크기 {picked.magnitude}</> : '화살표를 누르면 그 힘만 강조됩니다'}
            </p>}
        </figure>
    );
};
