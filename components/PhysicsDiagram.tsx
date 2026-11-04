'use client';
import React, { useEffect, useState } from 'react';
import { incline, type Vec } from '../lib/physics/model';
import { projectileScene } from '../lib/physics/projectile-scene';
import { collisionScene } from '../lib/physics/collision-scene';
import { freeBodyScene } from '../lib/physics/freebody-scene';
import type { BodyForce, CollisionParams } from '../lib/physics/model';
import { inclineScene } from '../lib/physics/incline-scene';
import { RANGE, SLIDER, sliderRange, type PhysicsData } from '../lib/physics/params';

/**
 * 물리 도해 SVG — json:diagram 의 `parameters` 형식(PLAN_PHYSICS_SVG_261103).
 * 좌표·라벨 자리는 lib/physics 가 계산하고 여기서는 그리기만 한다. 옛 형식은 그리지 않고 LegacyDiagramNotice 로 안내한다.
 */

type Lang = 'ko' | 'en' | 'es' | 'fr';

const COLOR: Record<string, string> = { weight: '#e8963c', normal: '#2fb58a', friction: '#e0558b', parallel: '#e2683c', perpendicular: '#e2683c', velocity: '#5aa9f0', v0: '#5aa9f0', gravity: '#2fb58a' };
const LABEL: Record<string, string> = { weight: 'mg', normal: 'N', friction: 'f', parallel: 'mg sinθ', perpendicular: 'mg cosθ', velocity: 'v(t)', v0: 'v₀', gravity: 'g' };

const I18N = {
    ko: {
        incline: '경사면 위 물체의 운동', projectile: '포물선 운동', formula: '계산 및 해석', reset: '초기화', hint: '화살표를 누르면 그 힘의 뜻을 보여 줍니다', hintMotion: '화살표를 누르면 설명을 보여 줍니다',
        forces: '작용하는 힘', components: '중력 성분 분해', noFriction: '마찰 없는 경사면', scale: '화살표 길이는 힘의 크기에 비례',
        angle: '경사각 θ', mass: '질량 m', mu: '마찰계수 μ', launch: '발사각 θ', speed: '초기속력 v₀', time: '시간 t',
        weight: '중력 mg', normalF: '수직항력 N', parallel: '경사 성분 mg sinθ', accel: '가속도 a', T: '비행 시간 T', H: '최고 높이 H', R: '사거리 R', v: '현재 속력 |v|',
        slides: '미끄러짐', stays: '정지(정지 마찰로 평형)', ideal: '이상화 모델 · g = 9.81 m/s²', muNote: ' · μs=μk 로 단순화', projNote: '발사·착지 높이 0 m · 가로·세로 같은 축척',
        collision: '충돌', before: '충돌 전', after: '충돌 후', still: '정지', m1: '질량 m₁', m2: '질량 m₂', v1: '속도 v₁', v2: '속도 v₂', e: '반발계수 e',
        elastic: '탄성 충돌', inelastic: '비탄성 충돌', perfectly_inelastic: '완전비탄성 충돌', noHit: '서로 멀어져 충돌하지 않음',
        pBefore: '운동량 (전)', pAfter: '운동량 (후)', keLoss: '운동에너지 손실', after1: '충돌 후 v₁′', after2: '충돌 후 v₂′', afterV: '충돌 후 함께 V',
        colNote: '1차원 · 오른쪽이 + 방향 · 화살표 길이는 속도에 비례', hintCol: '슬라이더로 질량·속도를 바꿔 보세요',
        freeBody: '자유물체도', net: '알짜힘', balanced: '평형 (알짜힘 0)', showNet: '알짜힘 표시', fbNote: '각도: 0° = 오른쪽, 90° = 위',
        fbNoteRel: '크기가 주어지지 않아 화살표 길이는 같게 그림', forceCount: (n: number) => `힘 ${n}개`,
        desc: {
            weight: '중력 — 질량 × g, 언제나 수직 아래.', normal: '수직항력 — 면이 물체를 미는 힘. 면에 수직이고 크기는 mg cosθ.',
            friction: '마찰력 — 미끄러짐을 막는 방향(경사 위쪽).', parallel: '중력의 경사 방향 성분. 별도의 힘이 아니라 mg 를 나눈 것.',
            perpendicular: '중력의 면 수직 성분. 수직항력과 크기가 같고 방향이 반대.', velocity: '순간 속도. 공기 저항이 없어 수평 성분은 일정.',
            gravity: '중력 가속도 9.81 m/s² — 언제나 아래, 크기 일정.', v0: '초기 속도 — 발사각 θ 방향, 크기 v₀.',
            tension: '장력 — 줄이 물체를 당기는 힘, 줄 방향.', buoyancy: '부력 — 밀어낸 유체의 무게만큼 위로.', drag: '항력 — 유체 속 운동을 거스르는 힘.',
            applied: '가한 힘 — 외부에서 미는·당기는 힘.', spring: '탄성력 — 늘어나거나 줄어든 반대 방향.', other: '문제에서 주어진 힘.', net: '알짜힘 — 모든 힘의 벡터 합. 가속도 방향과 같다.',
        } as Record<string, string>,
    },
    en: {
        incline: 'Block on an Inclined Plane', projectile: 'Projectile Motion', formula: 'Calculation', reset: 'Reset', hint: 'Tap an arrow to see what that force means', hintMotion: 'Tap an arrow for an explanation',
        forces: 'Forces', components: 'Gravity components', noFriction: 'Frictionless incline', scale: 'Arrow length is proportional to force',
        angle: 'Angle θ', mass: 'Mass m', mu: 'Friction μ', launch: 'Launch θ', speed: 'Speed v₀', time: 'Time t',
        weight: 'Gravity mg', normalF: 'Normal N', parallel: 'Along slope mg sinθ', accel: 'Accel. a', T: 'Flight time T', H: 'Max height H', R: 'Range R', v: 'Speed |v|',
        slides: 'slides', stays: 'stays (static friction balances)', ideal: 'Idealized model · g = 9.81 m/s²', muNote: ' · μs=μk assumed', projNote: 'Launch and landing at 0 m · equal axis scale',
        collision: 'Collision', before: 'Before', after: 'After', still: 'at rest', m1: 'Mass m₁', m2: 'Mass m₂', v1: 'Velocity v₁', v2: 'Velocity v₂', e: 'Restitution e',
        elastic: 'Elastic collision', inelastic: 'Inelastic collision', perfectly_inelastic: 'Perfectly inelastic', noHit: 'Moving apart — no collision',
        pBefore: 'Momentum (before)', pAfter: 'Momentum (after)', keLoss: 'KE lost', after1: 'After v₁′', after2: 'After v₂′', afterV: 'After, together V',
        colNote: '1-D · right is + · arrow length ∝ speed', hintCol: 'Change mass and velocity with the sliders',
        freeBody: 'Free-body diagram', net: 'Net force', balanced: 'Balanced (net force 0)', showNet: 'Show net force', fbNote: 'Angles: 0° = right, 90° = up',
        fbNoteRel: 'No magnitudes given — arrows drawn equal length', forceCount: (n: number) => `${n} forces`,
        desc: {
            weight: 'Gravity — mass × g, always straight down.', normal: 'Normal force — the surface pushing back, perpendicular to it, magnitude mg cosθ.',
            friction: 'Friction — opposes sliding (up the slope).', parallel: 'Component of gravity along the slope — part of mg, not a separate force.',
            perpendicular: 'Component of gravity into the surface — equal and opposite to N.', velocity: 'Instantaneous velocity. No air drag, so the horizontal part is constant.',
            gravity: 'Gravitational acceleration 9.81 m/s² — always down, constant.', v0: 'Initial velocity — along θ, magnitude v₀.',
            tension: 'Tension — pull along the string.', buoyancy: 'Buoyancy — weight of displaced fluid, upward.', drag: 'Drag — opposes motion through a fluid.',
            applied: 'Applied force — an external push or pull.', spring: 'Spring force — opposite to stretch or compression.', other: 'Force given in the problem.', net: 'Net force — vector sum of all forces; same direction as acceleration.',
        } as Record<string, string>,
    },
};
type T = typeof I18N.ko;
const f2 = (n: number) => n.toFixed(2);

// 폰 폭에선 viewBox 여백을 잘라 도해를 키운다 — 760 폭을 340px 에 넣으면 0.45배라 라벨이 읽히지 않는다
const useNarrow = () => {
    const [narrow, setNarrow] = useState(false);
    useEffect(() => {
        const q = window.matchMedia('(max-width: 640px)');
        const on = () => setNarrow(q.matches);
        on();
        q.addEventListener('change', on);
        return () => q.removeEventListener('change', on);
    }, []);
    return narrow;
};

const Arrow: React.FC<{ id: string; from: Vec; to: Vec; dashed?: boolean; sel: string | null; onSel: (id: string) => void; t: T;
    label?: { x: number; y: number; text: string; fontSize: number } }> = ({ id, from, to, dashed, sel, onSel, t, label }) => {
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
    if (len < 4) return null;
    const ux = dx / len, uy = dy / len, hl = 12, color = COLOR[id];
    const head = `${to.x},${to.y} ${to.x - hl * ux + 6 * uy},${to.y - hl * uy - 6 * ux} ${to.x - hl * ux - 6 * uy},${to.y - hl * uy + 6 * ux}`;
    const on = sel === id;
    return (
        <g role="button" tabIndex={0} aria-label={`${LABEL[id]}: ${t.desc[id]}`} aria-pressed={on} opacity={sel !== null && !on ? 0.3 : 1}
            className="cursor-pointer transition-opacity focus-visible:outline-2 focus-visible:outline-orange-500" onClick={() => onSel(id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSel(id); } }}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={22} />
            <line x1={from.x} y1={from.y} x2={to.x - ux * hl * 0.6} y2={to.y - uy * hl * 0.6} stroke={color} strokeWidth={on ? 4.5 : 3}
                strokeDasharray={dashed ? '6 5' : undefined} strokeLinecap="round" />
            <polygon points={head} fill={color} />
            <text x={label?.x ?? to.x + ux * 18} y={label?.y ?? to.y + uy * 18} fill={color} fontSize={label?.fontSize ?? 15} fontWeight={700}
                textAnchor="middle" dominantBaseline="middle" className="[paint-order:stroke] stroke-white dark:stroke-slate-900 [stroke-width:4px]">
                {label?.text ?? LABEL[id]}</text>
        </g>
    );
};

const Slider: React.FC<{ label: string; value: number; range: readonly [number, number]; step: number; unit: string; onChange: (n: number) => void }> =
    ({ label, value, range, step, unit, onChange }) => (
    <label className="grid grid-cols-[4.75rem_minmax(0,1fr)_3.5rem] sm:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:gap-2.5 text-[11px] sm:text-[13px] min-h-9 sm:min-h-11 min-w-0">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <input type="range" min={range[0]} max={range[1]} step={step} value={value} aria-label={label} onChange={e => onChange(Number(e.target.value))}
            className="w-full min-w-0 accent-indigo-500" />
        <b className="tabular-nums text-right text-[11px] sm:text-[13px] text-slate-800 dark:text-slate-100">{step < 1 ? value.toFixed(2) : value}{unit}</b>
    </label>
);

// 힘 기호의 아래첨자(F_b) — 밑줄을 그대로 보이면 기호로 읽히지 않는다
const Sym: React.FC<{ s: string }> = ({ s }) => { const [a, b] = s.split('_'); return b ? <>{a}<sub>{b}</sub></> : <>{s}</>; };
const SvgSym: React.FC<{ s: string }> = ({ s }) => { const [a, b] = s.split('_'); return b ? <><tspan>{a}</tspan><tspan dy="0.3em" fontSize="0.7em">{b}</tspan></> : <>{s}</>; };

const Metrics: React.FC<{ items: [string, string][] }> = ({ items }) => (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 mt-2">
        {items.map(([k, v], i) => (
            <div key={i} className="rounded-xl bg-slate-50 dark:bg-white/[0.05] px-2 sm:px-3 py-1 sm:py-2 min-w-0">
                <dt className="text-[9px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate"><Sym s={k} /></dt>
                <dd className="text-xs sm:text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{v}</dd>
            </div>))}
    </dl>
);

const Card: React.FC<{ title: string; sub: string; t: T; hint?: string; children: React.ReactNode; formula: string[]; note: string; onReset: () => void; detail: string | null }> =
    ({ title, sub, t, hint, children, formula, note, onReset, detail }) => {
    const [open, setOpen] = useState(false);
    return (
        <figure className="w-full my-4 sm:my-6 rounded-[2rem] border border-slate-200/50 dark:border-white/5 bg-white dark:bg-white/[0.07] shadow-2xl shadow-slate-200/30 dark:shadow-none px-4 sm:px-6 py-4">
            <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="break-keep text-[13px] sm:text-[15px] font-bold text-slate-800 dark:text-slate-100">{title}</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">{sub}</p>
                </div>
                <span className="text-[10px] sm:text-[11px] rounded-full bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 px-2 py-0.5 flex-shrink-0">Interactive</span>
            </header>
            {children}
            <p className="text-[11px] sm:text-[13px] text-slate-600 dark:text-slate-300 mt-2 min-h-5" aria-live="polite">{detail ?? hint ?? t.hint}</p>
            <button className="mt-2 text-[11px] sm:text-[13px] text-slate-700 dark:text-slate-200" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'} {t.formula}</button>
            {open && <pre className="mt-1 text-xs leading-relaxed whitespace-pre-wrap rounded-xl bg-slate-50 dark:bg-white/[0.05] text-slate-700 dark:text-slate-200 p-3">{formula.join('\n')}</pre>}
            <footer className="mt-3 flex items-center justify-between gap-3 text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400">
                <span className="break-keep">{note}</span>
                <button onClick={onReset} className="flex-shrink-0 rounded-lg border border-slate-200 dark:border-white/10 px-2 py-1">↺ {t.reset}</button>
            </footer>
        </figure>
    );
};

const InclineView: React.FC<{ init: { angleDeg: number; massKg: number; mu?: number }; title?: string; t: T }> = ({ init, title, t }) => {
    const [angle, setAngle] = useState(init.angleDeg), [mass, setMass] = useState(init.massKg), [mu, setMu] = useState(init.mu ?? 0);
    const [tab, setTab] = useState<'forces' | 'components'>('forces');
    const [sel, setSel] = useState<string | null>(null);
    const narrow = useNarrow();
    const hasMu = init.mu !== undefined;
    const r = incline({ angleDeg: angle, massKg: mass, mu });
    const sc = inclineScene({ angleDeg: angle, massKg: mass, mu }, { tab, narrow });
    const vb = sc.viewBox, [o, top, foot] = sc.wedge, rad = (angle * Math.PI) / 180;
    return (
        <Card title={title ?? t.incline} t={t} sub={`${angle}° · ${+mass.toFixed(2)} kg · ${hasMu ? `μ ${mu.toFixed(2)}` : t.noFriction}`}
            detail={sel ? `${LABEL[sel]} — ${t.desc[sel]}` : null}
            onReset={() => { setAngle(init.angleDeg); setMass(init.massKg); setMu(init.mu ?? 0); setSel(null); }}
            note={`${t.ideal}${hasMu ? t.muNote : ''}`}
            formula={[
                `mg = ${f2(mass)} × 9.81 = ${f2(r.weight)} N`,
                `N = mg cosθ = ${f2(r.normalForce)} N`,
                `mg sinθ = ${f2(r.parallel)} N`,
                ...(hasMu ? [`μN = ${f2(mu * r.normalForce)} N → ${r.moves ? t.slides : t.stays}`] : []),
                `a = ${hasMu ? '(mg sinθ − f) / m' : 'g sinθ'} = ${f2(r.accel)} m/s²`,
            ]}>
            <div className="grid grid-cols-2 gap-1.5 mt-3" role="tablist">
                {(['forces', 'components'] as const).map(id => (
                    <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setSel(null); }}
                        className={`rounded-xl border border-slate-200 dark:border-white/10 py-1.5 sm:py-2 text-[11px] sm:text-[13px] ${tab === id ? 'bg-slate-100 dark:bg-white/10 font-bold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>
                        {t[id]}</button>))}
            </div>
            <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={`θ ${angle}°, m ${mass} kg`} className="w-full h-auto block mt-2 text-slate-400 dark:text-slate-500">
                <line x1={vb.x} y1={sc.floorY} x2={vb.x + vb.w} y2={sc.floorY} stroke="currentColor" />
                <polygon points={`${o.x},${o.y} ${top.x},${top.y} ${foot.x},${foot.y}`} className="fill-slate-100 dark:fill-white/[0.06]" stroke="currentColor" strokeWidth={1.5} />
                <path d={`M ${o.x + 60} ${o.y} A 60 60 0 0 0 ${o.x + 60 * Math.cos(rad)} ${o.y - 60 * Math.sin(rad)}`} fill="none" stroke="currentColor" />
                <text x={sc.angleLabel.x} y={sc.angleLabel.y} fontSize={narrow ? 24 : 14} className="fill-slate-700 dark:fill-slate-200">θ = {angle}°</text>
                <rect x={sc.block.c.x - sc.block.w / 2} y={sc.block.c.y - sc.block.h / 2} width={sc.block.w} height={sc.block.h} rx={8}
                    fill="#8b7cf0" fillOpacity={0.75} stroke="#c9c0ff" strokeWidth={2} transform={`rotate(${sc.block.rot} ${sc.block.c.x} ${sc.block.c.y})`} />
                {sc.arrows.map(a => (
                    <Arrow key={a.id} id={a.id} from={a.from} to={a.to} dashed={a.dashed} sel={sel} t={t}
                        onSel={id => setSel(s => (s === id ? null : id))} label={sc.labels.find(l => l.id === a.id)} />))}
            </svg>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">{t.scale}{narrow && tab === 'components' ? ' · mg∥ = mg sinθ, mg⊥ = mg cosθ' : ''}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 mt-2">
                <Slider label={t.angle} value={angle} range={RANGE.angleDeg} step={1} unit="°" onChange={setAngle} />
                <Slider label={t.mass} value={mass} range={sliderRange(SLIDER.massKg, init.massKg)} step={init.massKg > 100 ? 1 : 0.5} unit=" kg" onChange={setMass} />
                {hasMu && <Slider label={t.mu} value={mu} range={RANGE.mu} step={0.05} unit="" onChange={setMu} />}
            </div>
            <Metrics items={[[t.weight, `${f2(r.weight)} N`], [t.normalF, `${f2(r.normalForce)} N`], [t.parallel, `${f2(r.parallel)} N`], [t.accel, `${f2(r.accel)} m/s²`]]} />
        </Card>
    );
};

const ProjectileView: React.FC<{ init: { launchDeg: number; speed: number }; title?: string; t: T }> = ({ init, title, t }) => {
    const [deg, setDeg] = useState(init.launchDeg), [speed, setSpeed] = useState(init.speed), [frac, setFrac] = useState(0.5);
    const [sel, setSel] = useState<string | null>(null);
    const narrow = useNarrow();
    const sc = projectileScene({ launchDeg: deg, speed }, { frac, narrow });
    const p = sc.model, now = sc.now, vb = sc.viewBox, o = sc.origin;
    const lab = (id: string) => sc.labels.find(l => l.id === id)!;
    const pick = (id: string) => setSel(s => (s === id ? null : id));
    const muted = 'fill-slate-500 dark:fill-slate-400';
    return (
        <Card title={title ?? t.projectile} t={t} hint={t.hintMotion} sub={`${deg}° · ${speed} m/s · g 9.81`} note={t.projNote}
            detail={sel ? `${LABEL[sel]} — ${t.desc[sel]}${sel === 'velocity' ? ` vₓ=${f2(now.vel.x)}, vᵧ=${f2(now.vel.y)} m/s` : ''}` : null}
            onReset={() => { setDeg(init.launchDeg); setSpeed(init.speed); setFrac(0.5); setSel(null); }}
            formula={[`x(t) = v₀ cosθ · t = ${f2(now.pos.x)} m`, `y(t) = v₀ sinθ · t − ½gt² = ${f2(now.pos.y)} m`,
                `T = 2v₀ sinθ / g = ${f2(p.T)} s`, `H = (v₀ sinθ)² / 2g = ${f2(p.H)} m`, `R = v₀² sin2θ / g = ${f2(p.R)} m`]}>
            <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={`θ ${deg}°, v₀ ${speed} m/s`} className="w-full h-auto block mt-2 text-slate-400 dark:text-slate-500">
                <line x1={vb.x} y1={sc.floorY} x2={vb.x + vb.w} y2={sc.floorY} stroke="currentColor" />
                <polyline points={sc.path.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')} fill="none" stroke="#9b87f5" strokeWidth={2.5} strokeDasharray="7 6" />
                <path d={`M ${o.x + 40} ${o.y} A 40 40 0 0 0 ${o.x + 40 * Math.cos(sc.rad)} ${o.y - 40 * Math.sin(sc.rad)}`} fill="none" stroke="currentColor" />
                <line x1={sc.hx} y1={sc.floorY} x2={sc.hx} y2={sc.peak.y} stroke="currentColor" />
                <line x1={sc.hx - 5} y1={sc.peak.y} x2={sc.hx + 5} y2={sc.peak.y} stroke="currentColor" />
                <line x1={sc.hx} y1={sc.peak.y} x2={sc.peak.x} y2={sc.peak.y} stroke="currentColor" strokeDasharray="4 4" />
                {(['H', 'R', 'theta'] as const).map(id => { const l = lab(id); return (
                    <text key={id} x={l.x} y={l.y} fontSize={l.fontSize} textAnchor="middle" dominantBaseline="middle" className={muted}>{l.text}</text>); })}
                <Arrow id="v0" from={o} to={sc.arrows[0].to} sel={sel} onSel={pick} t={t} label={lab('v0')} />
                <circle cx={sc.ball.x} cy={sc.ball.y} r={9} fill={COLOR.weight} stroke="#fff" strokeWidth={2} />
                <Arrow id="velocity" from={sc.ball} to={sc.arrows[1].to} sel={sel} onSel={pick} t={t} label={lab('velocity')} />
                <Arrow id="gravity" from={sc.ball} to={sc.arrows[2].to} sel={sel} onSel={pick} t={t} label={lab('gravity')} />
            </svg>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 mt-2">
                <Slider label={t.launch} value={deg} range={RANGE.launchDeg} step={1} unit="°" onChange={setDeg} />
                <Slider label={t.speed} value={speed} range={sliderRange(SLIDER.speed, init.speed)} step={1} unit=" m/s" onChange={setSpeed} />
                <Slider label={t.time} value={Number((p.T * frac).toFixed(2))} range={[0, Number(p.T.toFixed(2))]} step={0.01} unit=" s" onChange={n => setFrac(n / p.T)} />
            </div>
            <Metrics items={[[t.T, `${f2(p.T)} s`], [t.H, `${f2(p.H)} m`], [t.R, `${f2(p.R)} m`], [t.v, `${f2(Math.hypot(now.vel.x, now.vel.y))} m/s`]]} />
        </Card>
    );
};

const CollisionView: React.FC<{ init: CollisionParams; title?: string; t: T }> = ({ init, title, t }) => {
    const [m1, setM1] = useState(init.m1), [m2, setM2] = useState(init.m2), [v1, setV1] = useState(init.v1), [v2, setV2] = useState(init.v2);
    const [e, setE] = useState(init.e ?? 0.5);
    const narrow = useNarrow();
    const sc = collisionScene({ m1, v1, m2, v2, kind: init.kind, e }, { narrow, rowBefore: t.before, rowAfter: t.after, still: t.still });
    const r = sc.model, vb = sc.viewBox;
    const sv = (v: number) => `${v > 0 ? '+' : ''}${f2(v)} m/s`;
    return (
        <Card title={title ?? t[init.kind]} t={t} hint={r.collides ? t.hintCol : t.noHit} detail={null}
            sub={`${t[init.kind]}${init.kind === 'inelastic' ? ` · e ${e.toFixed(2)}` : ''}`} note={t.colNote}
            onReset={() => { setM1(init.m1); setM2(init.m2); setV1(init.v1); setV2(init.v2); setE(init.e ?? 0.5); }}
            formula={[
                `p = m₁v₁ + m₂v₂ = ${f2(m1)}·${f2(v1)} + ${f2(m2)}·${f2(v2)} = ${f2(r.pBefore)} kg·m/s`,
                ...(r.collides ? [
                    `e = ${f2(r.e)}  (v₂′ − v₁′ = e (v₁ − v₂))`,
                    r.merged ? `V = p / (m₁ + m₂) = ${f2(r.u1)} m/s` : `v₁′ = ${f2(r.u1)} m/s,  v₂′ = ${f2(r.u2)} m/s`,
                ] : [t.noHit]),
                `KE = ${f2(r.keBefore)} J → ${f2(r.keAfter)} J (−${f2(r.keLoss)} J)`,
            ]}>
            <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={`m₁ ${m1} kg ${sv(v1)}, m₂ ${m2} kg ${sv(v2)}`} className="w-full h-auto block mt-2 text-slate-400 dark:text-slate-500">
                <line x1={vb.x} y1={sc.divider + 20} x2={vb.x + vb.w} y2={sc.divider + 20} stroke="currentColor" strokeDasharray="4 6" strokeOpacity={0.6} />
                {sc.balls.map(b => <circle key={b.id} cx={b.c.x} cy={b.c.y} r={b.r} fill={b.color} fillOpacity={0.8} stroke="#fff" strokeOpacity={0.7} strokeWidth={2} />)}
                {sc.arrows.map(a => {
                    const s = Math.sign(a.to.x - a.from.x), hl = 12;
                    return (<g key={a.id}>
                        <line x1={a.from.x} y1={a.from.y} x2={a.to.x - s * hl * 0.6} y2={a.to.y} stroke={a.color} strokeWidth={3} strokeLinecap="round" />
                        <polygon points={`${a.to.x},${a.to.y} ${a.to.x - s * hl},${a.to.y - 6} ${a.to.x - s * hl},${a.to.y + 6}`} fill={a.color} />
                    </g>);
                })}
                {sc.labels.map(l => (
                    <text key={l.id} x={l.x} y={l.y} fontSize={l.fontSize} textAnchor="middle" dominantBaseline="middle" fontWeight={l.kind === 'm' ? 400 : 700}
                        className={l.kind === 'row' ? 'fill-slate-700 dark:fill-slate-200' : l.kind === 'm' ? 'fill-slate-500 dark:fill-slate-400' : 'fill-slate-800 dark:fill-slate-100'}>{l.text}</text>))}
            </svg>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-2">
                <Slider label={t.m1} value={m1} range={sliderRange(SLIDER.massKg, init.m1)} step={0.5} unit=" kg" onChange={setM1} />
                <Slider label={t.m2} value={m2} range={sliderRange(SLIDER.massKg, init.m2)} step={0.5} unit=" kg" onChange={setM2} />
                <Slider label={t.v1} value={v1} range={sliderRange(SLIDER.velocity, init.v1)} step={0.5} unit=" m/s" onChange={setV1} />
                <Slider label={t.v2} value={v2} range={sliderRange(SLIDER.velocity, init.v2)} step={0.5} unit=" m/s" onChange={setV2} />
                {init.kind === 'inelastic' && <Slider label={t.e} value={e} range={RANGE.mu} step={0.05} unit="" onChange={setE} />}
            </div>
            <Metrics items={[
                ...(r.merged ? [[t.afterV, sv(r.u1)] as [string, string]] : [[t.after1, sv(r.u1)] as [string, string], [t.after2, sv(r.u2)] as [string, string]]),
                [t.pBefore, `${f2(r.pBefore)} kg·m/s`], [t.keLoss, `${f2(r.keLoss)} J`],
                ...(r.merged ? [[t.pAfter, `${f2(r.pAfter)} kg·m/s`] as [string, string]] : []),
            ]} />
        </Card>
    );
};

const FB_COLOR: Record<string, string> = { gravity: '#e8963c', normal: '#2fb58a', friction: '#e0558b', tension: '#5aa9f0', buoyancy: '#22b8cf',
    drag: '#a78bfa', applied: '#f43f5e', spring: '#84cc16', other: '#94a3b8', net: '#f59e0b' };

const FreeBodyView: React.FC<{ init: { object: { shape: 'circle' | 'rectangle'; label?: string }; forces: BodyForce[] }; title?: string; t: T }> = ({ init, title, t }) => {
    const [sel, setSel] = useState<string | null>(null);
    const [showNet, setShowNet] = useState(false);
    const narrow = useNarrow();
    const sc = freeBodyScene(init.forces, { narrow, shape: init.object.shape, showNet });
    const fb = sc.model, vb = sc.viewBox;
    const lab = (id: string) => sc.labels.find(l => l.id === id)!;
    const name = (i: number) => (i < 0 ? 'ΣF' : lab(`f${i}`).text);
    const descOf = (id: string) => {
        if (id === 'net') return `ΣF — ${t.desc.net}`;
        const f = init.forces[Number(id.slice(1))];
        return `${name(Number(id.slice(1)))} — ${t.desc[f.kind === 'gravity' ? 'weight' : f.kind]}${f.magnitudeN !== undefined ? ` ${f2(f.magnitudeN)} N` : ''}`;
    };
    const netText = fb.known ? (fb.balanced ? t.balanced : `${f2(fb.netMag!)} N · ${Math.round(((fb.netDeg! % 360) + 360) % 360)}°`) : null;
    return (
        <Card title={title ?? t.freeBody} t={t} sub={`${init.object.label ? `${init.object.label} · ` : ''}${t.forceCount(init.forces.length)}`}
            note={fb.known ? t.fbNote : `${t.fbNote} · ${t.fbNoteRel}`} detail={sel ? descOf(sel) : null}
            onReset={() => { setSel(null); setShowNet(false); }}
            formula={[
                ...init.forces.map((f, i) => `${name(i)} = ${f.magnitudeN !== undefined ? `${f2(f.magnitudeN)} N` : '?'} @ ${f.angleDeg}°`),
                ...(fb.known && fb.net ? [`ΣF = (${f2(fb.net.x)}, ${f2(fb.net.y)}) N → ${netText}`] : []),
            ]}>
            {fb.known && !fb.balanced && (
                <label className="mt-3 flex items-center gap-2 text-[11px] sm:text-[13px] text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={showNet} onChange={e => setShowNet(e.target.checked)} className="accent-amber-500" />{t.showNet}
                </label>)}
            <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={init.forces.map((_, i) => name(i)).join(', ')} className="w-full h-auto block mt-2 text-slate-400 dark:text-slate-500">
                {init.object.shape === 'circle'
                    ? <circle cx={sc.c.x} cy={sc.c.y} r={sc.body.w / 2} fill="#8b7cf0" fillOpacity={0.75} stroke="#c9c0ff" strokeWidth={2} />
                    : <rect x={sc.body.x} y={sc.body.y} width={sc.body.w} height={sc.body.h} rx={8} fill="#8b7cf0" fillOpacity={0.75} stroke="#c9c0ff" strokeWidth={2} />}
                {sc.arrows.map(a => {
                    const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, hl = 12, col = FB_COLOR[a.kind];
                    // 화살표가 물체 가운데에서 나가므로 이름은 화살표 위에 테두리 글자로 얹는다(아래 별도 레이어)
                    const on = sel === a.id, l = lab(a.id);
                    return (
                        <g key={a.id} role="button" tabIndex={0} aria-label={descOf(a.id)} aria-pressed={on} opacity={sel !== null && !on ? 0.3 : 1}
                            className="cursor-pointer transition-opacity" onClick={() => setSel(s => (s === a.id ? null : a.id))}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(s => (s === a.id ? null : a.id)); } }}>
                            <line x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} stroke="transparent" strokeWidth={22} />
                            <line x1={a.from.x} y1={a.from.y} x2={a.to.x - ux * hl * 0.6} y2={a.to.y - uy * hl * 0.6} stroke={col} strokeWidth={on ? 4.5 : 3}
                                strokeDasharray={a.net ? '7 5' : undefined} strokeLinecap="round" />
                            <polygon points={`${a.to.x},${a.to.y} ${a.to.x - hl * ux + 6 * uy},${a.to.y - hl * uy - 6 * ux} ${a.to.x - hl * ux - 6 * uy},${a.to.y - hl * uy + 6 * ux}`} fill={col} />
                            <text x={l.x} y={l.y} fill={col} fontSize={l.fontSize} fontWeight={700} textAnchor="middle" dominantBaseline="middle"
                                className="[paint-order:stroke] stroke-white dark:stroke-slate-900 [stroke-width:4px]"><SvgSym s={l.text} /></text>
                        </g>);
                })}
                {init.object.label && <text x={sc.c.x} y={sc.c.y} fontSize={narrow ? 22 : 13} textAnchor="middle" dominantBaseline="middle" fontWeight={600}
                    fill="#fff" stroke="#6d5fd6" strokeWidth={4} style={{ paintOrder: 'stroke' }} pointerEvents="none">{init.object.label}</text>}
            </svg>
            {fb.known && <Metrics items={[
                ...init.forces.slice(0, 7).map((f, i) => [name(i), f.magnitudeN !== undefined ? `${f2(f.magnitudeN)} N` : `${f.angleDeg}°`] as [string, string]),
                ...(netText ? [[t.net, fb.balanced ? '0 N' : `${f2(fb.netMag!)} N`] as [string, string]] : []),
            ]} />}
        </Card>
    );
};

export const PhysicsDiagram: React.FC<{ data: PhysicsData; language?: Lang }> = ({ data, language = 'ko' }) => {
    // es·fr 문구는 아직 없다 — 기호가 대부분이라 영어로 둔다
    const t = language === 'ko' ? I18N.ko : I18N.en;
    if (data.type === 'collision') return <CollisionView init={data.parameters} title={data.title} t={t} />;
    if (data.type === 'free_body') return <FreeBodyView init={data.parameters} title={data.title} t={t} />;
    return data.type === 'projectile'
        ? <ProjectileView init={data.parameters} title={data.title} t={t} />
        : <InclineView init={data.parameters} title={data.title} t={t} />;
};

// 옛 형식 도해(canvas 시절 forces·before/after) — 질량·마찰계수가 없어 새 도해로 옮길 수 없다. 운영 잔량 11건(11-04)
const LEGACY: Record<string, string> = {
    ko: '이전 형식의 도해라 표시할 수 없습니다. 같은 질문을 다시 하면 새 도해로 보여 드립니다.',
    en: 'This diagram uses an older format and can’t be shown. Ask again to get the new diagram.',
    es: 'Este diagrama usa un formato antiguo. Vuelve a preguntar para ver el nuevo.',
    fr: 'Ce schéma utilise un ancien format. Repose la question pour obtenir le nouveau.',
};
export const LegacyDiagramNotice: React.FC<{ language?: Lang }> = ({ language = 'ko' }) => (
    <div className="w-full my-4 rounded-2xl border border-dashed border-slate-300 dark:border-white/10 px-4 py-3 text-xs sm:text-[13px] text-slate-500 dark:text-slate-400">
        <i className="fa-solid fa-diagram-project mr-2" aria-hidden />{LEGACY[language] ?? LEGACY.ko}
    </div>
);
