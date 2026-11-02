import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiagramRenderer } from '../../../components/DiagramRenderer';
import { DiagramSvg } from './DiagramSvg';
import { SAMPLES } from './diagram-samples';

const css = `
:root{--bg:#f8fafc;--card:#fff;--text:#1e293b;--muted:#64748b;--border:#94a3b8;--wedge:#e2e8f0;--obj:#f1f5f9}
.dark{--bg:#0b1020;--card:#1e1e1f;--text:#e2e8f0;--muted:#94a3b8;--border:#475569;--wedge:#334155;--obj:#334155}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif}
.dsvg{margin:24px 0;border:1px solid var(--border);border-radius:24px;background:var(--card);padding:12px 16px 16px}
.dsvg figcaption{font-size:11px;font-weight:700;text-transform:uppercase;padding:4px 4px 8px}
.dsvg svg{width:100%;height:auto;display:block}
.dsvg-text{fill:var(--text);font-size:13px}.dsvg-mutedtext{fill:var(--muted);font-size:12px}
.dsvg-border{stroke:var(--border);fill:none}.dsvg-muted{stroke:var(--muted)}
.dsvg-wedge{fill:var(--wedge);stroke:var(--border);stroke-width:1.5}.dsvg-obj{fill:var(--obj);stroke:var(--text);stroke-width:2.5}
.dsvg g[role=button]:focus-visible{outline:2px solid #f97316;outline-offset:2px}
.dsvg-slider{display:flex;flex-direction:column;gap:6px;font-size:13px;padding:8px 4px}.dsvg-slider input{width:100%;min-height:44px}
.dsvg-detail{font-size:13px;color:var(--muted);margin:4px}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
.wrap{max-width:1280px;margin:0 auto;padding:16px}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
@media (max-width:820px){.row{grid-template-columns:1fr}}
h1{font-size:20px}h2{font-size:15px;margin:32px 0 0}.note{color:#f97316;font-size:13px}.col h3{font-size:12px;color:var(--muted);margin:8px 0 0}
.toggle{border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:999px;padding:6px 14px;cursor:pointer}`;

const App = () => {
    const [dark, setDark] = useState(true);
    React.useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
    return (<div className="wrap">
        <style>{css}</style>
        <h1>json:diagram — 현행 canvas vs SVG 시제품</h1>
        <p>같은 JSON 을 두 렌더러에 넣었다. 오른쪽은 화살표를 누르면 강조, 슬라이더로 각도를 바꿀 수 있다. <button className="toggle" onClick={() => setDark(d => !d)}>{dark ? '라이트' : '다크'} 모드로</button></p>
        {SAMPLES.map(s => (<section key={s.name + String(dark)}>
            <h2>{s.name}</h2>{s.note && <div className="note">⚠ {s.note}</div>}
            <div className="row">
                <div className="col"><h3>현행 canvas</h3><DiagramRenderer data={s.data as never} /></div>
                <div className="col"><h3>SVG 시제품</h3><DiagramSvg data={s.data as never} /></div>
            </div>
        </section>))}
    </div>);
};
createRoot(document.getElementById('root')!).render(<App />);
