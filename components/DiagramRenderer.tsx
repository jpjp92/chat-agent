import React, { useEffect, useRef } from 'react';

interface Force {
    label: string;
    angle: number;
    magnitude: number;
    color: string;
}

interface CollisionObject {
    label: string;
    mass?: string;
    velocity: number;
    color: string;
}

interface DiagramData {
    title?: string;
    type: 'inclined_plane' | 'free_body' | 'projectile' | 'collision';
    // inclined_plane
    angle?: number;
    showBaseline?: boolean;
    showAngle?: boolean;
    forces?: Force[];
    // free_body
    object?: { shape?: 'circle' | 'rectangle'; label?: string };
    // projectile
    launchAngle?: number;
    label?: string;
    showComponents?: boolean;
    // collision
    before?: CollisionObject[];
    after?: CollisionObject[];
    elastic?: boolean;
}

interface DiagramRendererProps {
    data: DiagramData;
    language?: 'ko' | 'en' | 'es' | 'fr';
}

const W = 800;
const H = 500;

export const DiagramRenderer: React.FC<DiagramRendererProps> = ({ data, language = 'ko' }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const i18n = {
        ko: { reset: '초기화', inclined: '경사면 힘 다이어그램', freeBody: '자유 물체 다이어그램', projectile: '포물선 운동', collision: '충돌 분석', before: '충돌 전', after: '충돌 후', peak: '최고점', land: '착지점', range: '수평 이동 거리 (R)', obj: '물체', elastic: '완전탄성충돌', inelastic: '비탄성충돌', box: '상자', plane: '경사면' },
        en: { reset: 'Reset', inclined: 'Inclined Plane Diagram', freeBody: 'Free Body Diagram', projectile: 'Projectile Motion', collision: 'Collision Analysis', before: 'Before', after: 'After', peak: 'Peak', land: 'Landing', range: 'Horizontal Range (R)', obj: 'Object', elastic: 'Elastic', inelastic: 'Inelastic', box: 'Box', plane: 'Plane' },
        es: { reset: 'Reiniciar', inclined: 'Plano Inclinado', freeBody: 'Diagrama Cuerpo Libre', projectile: 'Movimiento Proyectil', collision: 'Colisión', before: 'Antes', after: 'Después', peak: 'Punto Máx', land: 'Aterrizaje', range: 'Alcance (R)', obj: 'Objeto', elastic: 'Elástica', inelastic: 'Inelástica', box: 'Caja', plane: 'Plano' },
        fr: { reset: 'Réinitialiser', inclined: 'Plan Incliné', freeBody: 'Diagramme Corps Libre', projectile: 'Mouvement Projectile', collision: 'Collision', before: 'Avant', after: 'Après', peak: 'Sommet', land: 'Atterrissage', range: 'Portée (R)', obj: 'Objet', elastic: 'Élastique', inelastic: 'Inélastique', box: 'Boîte', plane: 'Plan' },
    };
    const t = (i18n as any)[language] ?? i18n.ko;

    const defaultTitle = (): string => {
        switch (data.type) {
            case 'free_body':  return t.freeBody;
            case 'projectile': return t.projectile;
            case 'collision':  return t.collision;
            default:           return t.inclined;
        }
    };

    const getTheme = () => {
        const isDark = document.documentElement.classList.contains('dark');
        return {
            isDark,
            text:    isDark ? '#e2e8f0' : '#1e293b',
            muted:   isDark ? '#94a3b8' : '#64748b',
            surface: isDark ? '#334155' : '#f1f5f9',
            border:  isDark ? '#475569' : '#94a3b8',
        };
    };

    const arrow = (
        ctx: CanvasRenderingContext2D,
        x1: number, y1: number,
        x2: number, y2: number,
        color: string,
        label?: string,
        lx?: number, ly?: number
    ) => {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const hl = 13;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(ang - Math.PI / 6), y2 - hl * Math.sin(ang - Math.PI / 6));
        ctx.lineTo(x2 - hl * Math.cos(ang + Math.PI / 6), y2 - hl * Math.sin(ang + Math.PI / 6));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        if (label) {
            ctx.font = 'bold 13px Inter, Arial, sans-serif';
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const rawLx = lx ?? x2 + Math.cos(ang) * 20;
            const rawLy = ly ?? y2 + Math.sin(ang) * 20;
            ctx.fillText(label,
                Math.max(22, Math.min(W - 22, rawLx)),
                Math.max(14, Math.min(H - 14, rawLy))
            );
        }
    };

    // --- FREE BODY DIAGRAM ---
    const renderFreeBody = (ctx: CanvasRenderingContext2D) => {
        const { text, muted, surface, border } = getTheme();
        ctx.clearRect(0, 0, W, H);

        const cx = W / 2;
        const cy = H / 2;
        const forces = data.forces || [];
        const shape = data.object?.shape || 'circle';
        const objLabel = data.object?.label || '';
        const R = 46;
        // Auto-scale: prevent arrows + labels from exceeding canvas bounds.
        // Available distance from center to canvas edge (minus padding) ≈ 220px.
        // Needed per unit: (R+6) for start offset + magnitude*fScale + 28 for label.
        // => fScale ≤ (220 - R - 6 - 28) / maxMag = 140/maxMag
        const maxMag = Math.max(1, ...forces.map(f => f.magnitude));
        const fScale = Math.min(115, 140 / maxMag);

        ctx.save();
        ctx.fillStyle = surface;
        ctx.strokeStyle = border;
        ctx.lineWidth = 2.5;
        if (shape === 'circle') {
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else {
            const s = R * 1.4;
            ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
            ctx.strokeRect(cx - s, cy - s, s * 2, s * 2);
        }
        ctx.restore();

        if (objLabel) {
            ctx.font = 'bold 15px Inter, Arial, sans-serif';
            ctx.fillStyle = text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(objLabel, cx, cy);
        }

        // angle: 0=right, 90=up, 180=left, 270=down (physics convention)
        forces.forEach(f => {
            const rad = (f.angle * Math.PI) / 180;
            const dx = Math.cos(rad);
            const dy = -Math.sin(rad);
            const sx = cx + dx * (R + 6);
            const sy = cy + dy * (R + 6);
            const ex = sx + dx * f.magnitude * fScale;
            const ey = sy + dy * f.magnitude * fScale;
            arrow(ctx, sx, sy, ex, ey, f.color, f.label, ex + dx * 28, ey + dy * 28);
        });
    };

    // --- PROJECTILE MOTION ---
    const renderProjectile = (ctx: CanvasRenderingContext2D) => {
        const { isDark, text, muted, border } = getTheme();
        ctx.clearRect(0, 0, W, H);

        const ang = data.launchAngle ?? 45;
        const rad = (ang * Math.PI) / 180;
        const objLabel = data.label ?? data.object?.label ?? t.obj;
        const showComp = data.showComponents !== false;

        const startX = 80;
        const groundY = 420;
        const rangeW = 640;
        const endX = startX + rangeW;
        const peakH = Math.min(Math.tan(rad) * rangeW / 4, 280);
        const peakX = startX + rangeW / 2;
        const peakY = groundY - peakH;

        // Ground
        ctx.beginPath();
        ctx.moveTo(40, groundY);
        ctx.lineTo(W - 40, groundY);
        ctx.strokeStyle = border;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Parabolic arc
        ctx.beginPath();
        ctx.moveTo(startX, groundY);
        for (let i = 1; i <= 100; i++) {
            const frac = i / 100;
            ctx.lineTo(startX + frac * rangeW, groundY - 4 * peakH * frac * (1 - frac));
        }
        ctx.strokeStyle = isDark ? '#60a5fa' : '#3b82f6';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Launch dot + label
        ctx.beginPath();
        ctx.arc(startX, groundY, 9, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? '#60a5fa' : '#2563eb';
        ctx.fill();
        ctx.font = 'bold 13px Inter, Arial, sans-serif';
        ctx.fillStyle = text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(objLabel, startX + 13, groundY - 5);

        // v₀ arrow
        const v0s = Math.min(peakH * 0.75, 95);
        const v0ex = startX + Math.cos(rad) * v0s;
        const v0ey = groundY - Math.sin(rad) * v0s;
        arrow(ctx, startX, groundY, v0ex, v0ey, isDark ? '#fbbf24' : '#d97706', 'v₀',
            v0ex + Math.cos(rad) * 18, v0ey - Math.sin(rad) * 14);

        if (showComp) {
            const vxl = Math.cos(rad) * v0s;
            const vyl = Math.sin(rad) * v0s;
            ctx.setLineDash([4, 3]);
            arrow(ctx, startX, groundY, startX + vxl, groundY, '#10b981', 'vₓ', startX + vxl / 2, groundY + 20);
            arrow(ctx, startX + vxl, groundY, startX + vxl, groundY - vyl, '#f43f5e', 'v₀y', startX + vxl + 28, groundY - vyl / 2);
            ctx.setLineDash([]);
            // Right angle marker
            const qa = 12;
            ctx.beginPath();
            ctx.moveTo(startX + vxl - qa, groundY);
            ctx.lineTo(startX + vxl - qa, groundY - qa);
            ctx.lineTo(startX + vxl, groundY - qa);
            ctx.strokeStyle = muted;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // Angle arc + label
            ctx.beginPath();
            ctx.arc(startX, groundY, 50, -rad, 0);
            ctx.strokeStyle = text;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.font = 'bold 13px Inter, Arial, sans-serif';
            ctx.fillStyle = text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(`θ=${ang}°`, startX + 58, groundY - 22);
        }

        // Peak dot + label
        ctx.beginPath();
        ctx.arc(peakX, peakY, 6, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? '#a78bfa' : '#7c3aed';
        ctx.fill();
        ctx.font = '12px Inter, Arial, sans-serif';
        ctx.fillStyle = text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(t.peak, peakX, peakY - 8);

        // Height indicator
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(peakX, peakY);
        ctx.lineTo(peakX, groundY);
        ctx.strokeStyle = muted;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '12px Inter, Arial, sans-serif';
        ctx.fillStyle = muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', peakX + 6, (peakY + groundY) / 2);

        // Landing dot + label
        ctx.beginPath();
        ctx.arc(endX, groundY, 8, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? '#f87171' : '#dc2626';
        ctx.fill();
        ctx.font = '12px Inter, Arial, sans-serif';
        ctx.fillStyle = text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(t.land, endX, groundY + 10);

        // Range bracket
        const ry = groundY + 40;
        ctx.beginPath();
        ctx.moveTo(startX, ry - 5); ctx.lineTo(startX, ry + 5);
        ctx.moveTo(startX, ry);     ctx.lineTo(endX, ry);
        ctx.moveTo(endX, ry - 5);   ctx.lineTo(endX, ry + 5);
        ctx.strokeStyle = muted;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = '12px Inter, Arial, sans-serif';
        ctx.fillStyle = muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(t.range, (startX + endX) / 2, ry + 6);
    };

    // --- COLLISION DIAGRAM ---
    const renderCollision = (ctx: CanvasRenderingContext2D) => {
        const { isDark, text, muted, border } = getTheme();
        ctx.clearRect(0, 0, W, H);

        const before = data.before || [];
        const after = data.after || [];
        const midX = W / 2;
        const R = 32;
        const vScale = 55;
        const maxVLen = 145;

        // Section headers
        ctx.font = 'bold 16px Inter, Arial, sans-serif';
        ctx.fillStyle = text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(t.before, midX / 2, 18);
        ctx.fillText(t.after, midX + midX / 2, 18);

        // Divider
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(midX, 12);
        ctx.lineTo(midX, H - 12);
        ctx.strokeStyle = border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

        // Center arrow + type label
        ctx.font = 'bold 26px Inter, Arial, sans-serif';
        ctx.fillStyle = muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('→', midX, H / 2);
        if (data.elastic !== undefined) {
            ctx.font = '11px Inter, Arial, sans-serif';
            ctx.fillStyle = muted;
            ctx.fillText(data.elastic ? t.elastic : t.inelastic, midX, H / 2 + 24);
        }

        const drawGroup = (objs: CollisionObject[], cx: number) => {
            const n = objs.length;
            const spacing = Math.min(130, (H - 80) / Math.max(n, 1));
            const y0 = H / 2 - (n - 1) * spacing / 2;
            objs.forEach((obj, i) => {
                const ox = cx;
                const oy = y0 + i * spacing;
                ctx.beginPath();
                ctx.arc(ox, oy, R, 0, Math.PI * 2);
                ctx.fillStyle = obj.color + '44';
                ctx.fill();
                ctx.strokeStyle = obj.color;
                ctx.lineWidth = 2.5;
                ctx.stroke();
                ctx.font = 'bold 12px Inter, Arial, sans-serif';
                ctx.fillStyle = text;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(obj.label, ox, oy - 7);
                if (obj.mass) {
                    ctx.font = '11px Inter, Arial, sans-serif';
                    ctx.fillStyle = muted;
                    ctx.fillText(obj.mass, ox, oy + 8);
                }
                if (Math.abs(obj.velocity) > 0.001) {
                    const dir = obj.velocity > 0 ? 1 : -1;
                    const len = Math.min(Math.abs(obj.velocity) * vScale, maxVLen);
                    const ax = ox + dir * (R + 8);
                    const bx = ax + dir * len;
                    const vl = `${obj.velocity > 0 ? '+' : ''}${obj.velocity}m/s`;
                    arrow(ctx, ax, oy, bx, oy, obj.color, vl, (ax + bx) / 2, oy - 22);
                } else {
                    ctx.font = '12px Inter, Arial, sans-serif';
                    ctx.fillStyle = muted;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText('v = 0', ox, oy + R + 6);
                }
            });
        };

        drawGroup(before, midX / 2);
        drawGroup(after, midX + midX / 2);
    };

    // --- INCLINED PLANE ---
    const renderInclinedPlane = (ctx: CanvasRenderingContext2D) => {
        const { text, muted, border } = getTheme();
        ctx.clearRect(0, 0, W, H);

        const angleRad = ((data.angle ?? 30) * Math.PI) / 180;
        const boxSize = 60;
        const planeLeftX = 120;
        const baselineY = H - 100;
        // Clamp plane length so the top never goes above y=60 (prevents off-canvas overflow at steep angles)
        const planeLength = Math.min(500, (baselineY - 60) / Math.max(Math.sin(angleRad), 0.1));
        const planeRightX = planeLeftX + planeLength * Math.cos(angleRad);
        const planeTopY = baselineY - planeLength * Math.sin(angleRad);
        const boxPosRatio = 0.45;
        const boxAlongPlane = planeLength * boxPosRatio;
        const boxBaseX = planeLeftX + boxAlongPlane * Math.cos(angleRad);
        const boxBaseY = baselineY - boxAlongPlane * Math.sin(angleRad);
        const perpOffset = boxSize / 2;
        const boxCenterX = boxBaseX - perpOffset * Math.sin(angleRad);
        const boxCenterY = boxBaseY - perpOffset * Math.cos(angleRad);

        // Baseline
        if (data.showBaseline !== false) {
            ctx.beginPath();
            ctx.moveTo(50, baselineY);
            ctx.lineTo(W - 50, baselineY);
            ctx.strokeStyle = border;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Wedge
        ctx.beginPath();
        ctx.moveTo(planeLeftX, baselineY);
        ctx.lineTo(planeRightX, planeTopY);
        ctx.lineTo(planeRightX, baselineY);
        ctx.closePath();
        ctx.fillStyle = '#e2e8f0';
        ctx.fill();
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Angle arc
        if (data.showAngle !== false) {
            ctx.beginPath();
            ctx.arc(planeLeftX, baselineY, 80, -angleRad, 0);
            ctx.strokeStyle = text;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.font = 'bold 24px Arial';
            ctx.fillStyle = text;
            ctx.textAlign = 'center';
            ctx.fillText('θ', planeLeftX + 104 * Math.cos(angleRad / 2), baselineY - 56 * Math.sin(angleRad / 2) - 2);
        }

        // Box
        ctx.save();
        ctx.translate(boxCenterX, boxCenterY);
        ctx.rotate(-angleRad);
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.fillRect(-boxSize / 2 + 3, -boxSize / 2 + 3, boxSize, boxSize);
        ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#334155' : '#ffffff';
        ctx.fillRect(-boxSize / 2, -boxSize / 2, boxSize, boxSize);
        ctx.strokeStyle = text;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-boxSize / 2, -boxSize / 2, boxSize, boxSize);
        ctx.restore();

        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.box, boxCenterX + boxSize * 0.7, boxCenterY - boxSize * 0.3);
        ctx.font = 'bold 20px Arial';
        ctx.fillText(t.plane, planeRightX - 60, Math.max(30, planeTopY - 30));

        // Force arrows
        const forceScale = 110;
        const findForce = (keywords: string[]) =>
            (data.forces || []).find(f => keywords.some(k => f.label.includes(k)));

        const drawForceArrow = (
            fx: number, fy: number, tx: number, ty: number,
            color: string, label: string,
            lp: { x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline }
        ) => {
            const ang = Math.atan2(ty - fy, tx - fx);
            const hl = 16;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx, ty);
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - hl * Math.cos(ang - Math.PI / 6), ty - hl * Math.sin(ang - Math.PI / 6));
            ctx.lineTo(tx - hl * Math.cos(ang + Math.PI / 6), ty - hl * Math.sin(ang + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            ctx.font = 'bold 18px Arial';
            ctx.fillStyle = color;
            ctx.textAlign = lp.align;
            ctx.textBaseline = lp.baseline;
            ctx.fillText(label, lp.x, lp.y);
        };

        const gravity = findForce(['중력', 'mg', 'gravity']);
        if (gravity) {
            const len = gravity.magnitude * forceScale;
            drawForceArrow(boxCenterX, boxCenterY, boxCenterX, boxCenterY + len, gravity.color, gravity.label,
                { x: boxCenterX, y: boxCenterY + len + 25, align: 'center', baseline: 'top' });
        }
        const normal = findForce(['수직항력', 'normal', 'N)']);
        if (normal) {
            const len = normal.magnitude * forceScale;
            const nx = boxCenterX - len * Math.sin(angleRad);
            const ny = boxCenterY - len * Math.cos(angleRad);
            drawForceArrow(boxCenterX, boxCenterY, nx, ny, normal.color, normal.label,
                { x: nx, y: ny - 25, align: 'center', baseline: 'bottom' });
        }
        const parallel = findForce(['평행', 'parallel', 'sinθ']);
        if (parallel) {
            const len = parallel.magnitude * forceScale;
            const px = boxCenterX + len * Math.cos(angleRad);
            const py = boxCenterY + len * Math.sin(angleRad);
            drawForceArrow(boxCenterX, boxCenterY, px, py, parallel.color, parallel.label,
                { x: px + 15, y: py + 10, align: 'left', baseline: 'middle' });
        }
        const perpendicular = findForce(['수직 분력', 'perpendicular', 'cosθ']);
        if (perpendicular) {
            const len = perpendicular.magnitude * forceScale;
            const px = boxCenterX + len * Math.sin(angleRad);
            const py = boxCenterY + len * Math.cos(angleRad);
            drawForceArrow(boxCenterX, boxCenterY, px, py, perpendicular.color, perpendicular.label,
                { x: px + 15, y: py - 10, align: 'left', baseline: 'middle' });
        }
        const friction = findForce(['마찰', 'friction']);
        if (friction) {
            const len = friction.magnitude * forceScale;
            const fx = boxCenterX - len * Math.cos(angleRad);
            const fy = boxCenterY - len * Math.sin(angleRad);
            drawForceArrow(boxCenterX, boxCenterY, fx, fy, friction.color, friction.label,
                { x: fx - 15, y: fy - 15, align: 'right', baseline: 'middle' });
        }
    };

    const renderDiagram = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        switch (data.type) {
            case 'free_body':  renderFreeBody(ctx);     break;
            case 'projectile': renderProjectile(ctx);   break;
            case 'collision':  renderCollision(ctx);    break;
            default:           renderInclinedPlane(ctx);break;
        }
    };

    useEffect(() => {
        renderDiagram();
    }, [data, language]);

    return (
        <div className="w-full my-6 animate-in fade-in zoom-in-95 duration-700">
            <div className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1e1f] shadow-lg overflow-hidden flex flex-col w-full h-full">
                <div className="px-5 py-4 flex items-center justify-between z-10 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 backdrop-blur-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></div>
                        <h3 className="text-[11px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight">
                            {data.title || defaultTitle()}
                        </h3>
                    </div>
                    <button
                        onClick={renderDiagram}
                        className="w-8 h-8 rounded-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-400 hover:text-orange-500 transition-colors shadow-sm"
                        title={t.reset}
                    >
                        <i className="fa-solid fa-rotate-right text-[10px]"></i>
                    </button>
                </div>
                <div className="w-full flex items-center justify-center bg-slate-50 dark:bg-black/20 p-4 relative min-h-[400px]">
                    <canvas
                        ref={canvasRef}
                        width={W}
                        height={H}
                        className="max-w-full h-auto drop-shadow-md"
                    />
                </div>
            </div>
        </div>
    );
};
