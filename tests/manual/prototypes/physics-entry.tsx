import React from 'react';
import { createRoot } from 'react-dom/client';
import { PhysicsSvg, type PhysicsData } from './PhysicsSvg';

const css = `
:root{--bg:#f6f7fb;--card:#ffffff;--text:#1d2433;--muted:#5d6678;--border:#b9c0d0;--wedge:#e6e9f2;--chip:#eef0f6}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15171c;--card:#1d2027;--text:#e6e8ee;--muted:#9aa2b2;--border:#4a5162;--wedge:#272b34;--chip:#2a2e38;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#15171c;--card:#1d2027;--text:#e6e8ee;--muted:#9aa2b2;--border:#4a5162;--wedge:#272b34;--chip:#2a2e38;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--text);font-family:"IBM Plex Sans KR",system-ui,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding-block:16px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.wrap h1{font-size:18px;margin:0 0 4px;text-wrap:balance}.wrap .lede{font-size:13px;color:var(--muted);margin:0}
.phys{margin:20px 0;border:1px solid var(--border);border-radius:20px;background:var(--card);padding:14px 16px}
.phys header{display:flex;justify-content:space-between;align-items:flex-start}.phys h3{margin:0;font-size:15px}.phys header p{margin:2px 0 0;font-size:12px;color:var(--muted)}
.phys-tag{font-size:11px;background:var(--chip);border-radius:999px;padding:2px 8px}
.phys-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:12px 0 0}.phys-tabs button{border:1px solid var(--border);background:transparent;color:var(--text);border-radius:10px;padding:8px;font:inherit;font-size:13px;cursor:pointer}
.phys-tabs button[aria-selected=true]{background:var(--chip);font-weight:700}
.phys svg{width:100%;height:auto;display:block}.phys-label{paint-order:stroke;stroke:var(--card);stroke-width:4px}
.phys g[role=button]:focus-visible{outline:2px solid #f97316}
.phys-sliders{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:4px 16px}
.phys-slider{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;font-size:13px;min-height:44px}.phys-slider input{width:100%}
.phys-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0}.phys-metrics div{background:var(--chip);border-radius:12px;padding:8px 10px}
.phys-metrics dt{font-size:11px;color:var(--muted)}.phys-metrics dd{margin:2px 0 0;font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
/* 모바일 — 슬라이더 한 줄씩, 지표 2×2, 도해 글자는 축소 비율만큼 키운다(viewBox 760 → 폰 ~340px 라 0.45배) */
.phys{min-width:0;overflow:hidden}.phys header{gap:8px}.phys header>div{min-width:0}
.phys-slider{grid-template-columns:auto minmax(0,1fr) auto}.phys-slider input{min-width:0}
@media (max-width:640px){
 .phys{padding:12px;border-radius:16px}
 .phys-sliders{grid-template-columns:1fr}
 .phys-slider span{min-width:72px}
 .phys-metrics{grid-template-columns:repeat(2,1fr)}
 .phys svg text:not(.phys-label){font-size:24px}.phys .phys-label{stroke-width:6px}
 .phys-tag{display:none}
}
.phys-caption{font-size:12px;color:var(--muted);text-align:right;margin:2px 0 6px}
.phys-detail{font-size:13px;color:var(--muted);margin:6px 2px}
.phys-fold{background:none;border:0;color:var(--text);font:inherit;font-size:13px;font-weight:700;cursor:pointer;padding:4px 0}
.phys-formula{background:var(--chip);border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.7;white-space:pre-wrap;margin:4px 0}
.phys footer{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:6px}.phys footer button{background:none;border:0;color:var(--muted);cursor:pointer;font:inherit}
@media (prefers-reduced-motion: reduce){*{transition:none!important}}`;

const SAMPLES: { name: string; data: PhysicsData }[] = [
    { name: 'Claude 웹 샘플 재현 — θ=37°, m=5.5kg, 마찰 없음', data: { type: 'inclined_plane', parameters: { angleDeg: 37, massKg: 5.5 } } },
    { name: '완경사 — θ=19°, m=5.5kg (라벨 겹침이 나던 각도, 중력 성분 분해 탭도 확인)', data: { type: 'inclined_plane', title: '완만한 경사면', parameters: { angleDeg: 19, massKg: 5.5 } } },
    { name: '마찰 있음 — θ=30°, m=5kg, μ=0.3 (미끄러짐)', data: { type: 'inclined_plane', title: '마찰 있는 경사면', parameters: { angleDeg: 30, massKg: 5, mu: 0.3 } } },
    { name: '포물선 — 55°, 20 m/s', data: { type: 'projectile', parameters: { launchDeg: 55, speed: 20 } } },
];

const App = () => {
    return (<div className="wrap"><style>{css}</style>
        <h1>물리 도해 시제품</h1>
        <p className="lede">LLM 은 각도·질량 같은 물리 값만 넘기고, 힘의 방향과 길이는 렌더러가 계산합니다. 슬라이더를 움직이거나 화살표를 눌러 보세요.</p>
        {SAMPLES.map(s => <section key={s.name}><h2 style={{ fontSize: 13, color: 'var(--muted)' }}>{s.name}</h2><PhysicsSvg data={s.data} /></section>)}
    </div>);
};
createRoot(document.getElementById('root')!).render(<App />);
