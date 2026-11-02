/**
 * 물리 도해 SVG 시제품 — 운영 미반영. 기준: Claude 웹 샘플(방향·비례) + GPT 웹 샘플(카드 구성) + v2(계산 범위).
 * 계산은 physics-model.ts, 여기서는 물리 좌표 → 화면 좌표(y 반전)와 그리기만 한다.
 */
import React, { useState } from 'react';
import { incline, projectile, type Vec } from './physics-model';
import { inclineScene } from './incline-scene';

export type PhysicsData =
    | { type: 'inclined_plane'; title?: string; parameters: { angleDeg: number; massKg: number; mu?: number } }
    | { type: 'projectile'; title?: string; parameters: { launchDeg: number; speed: number } };

const C = { weight: '#e8963c', normal: '#2fb58a', friction: '#e0558b', comp: '#e2683c', velocity: '#5aa9f0', muted: 'var(--muted)', line: 'var(--border)' };
const LABEL: Record<string, string> = { weight: 'mg', normal: 'N', friction: 'f', parallel: 'mg sinθ', perpendicular: 'mg cosθ' };
const DESC: Record<string, string> = {
    weight: '중력 — 질량 × g, 언제나 수직 아래.',
    normal: '수직항력 — 면이 물체를 미는 힘. 면에 수직이고 크기는 mg cosθ.',
    friction: '마찰력 — 미끄러짐을 막는 방향(경사 위쪽).',
    parallel: '중력의 경사 방향 성분. 별도의 힘이 아니라 mg 를 나눈 것.',
    perpendicular: '중력의 면 수직 성분. 수직항력과 크기가 같고 방향이 반대.',
};
const f2 = (n: number) => n.toFixed(2);

const Arrow: React.FC<{ id: string; from: Vec; to: Vec; color: string; dashed?: boolean; sel: string | null; onSel: (id: string) => void;
    label?: { x: number; y: number; text: string; fontSize: number } }> =
    ({ id, from, to, color, dashed, sel, onSel, label }) => {
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
    if (len < 4) return null;
    const ux = dx / len, uy = dy / len, hl = 12;
    const head = `${to.x},${to.y} ${to.x - hl * ux + 6 * uy},${to.y - hl * uy - 6 * ux} ${to.x - hl * ux - 6 * uy},${to.y - hl * uy + 6 * ux}`;
    const on = sel === id, dim = sel !== null && !on;
    return (
        <g role="button" tabIndex={0} aria-label={`${LABEL[id] ?? id}: ${DESC[id] ?? ''}`} aria-pressed={on} opacity={dim ? 0.3 : 1}
            style={{ cursor: 'pointer', transition: 'opacity .2s' }} onClick={() => onSel(id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSel(id); } }}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={22} />
            <line x1={from.x} y1={from.y} x2={to.x - ux * hl * 0.6} y2={to.y - uy * hl * 0.6} stroke={color} strokeWidth={on ? 4.5 : 3}
                strokeDasharray={dashed ? '6 5' : undefined} strokeLinecap="round" />
            <polygon points={head} fill={color} />
            <text x={label?.x ?? to.x + ux * 18} y={label?.y ?? to.y + uy * 18} fill={color} fontSize={label?.fontSize ?? 15} fontWeight={700}
                textAnchor="middle" dominantBaseline="middle" className="phys-label">{label?.text ?? LABEL[id] ?? id}</text>
        </g>
    );
};

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (n: number) => void }> =
    ({ label, value, min, max, step, unit, onChange }) => (
    <label className="phys-slider"><span>{label}</span>
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={e => onChange(Number(e.target.value))} />
        <b>{step < 1 ? value.toFixed(2) : value}{unit}</b></label>
);

const Card: React.FC<{ title: string; sub: string; children: React.ReactNode; formula: string[]; note: string; onReset: () => void; detail: string | null }> =
    ({ title, sub, children, formula, note, onReset, detail }) => {
    const [open, setOpen] = useState(false);
    return (
        <figure className="phys">
            <header><div><h3>{title}</h3><p>{sub}</p></div><span className="phys-tag">Interactive</span></header>
            {children}
            <p className="phys-detail" aria-live="polite">{detail ?? '화살표를 누르면 그 힘의 뜻을 보여 줍니다'}</p>
            <button className="phys-fold" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'} 계산 및 해석</button>
            {open && <pre className="phys-formula">{formula.join('\n')}</pre>}
            <footer><span>{note}</span><button onClick={onReset}>↺ 초기화</button></footer>
        </figure>
    );
};

const W = 760, H = 440;

// 폰 폭에선 viewBox 의 빈 여백을 잘라 도해를 키운다 — 760 폭을 340px 에 그대로 넣으면 0.45배라 화살표·라벨이 읽히지 않는다
const useNarrow = () => {
    const q = typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)') : null;
    const [narrow, setNarrow] = useState(!!q?.matches);
    React.useEffect(() => {
        if (!q) return;
        const on = () => setNarrow(q.matches);
        q.addEventListener('change', on);
        return () => q.removeEventListener('change', on);
    }, []);
    return narrow;
};

const InclineView: React.FC<{ init: { angleDeg: number; massKg: number; mu?: number }; title?: string }> = ({ init, title }) => {
    const [angle, setAngle] = useState(init.angleDeg), [mass, setMass] = useState(init.massKg), [mu, setMu] = useState(init.mu ?? 0);
    const [tab, setTab] = useState<'forces' | 'components'>('forces');
    const [sel, setSel] = useState<string | null>(null);
    const r = incline({ angleDeg: angle, massKg: mass, mu });
    const pick = (id: string) => setSel(s => (s === id ? null : id));
    const narrow = useNarrow();
    const sc = inclineScene({ angleDeg: angle, massKg: mass, mu }, { tab, narrow });
    const vb = sc.viewBox, box = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
    const [o, top, foot] = sc.wedge;
    const t = (angle * Math.PI) / 180;
    const hasMu = init.mu !== undefined;
    return (
        <Card title={title ?? '경사면 위 물체의 운동'} sub={`Physics · 자유물체도 · ${hasMu ? `마찰 μ=${mu.toFixed(2)}` : '마찰 없는 경사면'}`}
            detail={sel ? `${LABEL[sel]} — ${DESC[sel]}` : null}
            onReset={() => { setAngle(init.angleDeg); setMass(init.massKg); setMu(init.mu ?? 0); setSel(null); }}
            note={`이상화 모델 · g = 9.81 m/s²${hasMu ? ' · μs=μk 로 단순화' : ''}`}
            formula={[
                `mg = ${f2(mass)} × 9.81 = ${f2(r.weight)} N`,
                `N = mg cosθ = ${f2(r.normalForce)} N`,
                `mg sinθ = ${f2(r.parallel)} N`,
                ...(hasMu ? [`μN = ${f2(mu * r.normalForce)} N → ${r.moves ? '미끄러짐' : '정지(정지 마찰로 평형)'}`] : []),
                `a = ${hasMu ? '(mg sinθ − f) / m' : 'g sinθ'} = ${f2(r.accel)} m/s²`,
            ]}>
            <div className="phys-tabs" role="tablist">
                {(['forces', 'components'] as const).map(id => (
                    <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setSel(null); }}>
                        {id === 'forces' ? '작용하는 힘' : '중력 성분 분해'}</button>))}
            </div>
            <svg viewBox={box} role="img" aria-label={`경사각 ${angle}도, 질량 ${mass}kg 경사면 자유물체도`}>
                <line x1={vb.x} y1={sc.floorY} x2={vb.x + vb.w} y2={sc.floorY} stroke={C.line} />
                <polygon points={`${o.x},${o.y} ${top.x},${top.y} ${foot.x},${foot.y}`} fill="var(--wedge)" stroke={C.line} strokeWidth={1.5} />
                <path d={`M ${o.x + 60} ${o.y} A 60 60 0 0 0 ${o.x + 60 * Math.cos(t)} ${o.y - 60 * Math.sin(t)}`} fill="none" stroke={C.muted} />
                <text x={sc.angleLabel.x} y={sc.angleLabel.y} fill="var(--text)" fontSize={narrow ? 24 : 14}>θ = {angle}°</text>
                <rect x={sc.block.c.x - sc.block.w / 2} y={sc.block.c.y - sc.block.h / 2} width={sc.block.w} height={sc.block.h} rx={8}
                    fill="#8b7cf0" fillOpacity={0.75} stroke="#c9c0ff" strokeWidth={2} transform={`rotate(${sc.block.rot} ${sc.block.c.x} ${sc.block.c.y})`} />
                {sc.arrows.map(a => (
                    <Arrow key={a.id} id={a.id} from={a.from} to={a.to} sel={sel} onSel={pick} dashed={a.dashed}
                        label={sc.labels.find(l => l.id === a.id)}
                        color={a.id === 'weight' ? C.weight : a.id === 'normal' ? C.normal : a.id === 'friction' ? C.friction : C.comp} />))}
            </svg>
            <p className="phys-caption">화살표 길이는 힘의 크기에 비례{narrow && tab === 'components' ? ' · mg∥ = mg sinθ, mg⊥ = mg cosθ' : ''}</p>
            <div className="phys-sliders">
                <Slider label="경사각 θ" value={angle} min={5} max={60} step={1} unit="°" onChange={setAngle} />
                <Slider label="질량 m" value={mass} min={0.5} max={20} step={0.5} unit=" kg" onChange={setMass} />
                {hasMu && <Slider label="마찰계수 μ" value={mu} min={0} max={1} step={0.05} unit="" onChange={setMu} />}
            </div>
            <dl className="phys-metrics">
                <div><dt>중력 mg</dt><dd>{f2(r.weight)} N</dd></div>
                <div><dt>수직항력 N</dt><dd>{f2(r.normalForce)} N</dd></div>
                <div><dt>경사 성분 mg sinθ</dt><dd>{f2(r.parallel)} N</dd></div>
                <div><dt>가속도 a</dt><dd>{f2(r.accel)} m/s²</dd></div>
            </dl>
        </Card>
    );
};

const ProjectileView: React.FC<{ init: { launchDeg: number; speed: number }; title?: string }> = ({ init, title }) => {
    const [deg, setDeg] = useState(init.launchDeg), [speed, setSpeed] = useState(init.speed), [frac, setFrac] = useState(0.5);
    const [sel, setSel] = useState<string | null>(null);
    const p = projectile({ launchDeg: deg, speed });
    const now = p.at(p.T * frac);
    // 가로·세로 같은 축척 — 모양이 실제 궤적과 같다
    const k = Math.min(560 / Math.max(p.R, 0.1), 280 / Math.max(p.H, 0.1));
    const ox = 90, oy = 370;
    const S = (q: Vec): Vec => ({ x: ox + q.x * k, y: oy - q.y * k });
    const pts = Array.from({ length: 121 }, (_, i) => { const q = S(p.at((p.T * i) / 120).pos); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');
    const b = S(now.pos), vs = 4;
    DESC.velocity = `순간 속도 vₓ=${f2(now.vel.x)}, vᵧ=${f2(now.vel.y)} m/s. 공기 저항이 없어 vₓ 는 일정.`;
    DESC.gravity = '중력 가속도 9.81 m/s² — 언제나 아래, 크기 일정.';
    LABEL.velocity = 'v(t)'; LABEL.gravity = 'g';
    const pick = (id: string) => setSel(s => (s === id ? null : id));
    const narrow = useNarrow();
    return (
        <Card title={title ?? '포물선 운동'} sub="Physics · 균일 중력 · 공기 저항 없음" detail={sel ? `${LABEL[sel]} — ${DESC[sel]}` : null}
            onReset={() => { setDeg(init.launchDeg); setSpeed(init.speed); setFrac(0.5); setSel(null); }}
            note="발사·착지 높이 0 m · 가로·세로 같은 축척"
            formula={[`x(t) = v₀ cosθ · t = ${f2(now.pos.x)} m`, `y(t) = v₀ sinθ · t − ½gt² = ${f2(now.pos.y)} m`,
                `T = 2v₀ sinθ / g = ${f2(p.T)} s`, `H = (v₀ sinθ)² / 2g = ${f2(p.H)} m`, `R = v₀² sin2θ / g = ${f2(p.R)} m`]}>
            <svg viewBox={narrow ? '50 40 680 370' : `0 0 ${W} ${H}`} role="img" aria-label={`발사각 ${deg}도, 초기속력 ${speed}m/s 포물선 운동`}>
                <line x1={50} y1={oy} x2={W - 40} y2={oy} stroke={C.line} />
                <polyline points={pts} fill="none" stroke="#9b87f5" strokeWidth={2.5} strokeDasharray="7 6" />
                <line x1={S({ x: p.R / 2, y: p.H }).x} y1={S({ x: p.R / 2, y: p.H }).y} x2={S({ x: p.R / 2, y: 0 }).x} y2={oy} stroke={C.muted} strokeDasharray="4 4" />
                <text x={S({ x: p.R / 2, y: p.H }).x - 8} y={(S({ x: p.R / 2, y: p.H }).y + oy) / 2} fill="var(--muted)" fontSize={13} textAnchor="end">H = {f2(p.H)} m</text>
                <text x={S({ x: p.R, y: 0 }).x} y={oy + 24} fill="var(--muted)" fontSize={13} textAnchor="middle">R = {f2(p.R)} m</text>
                <circle cx={b.x} cy={b.y} r={9} fill={C.weight} stroke="#fff" strokeWidth={2} />
                <Arrow id="velocity" from={b} to={{ x: b.x + now.vel.x * vs, y: b.y - now.vel.y * vs }} color={C.velocity} sel={sel} onSel={pick}
                    label={narrow ? { x: b.x + now.vel.x * vs + 30, y: b.y - now.vel.y * vs - 20, text: 'v(t)', fontSize: 26 } : undefined} />
                <Arrow id="gravity" from={b} to={{ x: b.x, y: b.y + 55 }} color={C.normal} sel={sel} onSel={pick}
                    label={narrow ? { x: b.x + 24, y: b.y + 75, text: 'g', fontSize: 26 } : undefined} />
            </svg>
            <div className="phys-sliders">
                <Slider label="발사각 θ" value={deg} min={10} max={80} step={1} unit="°" onChange={setDeg} />
                <Slider label="초기속력 v₀" value={speed} min={5} max={40} step={1} unit=" m/s" onChange={setSpeed} />
                <Slider label="시간 t" value={Number((p.T * frac).toFixed(2))} min={0} max={Number(p.T.toFixed(2))} step={0.01} unit=" s" onChange={n => setFrac(n / p.T)} />
            </div>
            <dl className="phys-metrics">
                <div><dt>비행 시간 T</dt><dd>{f2(p.T)} s</dd></div>
                <div><dt>최고 높이 H</dt><dd>{f2(p.H)} m</dd></div>
                <div><dt>사거리 R</dt><dd>{f2(p.R)} m</dd></div>
                <div><dt>현재 속력 |v|</dt><dd>{f2(Math.hypot(now.vel.x, now.vel.y))} m/s</dd></div>
            </dl>
        </Card>
    );
};

export const PhysicsSvg: React.FC<{ data: PhysicsData }> = ({ data }) =>
    data.type === 'projectile' ? <ProjectileView init={data.parameters} title={data.title} /> : <InclineView init={data.parameters} title={data.title} />;
