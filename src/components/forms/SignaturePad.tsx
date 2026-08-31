import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../ui';

type SignaturePadProps = {
  label: string;
  required?: boolean;
  disabled?: boolean;
  onChange: (signature: Blob | null) => void;
};

export default function SignaturePad({ label, required = false, disabled = false, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const instructionsId = useId();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      const context = canvas.getContext('2d');
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      setHasSignature(false);
      onChangeRef.current(null);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const pointFor = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const beginDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFor(event);
  };

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    event.preventDefault();
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    const previous = lastPointRef.current;
    const next = pointFor(event);
    if (!context || !previous) return;
    context.strokeStyle = '#111827';
    context.lineWidth = 2.25;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPointRef.current = next;
    setHasSignature(true);
  };

  const finishDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    drawingRef.current = false;
    lastPointRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.toBlob((blob) => onChangeRef.current(blob), 'image/png');
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onChangeRef.current(null);
  };

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700" htmlFor={instructionsId}>
        {label}{required ? ' *' : ''}
      </label>
      <p id={instructionsId} className="text-xs text-gray-500">Draw your signature in the box using a finger, stylus, or mouse.</p>
      <canvas
        ref={canvasRef}
        aria-describedby={instructionsId}
        aria-label={`${label} signature pad`}
        className="h-40 w-full touch-none rounded border border-gray-300 bg-white"
        onPointerDown={beginDrawing}
        onPointerMove={draw}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-gray-500">{hasSignature ? 'Signature captured' : 'Signature is empty'}</span>
        <Button type="button" size="sm" variant="secondary" disabled={disabled || !hasSignature} onClick={clear}>Clear</Button>
      </div>
    </div>
  );
}