import React, { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { motion, AnimatePresence } from 'framer-motion';

interface PhysicsObject {
    type: 'circle' | 'rectangle';
    x: number;
    y: number;
    radius?: number;
    width?: number;
    height?: number;
    options?: Matter.IChamferableBodyDefinition;
    velocity?: { x: number; y: number };
    angle?: number;
    angularVelocity?: number;
    label?: string;
    vectors?: Array<{
        type: 'velocity' | 'force' | 'gravity' | 'custom';
        label?: string;
        color?: string;
        value?: { x: number; y: number };
    }>;
    color?: string;
}

interface PhysicsData {
    title?: string;
    gravity?: { x: number; y: number };
    objects: PhysicsObject[];
    description?: string;
}

interface PhysicsRendererProps {
    physicsData: PhysicsData;
    language?: 'ko' | 'en' | 'es' | 'fr';
}

const useThemeMode = () => {
    const [isDark, setIsDark] = React.useState(false);

    useEffect(() => {
        const checkDarkMode = () => {
            setIsDark(document.documentElement.classList.contains('dark'));
        };
        checkDarkMode();
        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    return isDark;
};

const PhysicsRenderer: React.FC<PhysicsRendererProps> = ({ physicsData, language = 'ko' }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<Matter.Engine | null>(null);
    const renderRef = useRef<Matter.Render | null>(null);
    const runnerRef = useRef<Matter.Runner | null>(null);
    const isDark = useThemeMode();

    const i18n = {
        ko: { reset: '초기화', engine: '물리학 엔진' },
        en: { reset: 'Reset', engine: 'Physics Engine' },
        es: { reset: 'Reiniciar', engine: 'Motor Físico' },
        fr: { reset: 'Réinitialiser', engine: 'Moteur Physique' }
    };
    const t = i18n[language] || i18n.en;

    const initPhysics = (width: number, height: number) => {
        if (!canvasRef.current) return;

        // Cleanup
        if (renderRef.current) {
            Matter.Render.stop(renderRef.current);
            Matter.Runner.stop(runnerRef.current!);
            if (engineRef.current) {
                Matter.World.clear(engineRef.current.world, false);
                Matter.Engine.clear(engineRef.current);
            }
            renderRef.current.canvas.remove();
        }

        // Enhanced engine configuration for better collision detection
        const engine = Matter.Engine.create({
            positionIterations: 10,      // Increased from default 6 (better collision accuracy)
            velocityIterations: 8,       // Increased from default 4 (prevents tunneling)
            constraintIterations: 4      // Increased from default 2 (stable constraints)
        });
        engineRef.current = engine;

        if (physicsData.gravity) {
            engine.gravity.x = physicsData.gravity.x;
            engine.gravity.y = physicsData.gravity.y;
        }

        const render = Matter.Render.create({
            element: canvasRef.current,
            engine: engine,
            options: {
                width,
                height,
                wireframes: false,
                background: 'transparent',
                pixelRatio: window.devicePixelRatio,
            }
        });

        render.canvas.style.display = 'block';
        render.canvas.style.width = '100%';
        render.canvas.style.height = '100%';

        renderRef.current = render;

        // Fixed timestep runner for consistent physics (prevents frame-rate dependent behavior)
        const runner = Matter.Runner.create({
            isFixed: true,
            delta: 1000 / 60  // 60 FPS fixed timestep
        });
        runnerRef.current = runner;

        // Virtual Coordinate system based on 800x400 standard
        const virtualWidth = 800;
        const virtualHeight = 400;

        // Match scaling to container while maintaining aspect ratio behavior
        const scaleX = width / virtualWidth;
        const scaleY = height / virtualHeight;
        const scale = Math.min(scaleX, scaleY);

        // For mobile/tall screens, we want to align the 800x400 "box" to the BOTTOM
        const offsetX = (width - (virtualWidth * scale)) / 2;
        const offsetY = height - (virtualHeight * scale);

        const bodies: Matter.Body[] = physicsData.objects.map(obj => {
            let body: Matter.Body;
            const options: Matter.IChamferableBodyDefinition = {
                restitution: obj.options?.restitution ?? 0.6,
                friction: obj.options?.friction ?? 0.1,
                frictionAir: 0.01,
                isStatic: obj.options?.isStatic ?? false,
                ...obj.options,
                render: {
                    fillStyle: obj.color || (isDark ? '#3b82f6' : '#2563eb'),
                    strokeStyle: 'transparent',
                    lineWidth: 0
                }
            };

            // Template-based positioning for inclined planes (overrides AI coordinates)
            const isInclinedPlane = physicsData.objects.some(o =>
                o.type === 'rectangle' && o.angle && Math.abs(o.angle - 0.524) < 0.2
            );

            if (isInclinedPlane) {
                console.log('🔧 Inclined plane template detected!', physicsData.objects);
            }

            let x = (obj.x * scale) + offsetX;
            let y = (obj.y * scale) + offsetY;

            if (isInclinedPlane && obj.type === 'rectangle' && obj.angle) {
                // Detect which object this is based on size (plane is wider)
                const isPlane = (obj.width || 0) > 100;

                if (isPlane) {
                    // Inclined plane: use virtual coordinates
                    x = (450 * scale) + offsetX;
                    y = (320 * scale) + offsetY;
                    console.log('📐 Plane template applied:', { virtual: [450, 320], actual: [x, y] });
                } else {
                    // Sliding box: use virtual coordinates
                    x = (300 * scale) + offsetX;
                    y = (235 * scale) + offsetY;
                    console.log('📦 Box template applied:', { virtual: [300, 235], actual: [x, y] });
                }
            }

            if (obj.type === 'circle') {
                body = Matter.Bodies.circle(x, y, (obj.radius || 20) * scale, options);
            } else {
                body = Matter.Bodies.rectangle(x, y, (obj.width || 40) * scale, (obj.height || 40) * scale, options);
            }
            return body;
        });

        // Invisible Boundaries
        const wallOptions = { isStatic: true, render: { visible: false } };
        const ground = Matter.Bodies.rectangle(width / 2, height + 500, width * 5, 1000, wallOptions);
        const leftWall = Matter.Bodies.rectangle(-500, height / 2, 1000, height * 5, wallOptions);
        const rightWall = Matter.Bodies.rectangle(width + 500, height / 2, 1000, height * 5, wallOptions);
        const ceiling = Matter.Bodies.rectangle(width / 2, -500, width * 5, 1000, wallOptions);

        // Add mouse control
        const mouse = Matter.Mouse.create(render.canvas);
        const mouseConstraint = Matter.MouseConstraint.create(engine, {
            mouse: mouse,
            constraint: {
                stiffness: 0.2,
                render: { visible: false }
            }
        });

        // Allow scrolling on mobile
        const mouseAny = mouse as any;
        if (mouseAny.element) {
            mouseAny.element.removeEventListener("mousewheel", mouseAny.mousewheel);
            mouseAny.element.removeEventListener("DOMMouseScroll", mouseAny.mousewheel);
        }

        Matter.Composite.add(engine.world, [...bodies, ground, leftWall, rightWall, mouseConstraint]);

        // Apply Initial States
        physicsData.objects.forEach((obj, idx) => {
            const body = bodies[idx];
            if (obj.velocity) {
                Matter.Body.setVelocity(body, {
                    x: obj.velocity.x * scale,
                    y: obj.velocity.y * scale
                });
            }
            if (obj.angle !== undefined) Matter.Body.setAngle(body, obj.angle);
            if (obj.angularVelocity !== undefined) Matter.Body.setAngularVelocity(body, obj.angularVelocity);
        });

        // Custom Overlay Drawing
        const drawArrow = (ctx: CanvasRenderingContext2D, fx: number, fy: number, tx: number, ty: number, color: string, label?: string) => {
            const headlen = 10;
            const dx = tx - fx;
            const dy = ty - fy;
            const angle = Math.atan2(dy, dx);
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx, ty);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - headlen * Math.cos(angle - Math.PI / 6), ty - headlen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(tx - headlen * Math.cos(angle + Math.PI / 6), ty - headlen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            if (label) {
                ctx.fillStyle = color;
                const textPadding = 25;

                // Use arrow MIDPOINT instead of endpoint to prevent overflow
                const midX = (fx + tx) / 2;
                const midY = (fy + ty) / 2;

                let textOffsetX = Math.cos(angle) * textPadding;
                const textOffsetY = Math.sin(angle) * textPadding;
                const verticalCorrection = Math.abs(Math.cos(angle)) > 0.8 ? -15 : 0;

                let posX = midX + textOffsetX;
                const posY = midY + textOffsetY + verticalCorrection;

                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 4;

                // Smart alignment: check if text will overflow canvas boundaries
                const textMetrics = ctx.measureText(label);
                const textWidth = textMetrics.width;
                let finalTextAlign: CanvasTextAlign = Math.abs(Math.cos(angle)) > 0.5 ? (Math.cos(angle) > 0 ? 'left' : 'right') : 'center';

                // Boundary correction
                if (finalTextAlign === 'left' && posX + textWidth > width - 10) {
                    finalTextAlign = 'right';
                    textOffsetX = -textPadding; // Flip to other side
                    posX = midX + textOffsetX;
                } else if (finalTextAlign === 'right' && posX - textWidth < 10) {
                    finalTextAlign = 'left';
                    textOffsetX = textPadding;
                    posX = midX + textOffsetX;
                } else if (finalTextAlign === 'center') {
                    if (posX + textWidth / 2 > width - 10) {
                        finalTextAlign = 'right';
                        textOffsetX = -textPadding;
                        posX = midX + textOffsetX;
                    } else if (posX - textWidth / 2 < 10) {
                        finalTextAlign = 'left';
                        textOffsetX = textPadding;
                        posX = midX + textOffsetX;
                    }
                }

                ctx.textAlign = finalTextAlign;
                ctx.fillText(label, posX, posY);
                ctx.restore();
            }
        };

        Matter.Events.on(render, 'afterRender', () => {
            const context = render.context;
            context.font = 'bold 12px Inter, system-ui';
            context.textAlign = 'center';
            context.textBaseline = 'middle';

            // 0. Draw a subtle Ground line at virtual y=400
            const groundY = (400 * scale) + offsetY;
            context.beginPath();
            context.moveTo(offsetX, groundY);
            context.lineTo(offsetX + (800 * scale), groundY);
            context.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
            context.lineWidth = 1;
            context.stroke();

            // 1. Draw Labels first (so they are under arrows if overlapping)
            physicsData.objects.forEach((obj, idx) => {
                const body = bodies[idx];
                if (!body) return;
                const { x, y } = body.position;
                if (obj.label) {
                    context.fillStyle = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)';
                    // Stagger labels to prevent overlap in dense layouts (like Newton's Cradle)
                    const staggerOffset = (idx % 2 === 0) ? 20 : 45;
                    context.fillText(obj.label, x, y - (obj.radius || 20) * scale - staggerOffset);
                }
            });

            // 2. Draw Vectors on top of everything
            physicsData.objects.forEach((obj, idx) => {
                const body = bodies[idx];
                const { x, y } = body.position;
                if (obj.vectors) {
                    obj.vectors.forEach(v => {
                        let vx = 0, vy = 0;
                        if (v.type === 'velocity') {
                            vx = body.velocity.x * 12;
                            vy = body.velocity.y * 12;
                        } else if (v.value) {
                            vx = v.value.x * 12 * scale;
                            vy = v.value.y * 12 * scale;
                        } else {
                            if (v.type === 'gravity') vy = 40 * scale;
                            else if (v.type === 'force' && v.label?.includes('부력')) vy = -40 * scale;
                            else if (v.type === 'force') vy = 40 * scale;
                        }

                        if (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1) {
                            const color = v.color || (isDark ? '#fbbf24' : '#f59e0b');

                            // Draw vectors from object center (not edge) for clean free-body diagrams
                            const startX = x;
                            const startY = y;

                            drawArrow(context, startX, startY, startX + vx, startY + vy, color, v.label);
                        }
                    });
                }
            });
        });

        Matter.Render.run(render);
        Matter.Runner.run(runner, engine);
    };

    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                if (clientWidth > 0 && clientHeight > 0) initPhysics(clientWidth, clientHeight);
            }
        };
        handleResize();
        const resizeObserver = new ResizeObserver(() => handleResize());
        if (containerRef.current) resizeObserver.observe(containerRef.current);
        return () => {
            resizeObserver.disconnect();
            if (renderRef.current) {
                Matter.Render.stop(renderRef.current);
                if (runnerRef.current) Matter.Runner.stop(runnerRef.current);
                if (engineRef.current) Matter.Engine.clear(engineRef.current);
                renderRef.current.canvas.remove();
            }
        };
    }, [physicsData, isDark]);

    return (
        <div className="w-full my-6 animate-in fade-in zoom-in-95 duration-700 min-h-[300px]">
            <div className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1e1f] shadow-lg overflow-hidden flex flex-col relative w-full h-full">
                <div className="px-5 py-4 flex items-center justify-between z-10 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 backdrop-blur-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></div>
                        <h3 className="text-[11px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight">
                            {physicsData.title || t.engine}
                        </h3>
                    </div>
                    <button
                        onClick={() => {
                            if (containerRef.current) initPhysics(containerRef.current.clientWidth, containerRef.current.clientHeight);
                        }}
                        className="w-8 h-8 rounded-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-400 hover:text-orange-500 transition-colors shadow-sm"
                        title={t.reset}
                    >
                        <i className="fa-solid fa-rotate-right text-[10px]"></i>
                    </button>
                </div>
                <div ref={containerRef} className="w-full min-h-[300px] aspect-[4/3] sm:aspect-video relative bg-slate-50/30 dark:bg-black/20">
                    <div ref={canvasRef} className="absolute inset-0 w-full h-full" />
                </div>
            </div>
        </div>
    );
};

export default PhysicsRenderer;
