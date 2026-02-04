import React, { useEffect, useRef } from 'react';

interface Force {
    label: string;
    angle: number; // degrees from horizontal
    magnitude: number; // relative scale
    color: string;
}

interface DiagramData {
    title?: string;
    type: 'inclined_plane';
    angle: number; // degrees
    showBaseline?: boolean;
    showAngle?: boolean;
    forces: Force[];
}

interface DiagramRendererProps {
    data: DiagramData;
    language?: 'ko' | 'en';
}

export const DiagramRenderer: React.FC<DiagramRendererProps> = ({ data, language = 'ko' }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const i18n = {
        ko: { reset: '초기화', title: '경사면 힘 다이어그램' },
        en: { reset: 'Reset', title: 'Inclined Plane Force Diagram' }
    };
    const t = i18n[language] || i18n.en;

    const renderDiagram = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        console.log('🎨 DiagramRenderer rendering:', data);

        // Clear canvas (transparent background for dark mode compatibility)
        ctx.clearRect(0, 0, width, height);

        // Drawing parameters
        const angleRad = (data.angle * Math.PI) / 180;
        const boxSize = 60;
        const planeLength = 500;
        const planeThickness = 25;

        // Key positions
        const planeLeftX = 120;  // Left edge of plane
        const baselineY = height - 100;  // Horizontal baseline

        // Calculate plane endpoints
        const planeRightX = planeLeftX + planeLength * Math.cos(angleRad);
        const planeTopY = baselineY - planeLength * Math.sin(angleRad);

        // Box position (centered on plane)
        const boxPosRatio = 0.45;
        const boxAlongPlane = planeLength * boxPosRatio;
        const boxBaseX = planeLeftX + boxAlongPlane * Math.cos(angleRad);
        const boxBaseY = baselineY - boxAlongPlane * Math.sin(angleRad);

        // Box center (offset perpendicular to plane surface)
        const perpOffset = boxSize / 2;
        const boxCenterX = boxBaseX - perpOffset * Math.sin(angleRad);
        const boxCenterY = boxBaseY - perpOffset * Math.cos(angleRad);

        // Draw baseline (horizontal reference)
        if (data.showBaseline !== false) {
            ctx.beginPath();
            ctx.moveTo(50, baselineY);
            ctx.lineTo(width - 50, baselineY);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Draw inclined plane (Wedge/Triangle style)
        ctx.save();

        const planeColor = '#e2e8f0';
        const planeBorder = '#475569';

        // Wedge body (matching baseline)
        ctx.beginPath();
        ctx.moveTo(planeLeftX, baselineY);
        ctx.lineTo(planeRightX, planeTopY);
        ctx.lineTo(planeRightX, baselineY);
        ctx.closePath();

        ctx.fillStyle = planeColor;
        ctx.fill();

        // Plane outline
        ctx.strokeStyle = planeBorder;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Draw angle arc
        if (data.showAngle !== false) {
            const arcRadius = 80;
            ctx.beginPath();
            ctx.arc(planeLeftX, baselineY, arcRadius, -angleRad, 0);
            ctx.strokeStyle = '#1a1a2e';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Angle label (θ)
            const labelAngle = angleRad / 2;
            ctx.font = 'bold 24px Arial';
            ctx.fillStyle = '#1a1a2e';
            ctx.textAlign = 'center';
            ctx.fillText('θ', planeLeftX + arcRadius * 1.3 * Math.cos(labelAngle), baselineY - arcRadius * 0.7 * Math.sin(labelAngle) - 2);
        }

        // Draw box
        ctx.save();
        ctx.translate(boxCenterX, boxCenterY);
        ctx.rotate(-angleRad);

        // Box shadow
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.fillRect(-boxSize / 2 + 3, -boxSize / 2 + 3, boxSize, boxSize);

        // Box fill
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-boxSize / 2, -boxSize / 2, boxSize, boxSize);

        // Box outline
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-boxSize / 2, -boxSize / 2, boxSize, boxSize);

        ctx.restore();

        // Box label
        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('상자', boxCenterX + boxSize * 0.7, boxCenterY - boxSize * 0.3);

        // Plane label
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.fillText('경사면', planeRightX - 60, planeTopY - 30);

        // Draw force vectors with proper directions and specific label alignment
        const drawArrow = (
            fromX: number,
            fromY: number,
            toX: number,
            toY: number,
            color: string,
            label: string,
            labelPos: { x: number, y: number, align: CanvasTextAlign, baseline: CanvasTextBaseline }
        ) => {
            const angle = Math.atan2(toY - fromY, toX - fromX);

            // Arrow line
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Arrow head
            const headLength = 16;
            const headAngle = Math.PI / 6;
            ctx.beginPath();
            ctx.moveTo(toX, toY);
            ctx.lineTo(
                toX - headLength * Math.cos(angle - headAngle),
                toY - headLength * Math.sin(angle - headAngle)
            );
            ctx.lineTo(
                toX - headLength * Math.cos(angle + headAngle),
                toY - headLength * Math.sin(angle + headAngle)
            );
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();

            // Label
            ctx.font = 'bold 18px Arial';
            ctx.fillStyle = color;
            ctx.textAlign = labelPos.align;
            ctx.textBaseline = labelPos.baseline;
            ctx.fillText(label, labelPos.x, labelPos.y);
        };

        // Calculate force vectors from box center
        const forceScale = 110;

        const findForce = (keywords: string[]) => {
            return data.forces.find(f => keywords.some(k => f.label.includes(k)));
        };

        // 1. Gravity (mg) - straight down
        const gravity = findForce(['중력', 'mg', 'gravity']);
        if (gravity) {
            const len = gravity.magnitude * forceScale;
            drawArrow(boxCenterX, boxCenterY, boxCenterX, boxCenterY + len, gravity.color, gravity.label, {
                x: boxCenterX,
                y: boxCenterY + len + 25,
                align: 'center',
                baseline: 'top'
            });
        }

        // 2. Normal force (N) - perpendicular to plane
        const normal = findForce(['수직항력', 'normal', 'N)']);
        if (normal) {
            const len = normal.magnitude * forceScale;
            const nx = boxCenterX - len * Math.sin(angleRad);
            const ny = boxCenterY - len * Math.cos(angleRad);
            drawArrow(boxCenterX, boxCenterY, nx, ny, normal.color, normal.label, {
                x: nx,
                y: ny - 25,
                align: 'center',
                baseline: 'bottom'
            });
        }

        // 3. Parallel component (mg sinθ)
        const parallel = findForce(['평행', 'parallel', 'sinθ']);
        if (parallel) {
            const len = parallel.magnitude * forceScale;
            const px = boxCenterX + len * Math.cos(angleRad);
            const py = boxCenterY + len * Math.sin(angleRad);
            drawArrow(boxCenterX, boxCenterY, px, py, parallel.color, parallel.label, {
                x: px + 15,
                y: py + 10,
                align: 'left',
                baseline: 'middle'
            });
        }

        // 4. Perpendicular component (mg cosθ)
        const perpendicular = findForce(['수직 분력', 'perpendicular', 'cosθ']);
        if (perpendicular) {
            const len = perpendicular.magnitude * forceScale;
            const px = boxCenterX + len * Math.sin(angleRad);
            const py = boxCenterY + len * Math.cos(angleRad);
            drawArrow(boxCenterX, boxCenterY, px, py, perpendicular.color, perpendicular.label, {
                x: px + 15,
                y: py - 10,
                align: 'left',
                baseline: 'middle'
            });
        }

        // 5. Friction (f)
        const friction = findForce(['마찰', 'friction']);
        if (friction) {
            const len = friction.magnitude * forceScale;
            const fx = boxCenterX - len * Math.cos(angleRad);
            const fy = boxCenterY - len * Math.sin(angleRad);
            drawArrow(boxCenterX, boxCenterY, fx, fy, friction.color, friction.label, {
                x: fx - 15,
                y: fy - 15,
                align: 'right',
                baseline: 'middle'
            });
        }
    };

    useEffect(() => {
        renderDiagram();
    }, [data]);

    return (
        <div className="w-full my-6 animate-in fade-in zoom-in-95 duration-700">
            <div className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1e1f] shadow-lg overflow-hidden flex flex-col w-full h-full">
                {/* Header matching PhysicsRenderer style */}
                <div className="px-5 py-4 flex items-center justify-between z-10 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 backdrop-blur-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></div>
                        <h3 className="text-[11px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight">
                            {data.title || t.title}
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

                {/* Canvas Container */}
                <div className="w-full flex items-center justify-center bg-slate-50 dark:bg-black/20 p-4 relative min-h-[400px]">
                    <canvas
                        ref={canvasRef}
                        width={800}
                        height={500}
                        className="max-w-full h-auto drop-shadow-md"
                    />
                </div>
            </div>
        </div>
    );
};
