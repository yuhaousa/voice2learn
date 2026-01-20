
import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';

export type Tool = 'pen' | 'rect' | 'circle' | 'text' | 'eraser' | 'highlight';
export type Color = '#000000' | '#2563eb' | '#dc2626' | '#16a34a';
export type BrushStyle = 'solid' | 'dashed' | 'marker' | 'neon';

const PERSISTENCE_KEY = 'eduspark_whiteboard_state';

interface WhiteboardProps {
  onFrame?: (base64: string) => void;
}

export interface WhiteboardHandle {
  tutorDraw: (action: string, params: any) => void;
  clear: () => void;
}

const Whiteboard = forwardRef<WhiteboardHandle, WhiteboardProps>(({ onFrame }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<Color>('#000000');
  const [lineWidth, setLineWidth] = useState<number>(3);
  const [opacity, setOpacity] = useState<number>(0.4);
  const [brushStyle, setBrushStyle] = useState<BrushStyle>('solid');
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [snapShot, setSnapShot] = useState<ImageData | null>(null);

  // Expose tutor drawing methods
  useImperativeHandle(ref, () => ({
    clear: () => clearCanvas(true),
    tutorDraw: (action: string, params: any) => {
      if (action === 'clear') {
        clearCanvas(true);
        return;
      }

      const ctx = contextRef.current;
      const canvas = canvasRef.current;
      if (!ctx || !canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      const mapX = (val: number) => (val / 100) * w;
      const mapY = (val: number) => (val / 100) * h;

      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = params.color || '#2563eb';
      ctx.fillStyle = params.color || '#2563eb';
      ctx.lineWidth = 4;
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      switch (action) {
        case 'draw_rect':
          ctx.strokeRect(mapX(params.x), mapY(params.y), mapX(params.w), mapY(params.h));
          break;
        case 'draw_circle':
          ctx.beginPath();
          ctx.arc(mapX(params.x), mapY(params.y), mapX(params.r), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'draw_line':
          ctx.beginPath();
          ctx.moveTo(mapX(params.x1), mapY(params.y1));
          ctx.lineTo(mapX(params.x2), mapY(params.y2));
          ctx.stroke();
          break;
        case 'write_text':
          ctx.font = `bold 24px Fredoka, sans-serif`;
          ctx.fillText(params.text, mapX(params.x), mapY(params.y));
          break;
      }
      ctx.restore();
      saveToLocalStorage();
    }
  }));

  const saveToLocalStorage = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      try {
        localStorage.setItem(PERSISTENCE_KEY, dataUrl);
      } catch (e) {
        console.warn('Failed to save whiteboard to localStorage.');
      }
    }
  };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const link = document.createElement('a');
      link.download = `eduspark-whiteboard-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  };

  const loadFromLocalStorage = () => {
    const savedData = localStorage.getItem(PERSISTENCE_KEY);
    if (savedData) {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = contextRef.current;
        if (canvas && ctx) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.globalAlpha = 1.0;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        }
      };
      img.src = savedData;
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = color;
      contextRef.current = ctx;
      
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      loadFromLocalStorage();
    }

    const interval = setInterval(() => {
      if (onFrame && canvas) {
        onFrame(canvas.toDataURL('image/jpeg', 0.6).split(',')[1]);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const ctx = contextRef.current;
    if (!ctx) return;

    if (tool === 'eraser') {
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 25;
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
      ctx.shadowBlur = 0;
    } else if (tool === 'highlight') {
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = brushStyle === 'marker' ? 0.4 : 1.0;
      ctx.setLineDash(brushStyle === 'dashed' ? [lineWidth * 2, lineWidth * 2] : []);
      if (brushStyle === 'neon') {
        ctx.shadowBlur = lineWidth * 2;
        ctx.shadowColor = color;
      } else {
        ctx.shadowBlur = 0;
      }
    }
  }, [color, tool, lineWidth, brushStyle, opacity]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = getPos(e);
    setStartPos({ x, y });
    setIsDrawing(true);

    if (tool === 'pen' || tool === 'eraser') {
      contextRef.current?.beginPath();
      contextRef.current?.moveTo(x, y);
    } else if (tool === 'text') {
      const text = prompt('Enter your text:');
      if (text && contextRef.current) {
        contextRef.current.fillStyle = color;
        contextRef.current.globalAlpha = 1.0;
        contextRef.current.font = `${lineWidth * 5}px Inter`;
        contextRef.current.fillText(text, x, y);
        saveToLocalStorage();
      }
      setIsDrawing(false);
    } else {
      const canvas = canvasRef.current;
      if (canvas && contextRef.current) {
        setSnapShot(contextRef.current.getImageData(0, 0, canvas.width, canvas.height));
      }
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const { x, y } = getPos(e);
    const ctx = contextRef.current;
    if (!ctx) return;

    if (tool === 'pen' || tool === 'eraser') {
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (tool === 'rect' || tool === 'circle' || tool === 'highlight') {
      if (snapShot) ctx.putImageData(snapShot, 0, 0);
      ctx.beginPath();
      if (tool === 'rect') {
        ctx.strokeRect(startPos.x, startPos.y, x - startPos.x, y - startPos.y);
      } else if (tool === 'circle') {
        const radius = Math.sqrt(Math.pow(x - startPos.x, 2) + Math.pow(y - startPos.y, 2));
        ctx.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (tool === 'highlight') {
        ctx.fillRect(startPos.x, startPos.y, x - startPos.x, y - startPos.y);
      }
    }
  };

  const endDrawing = () => {
    if (isDrawing) {
      contextRef.current?.closePath();
      setIsDrawing(false);
      setSnapShot(null);
      saveToLocalStorage();
    }
  };

  const clearCanvas = (skipConfirm = false) => {
    if (!skipConfirm && !confirm('Are you sure you want to clear the whiteboard?')) return;
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (canvas && ctx) {
      // Clear persistence immediately
      localStorage.removeItem(PERSISTENCE_KEY);
      
      ctx.save();
      // Use setTransform to clear the raw pixel buffer accurately
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'white';
      ctx.globalAlpha = 1.0;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      
      setSnapShot(null);
      // Ensure sync between memory and local storage as blank
      saveToLocalStorage();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = contextRef.current;
        if (!canvas || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const maxWidth = canvas.width / dpr;
        const maxHeight = canvas.height / dpr;
        const ratio = Math.min(maxWidth / img.width, maxHeight / img.height);
        const newWidth = img.width * ratio;
        const newHeight = img.height * ratio;
        const x = (maxWidth - newWidth) / 2;
        const y = (maxHeight - newHeight) / 2;
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.drawImage(img, x, y, newWidth, newHeight);
        ctx.restore();
        saveToLocalStorage();
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-2xl border border-indigo-100 overflow-hidden shadow-inner relative">
      <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />

      <div className="p-3 bg-white border-b border-indigo-100 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {(['pen', 'rect', 'circle', 'text', 'eraser', 'highlight'] as Tool[]).map((t) => (
              <button
                key={t}
                onClick={() => setTool(t)}
                className={`p-2 rounded-lg transition-all ${tool === t ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-indigo-500'}`}
                title={t.charAt(0).toUpperCase() + t.slice(1)}
              >
                {t === 'pen' && '✏️'} {t === 'rect' && '⬜'} {t === 'circle' && '⭕'} {t === 'text' && 'T'} {t === 'eraser' && '🧽'} {t === 'highlight' && '🖍️'}
              </button>
            ))}
            <div className="w-px h-6 bg-slate-200 mx-1"></div>
            <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-lg text-slate-500 hover:text-indigo-500 transition-all" title="Upload Question Photo">🖼️</button>
          </div>

          {tool === 'highlight' && (
            <div className="flex items-center gap-1 bg-indigo-50 p-1 rounded-xl animate-in fade-in duration-300">
               <span className="text-[10px] font-bold text-indigo-400 px-1">OPACITY</span>
               {[0.2, 0.4, 0.6].map((o) => (
                 <button key={o} onClick={() => setOpacity(o)} className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-all ${opacity === o ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>{o * 100}%</button>
               ))}
            </div>
          )}

          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
            {[2, 5, 10, 20].map((size) => (
              <button key={size} onClick={() => setLineWidth(size)} className={`flex items-center justify-center rounded-lg transition-all ${lineWidth === size ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-indigo-500'}`} style={{ width: '32px', height: '32px' }} title={`Size ${size}`}>
                <div className="rounded-full bg-current" style={{ width: `${Math.max(2, size/1.5)}px`, height: `${Math.max(2, size/1.5)}px` }} />
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {(['solid', 'dashed', 'marker', 'neon'] as BrushStyle[]).map((style) => (
              <button key={style} onClick={() => setBrushStyle(style)} className={`px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all ${brushStyle === style ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-indigo-500'}`}>{style}</button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {(['#000000', '#2563eb', '#dc2626', '#16a34a'] as Color[]).map((c) => (
              <button key={c} onClick={() => setColor(c)} className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? 'border-white ring-2 ring-indigo-400' : 'border-transparent'}`} style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex gap-1">
             <button onClick={saveToLocalStorage} className="p-1.5 text-[10px] font-black bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition shadow-sm border border-indigo-100" title="Auto-save to browser storage">AUTO-SAVE</button>
             <button onClick={downloadCanvas} className="p-1.5 text-[10px] font-black bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition shadow-sm border border-green-100">DOWNLOAD</button>
             <button onClick={() => clearCanvas()} className="p-1.5 text-[10px] font-black bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition shadow-sm border border-red-100">CLEAR</button>
          </div>
        </div>
      </div>

      <div className="flex-1 relative cursor-crosshair touch-none bg-white">
        <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={endDrawing} onMouseLeave={endDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={endDrawing} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
});

export default Whiteboard;
