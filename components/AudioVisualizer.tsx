
import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isListening: boolean;
  isSpeaking: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isListening, isSpeaking }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let offset = 0;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      const bars = 40;
      const spacing = 4;
      const barWidth = (canvas.width - (bars - 1) * spacing) / bars;
      
      for (let i = 0; i < bars; i++) {
        let height = 10;
        if (isListening || isSpeaking) {
          // Simulate some motion
          const amplitude = isSpeaking ? 40 : 20;
          height = 10 + Math.abs(Math.sin((i * 0.5) + offset)) * amplitude;
        }

        const x = i * (barWidth + spacing);
        const y = centerY - height / 2;
        
        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        if (isSpeaking) {
          gradient.addColorStop(0, '#818cf8');
          gradient.addColorStop(1, '#c084fc');
        } else {
          gradient.addColorStop(0, '#34d399');
          gradient.addColorStop(1, '#60a5fa');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, height, 10);
        ctx.fill();
      }

      offset += 0.15;
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isListening, isSpeaking]);

  return (
    <div className="w-full flex justify-center py-8">
      <canvas 
        ref={canvasRef} 
        width={320} 
        height={100} 
        className="w-full max-w-md h-24"
      />
    </div>
  );
};

export default AudioVisualizer;
