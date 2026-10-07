import { useEffect, useRef, useState } from 'react';
import {
  IconArrowBackUp,
  IconArrowUpRight,
  IconCheck,
  IconCrop,
  IconEraser,
  IconPencil,
  IconSquareDashed,
  IconTextCaption,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { ACCENTS, accentChain, createShader, playSweep } from 'glimm';

type Tool = 'pen' | 'eraser' | 'rectangle' | 'arrow' | 'text' | 'crop';
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type Stroke = {
  tool: Tool;
  color: string;
  width: number;
  points: Point[];
  text?: string;
};
type TextEditor = { point: Point; left: number; top: number; scale: number };

function rectFromPoints(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

const DEFAULT_COLOR = '#ef4444';
const COLORS = [DEFAULT_COLOR, '#f59e0b', '#3b82f6', '#111827'];
const RIPPLE_PALETTE = accentChain([
  ACCENTS.cyan,
  ACCENTS.blue,
  ACCENTS.purple,
  ACCENTS.red,
  ACCENTS.orange,
  ACCENTS.yellow,
  ACCENTS.green,
]);

export function ScreenAnnotator({
  source,
  onCancel,
  onConfirm,
}: {
  source: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shaderCanvasRef = useRef<HTMLCanvasElement>(null);
  const shaderRef = useRef<ReturnType<typeof createShader> | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const cropStartRef = useRef<Point | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>('rectangle');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [ready, setReady] = useState(false);
  const [textEditor, setTextEditor] = useState<TextEditor>();
  const [textDraft, setTextDraft] = useState('');
  const [cropRect, setCropRect] = useState<Rect>();

  strokesRef.current = strokes;

  const drawStroke = (context: CanvasRenderingContext2D, stroke: Stroke) => {
    const points = stroke.points;
    if (points.length === 0) return;
    const first = points[0]!;
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = stroke.width;
    context.globalCompositeOperation =
      stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;

    if (stroke.tool === 'text') {
      if (stroke.text) {
        context.font = `600 ${stroke.width}px ui-sans-serif, system-ui, sans-serif`;
        context.textBaseline = 'top';
        context.fillText(stroke.text, first.x, first.y);
      }
      context.restore();
      return;
    }

    const last = points.at(-1)!;
    if (stroke.tool === 'rectangle') {
      context.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
      context.restore();
      return;
    }

    if (stroke.tool === 'arrow') {
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const head = Math.min(stroke.width * 4.5, length * 0.42);
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(last.x, last.y);
      context.moveTo(last.x, last.y);
      context.lineTo(
        last.x - head * Math.cos(angle - Math.PI / 6),
        last.y - head * Math.sin(angle - Math.PI / 6),
      );
      context.moveTo(last.x, last.y);
      context.lineTo(
        last.x - head * Math.cos(angle + Math.PI / 6),
        last.y - head * Math.sin(angle + Math.PI / 6),
      );
      context.stroke();
      context.restore();
      return;
    }

    context.beginPath();
    context.moveTo(first.x, first.y);
    if (points.length === 1) {
      context.lineTo(first.x + 0.01, first.y + 0.01);
    } else {
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    }
    context.stroke();
    context.restore();
  };

  const redraw = (next: Stroke[] = strokesRef.current) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of next) drawStroke(context, stroke);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (textEditor) {
          setTextEditor(undefined);
          setTextDraft('');
        } else {
          onCancel();
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setStrokes((current) => current.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel, textEditor]);

  useEffect(() => {
    redraw(strokes);
  }, [strokes]);

  useEffect(() => {
    if (!textEditor) return;
    const frame = requestAnimationFrame(() => {
      textInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [textEditor]);

  useEffect(() => {
    if (!ready || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = shaderCanvasRef.current;
    if (!canvas) return;
    const shader = createShader({
      canvas,
      palette: RIPPLE_PALETTE,
      direction: 'ltr',
      bandTight: 7,
      swellAmount: 1,
    });
    if (!shader) return;
    shaderRef.current = shader;
    const sweep = playSweep(shader, {
      palette: RIPPLE_PALETTE,
      direction: 'ltr',
      sweepMs: 900,
      outroMs: 520,
      peakAlpha: 1.15,
      brightness: 1.35,
      bandTight: 7,
      waveAmount: 1.35,
      rippleAmount: 1.8,
      waveSpeed: 1.9,
      swellAmount: 1,
      easing: 'easeOutExpo',
    });
    sweep.done.finally(() => {
      if (shaderRef.current === shader) {
        shader.destroy();
        shaderRef.current = null;
      }
    });
    return () => {
      sweep.cancel();
      if (shaderRef.current === shader) {
        shader.destroy();
        shaderRef.current = null;
      }
    };
  }, [ready]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(canvas.width, (event.clientX - box.left) * (canvas.width / box.width)),
      ),
      y: Math.max(
        0,
        Math.min(canvas.height, (event.clientY - box.top) * (canvas.height / box.height)),
      ),
    };
  };

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready || event.button !== 0) return;
    const point = pointFromEvent(event);
    const scale = canvasRef.current!.width / canvasRef.current!.getBoundingClientRect().width;
    if (tool === 'crop') {
      event.currentTarget.setPointerCapture(event.pointerId);
      cropStartRef.current = point;
      setCropRect({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }
    if (tool === 'text') {
      event.preventDefault();
      setTextDraft('');
      setTextEditor({
        point,
        left: event.clientX,
        top: event.clientY,
        scale,
      });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: Stroke = {
      tool,
      color,
      width: (
        tool === 'pen'
          ? 4
          : tool === 'eraser'
            ? 30
            : 4
      ) * scale,
      points:
        tool === 'rectangle' || tool === 'arrow'
          ? [point, point]
          : [point],
    };
    activeStrokeRef.current = stroke;
    drawStroke(canvasRef.current!.getContext('2d')!, stroke);
  };

  const continueStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const cropStart = cropStartRef.current;
    if (cropStart) {
      setCropRect(rectFromPoints(cropStart, pointFromEvent(event)));
      return;
    }
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    const point = pointFromEvent(event);
    if (stroke.tool === 'rectangle' || stroke.tool === 'arrow') {
      stroke.points[1] = point;
    } else {
      stroke.points.push(point);
    }
    redraw();
    drawStroke(canvasRef.current!.getContext('2d')!, stroke);
  };

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (cropStartRef.current) {
      const rect = rectFromPoints(cropStartRef.current, pointFromEvent(event));
      cropStartRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setCropRect(rect.width >= 4 && rect.height >= 4 ? rect : undefined);
      return;
    }
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeStrokeRef.current = null;
    setStrokes((current) => [...current, stroke]);
  };

  const commitText = () => {
    const text = textDraft.trim();
    if (text && textEditor) {
      setStrokes((current) => [
        ...current,
        {
          tool: 'text',
          color,
          width: 24 * textEditor.scale,
          points: [textEditor.point],
          text,
        },
      ]);
    }
    setTextEditor(undefined);
    setTextDraft('');
  };

  const confirm = () => {
    const image = imageRef.current;
    const drawing = canvasRef.current;
    if (!image || !drawing || !ready) return;
    const output = document.createElement('canvas');
    output.width = drawing.width;
    output.height = drawing.height;
    const context = output.getContext('2d');
    if (!context) return;
    context.drawImage(image, 0, 0, output.width, output.height);
    context.drawImage(drawing, 0, 0);
    if (cropRect && cropRect.width >= 4 && cropRect.height >= 4) {
      const cropped = document.createElement('canvas');
      cropped.width = Math.round(cropRect.width);
      cropped.height = Math.round(cropRect.height);
      const croppedContext = cropped.getContext('2d');
      if (!croppedContext) return;
      croppedContext.drawImage(
        output,
        cropRect.x,
        cropRect.y,
        cropRect.width,
        cropRect.height,
        0,
        0,
        cropped.width,
        cropped.height,
      );
      onConfirm(cropped.toDataURL('image/png'));
      return;
    }
    onConfirm(output.toDataURL('image/png'));
  };

  const toolButton = (value: Tool, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={tool === value}
      onClick={() => setTool(value)}
      className={`group relative flex size-9 shrink-0 items-center justify-center rounded-card border transition-[color,background-color,border-color,transform] duration-150 active:scale-95 ${
        tool === value
          ? 'border-primary/25 bg-primary text-primary-foreground shadow-sm'
          : 'border-transparent text-ink-2 hover:border-line hover:bg-hover hover:text-ink'
      }`}
    >
      <span className={`transition-transform duration-150 ${tool === value ? 'scale-105' : 'group-hover:scale-105'}`}>
        {icon}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-page opacity-0 shadow-card transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </button>
  );

  const cropCss =
    cropRect && canvasRef.current
      ? {
          x: cropRect.x * (window.innerWidth / canvasRef.current.width),
          y: cropRect.y * (window.innerHeight / canvasRef.current.height),
          width: cropRect.width * (window.innerWidth / canvasRef.current.width),
          height: cropRect.height * (window.innerHeight / canvasRef.current.height),
        }
      : undefined;
  const cropShade = {
    background: 'rgba(15, 23, 42, 0.5)',
    backdropFilter: 'grayscale(1) brightness(0.62)',
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-2147483647 overflow-hidden bg-black"
      style={{ touchAction: 'none' }}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => event.preventDefault()}
    >
      <img
        ref={imageRef}
        src={source}
        alt=""
        className="absolute inset-0 h-full w-full select-none"
        draggable={false}
        onLoad={(event) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = event.currentTarget.naturalWidth;
          canvas.height = event.currentTarget.naturalHeight;
          setReady(true);
        }}
      />
      <canvas
        ref={shaderCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 h-full w-full mix-blend-screen"
      />
      <canvas
        ref={canvasRef}
        aria-label="屏幕标记画布"
        className="absolute inset-0 z-20 h-full w-full cursor-crosshair"
        onPointerDown={startStroke}
        onPointerMove={continueStroke}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      />
      {(tool === 'crop' || cropCss) && (
        <div className="pointer-events-none absolute inset-0 z-25">
          {cropCss ? (
            <>
              <div className="absolute inset-x-0 top-0" style={{ ...cropShade, height: cropCss.y }} />
              <div
                className="absolute left-0"
                style={{ ...cropShade, top: cropCss.y, width: cropCss.x, height: cropCss.height }}
              />
              <div
                className="absolute right-0"
                style={{
                  ...cropShade,
                  top: cropCss.y,
                  width: Math.max(0, window.innerWidth - cropCss.x - cropCss.width),
                  height: cropCss.height,
                }}
              />
              <div
                className="absolute inset-x-0 bottom-0"
                style={{
                  ...cropShade,
                  top: cropCss.y + cropCss.height,
                }}
              />
              <div
                className="absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                style={{
                  left: cropCss.x,
                  top: cropCss.y,
                  width: cropCss.width,
                  height: cropCss.height,
                }}
              >
                <span className="absolute -top-7 left-0 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] text-white">
                  {Math.round(cropRect!.width)} × {Math.round(cropRect!.height)}
                </span>
              </div>
            </>
          ) : (
            <div className="absolute inset-0" style={cropShade} />
          )}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
        <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1 overflow-visible rounded-2xl border border-white/20 bg-surface/95 p-1.5 shadow-raised backdrop-blur">
          {toolButton('rectangle', '矩形框选', <IconSquareDashed className="size-4.5" />)}
          {toolButton('eraser', '橡皮擦', <IconEraser className="size-4.5" />)}
          {toolButton('crop', '截取区域', <IconCrop className="size-4.5" />)}
          {toolButton('pen', '画笔', <IconPencil className="size-4.5" />)}
          {toolButton('arrow', '箭头', <IconArrowUpRight className="size-5 stroke-[1.9]" />)}
          {toolButton('text', '文本', <IconTextCaption className="size-4.5" />)}

          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          <div className="flex gap-1 px-0.5" aria-label="画笔颜色">
            {COLORS.map((item) => (
              <button
                key={item}
                type="button"
                aria-label={`选择颜色 ${item}`}
                aria-pressed={color === item}
                onClick={() => {
                  setColor(item);
                  if (tool === 'eraser') setTool('pen');
                }}
                className={`size-5 rounded-full border-2 ${
                  color === item ? 'border-ink' : 'border-transparent'
                }`}
                style={{ backgroundColor: item }}
              />
            ))}
          </div>

          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          <button
            type="button"
            aria-label="撤销"
            disabled={strokes.length === 0}
            onClick={() => setStrokes((current) => current.slice(0, -1))}
            className="group relative flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover disabled:opacity-35"
          >
            <IconArrowBackUp className="size-4.5" />
            <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-page opacity-0 shadow-card transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              撤销
            </span>
          </button>
          <button
            type="button"
            aria-label="清空标记"
            disabled={strokes.length === 0 && !cropRect}
            onClick={() => {
              setStrokes([]);
              setCropRect(undefined);
            }}
            className="group relative flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover disabled:opacity-35"
          >
            <IconTrash className="size-4.5" />
            <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-page opacity-0 shadow-card transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              清空标记
            </span>
          </button>

          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          <button
            type="button"
            aria-label="取消标记"
            onClick={onCancel}
            className="group relative flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover"
          >
            <IconX className="size-5" />
            <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-page opacity-0 shadow-card transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              取消
            </span>
          </button>
          <button
            type="button"
            aria-label="确认标记"
            disabled={!ready}
            onClick={confirm}
            className="group relative flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            <IconCheck className="size-5" />
            <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-page opacity-0 shadow-card transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              确认
            </span>
          </button>
        </div>
      </div>
      {textEditor && (
        <input
          ref={textInputRef}
          aria-label="输入标记文本"
          value={textDraft}
          onChange={(event) => setTextDraft(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitText();
            } else if (event.key === 'Escape') {
              event.stopPropagation();
              setTextEditor(undefined);
              setTextDraft('');
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
          placeholder="输入文本…"
          className="pointer-events-auto fixed z-40 min-w-40 rounded-lg border-2 bg-surface px-2.5 py-1.5 text-sm font-semibold text-ink shadow-raised outline-none"
          style={{
            left: Math.min(textEditor.left, window.innerWidth - 180),
            top: Math.min(textEditor.top, window.innerHeight - 48),
            borderColor: color,
          }}
        />
      )}
    </div>
  );
}
