
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { SessionConfig, ChatMessage } from '../types';
import { TUTOR_SYSTEM_INSTRUCTION } from '../constants';
import { decode, decodeAudioData, createPcmBlob } from '../services/audioUtils';
import AudioVisualizer from './AudioVisualizer';
import Whiteboard, { WhiteboardHandle } from './Whiteboard';

interface SessionUIProps {
  config: SessionConfig;
  onEnd: () => void;
}

const DRAW_TOOL: FunctionDeclaration = {
  name: 'draw_on_whiteboard',
  parameters: {
    type: Type.OBJECT,
    description: 'Allows the tutor to draw shapes or write text on the whiteboard to explain concepts.',
    properties: {
      action: {
        type: Type.STRING,
        description: 'The type of drawing action to perform.',
        enum: ['draw_rect', 'draw_circle', 'draw_line', 'write_text', 'clear'],
      },
      params: {
        type: Type.OBJECT,
        description: 'Parameters for the drawing action. Coordinates (x, y) are 0-100 relative to board size.',
        properties: {
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          w: { type: Type.NUMBER, description: 'Width for rectangles' },
          h: { type: Type.NUMBER, description: 'Height for rectangles' },
          r: { type: Type.NUMBER, description: 'Radius for circles' },
          x1: { type: Type.NUMBER },
          y1: { type: Type.NUMBER },
          x2: { type: Type.NUMBER },
          y2: { type: Type.NUMBER },
          text: { type: Type.STRING },
          color: { type: Type.STRING, description: 'Hex color string' }
        }
      }
    },
    required: ['action', 'params']
  }
};

const SessionUI: React.FC<SessionUIProps> = ({ config, onEnd }) => {
  const [isConnecting, setIsConnecting] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [transcriptState, setTranscriptState] = useState({ user: '', model: '' });
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'visualizer'>('canvas');

  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const whiteboardRef = useRef<WhiteboardHandle>(null);
  const transcriptRef = useRef({ user: '', model: '' });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, transcriptState]);

  useEffect(() => {
    let isMounted = true;

    const startSession = async () => {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        audioContextsRef.current = { input: inputCtx, output: outputCtx };

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        const sessionPromise = ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          callbacks: {
            onopen: () => {
              if (!isMounted) return;
              setIsConnecting(false);
              const source = inputCtx.createMediaStreamSource(stream);
              const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
              scriptProcessor.onaudioprocess = (e) => {
                if (isPaused) return; // Stop sending when paused
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createPcmBlob(inputData);
                sessionPromise.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              };
              source.connect(scriptProcessor);
              scriptProcessor.connect(inputCtx.destination);
            },
            onmessage: async (message: LiveServerMessage) => {
              if (!isMounted) return;

              // Handle function calls (Drawing)
              if (message.toolCall) {
                for (const fc of message.toolCall.functionCalls) {
                  if (fc.name === 'draw_on_whiteboard') {
                    whiteboardRef.current?.tutorDraw(fc.args.action, fc.args.params);
                    sessionPromise.then(s => s.sendToolResponse({
                      functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                    }));
                  }
                }
              }

              // Skip processing audio/text if paused (though usually pause stops input)
              if (isPaused) return;

              if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text;
                transcriptRef.current.model += text;
                setTranscriptState(prev => ({ ...prev, model: transcriptRef.current.model }));
              } else if (message.serverContent?.inputTranscription) {
                const text = message.serverContent.inputTranscription.text;
                transcriptRef.current.user += text;
                setTranscriptState(prev => ({ ...prev, user: transcriptRef.current.user }));
              }

              if (message.serverContent?.turnComplete) {
                const finalUser = transcriptRef.current.user;
                const finalModel = transcriptRef.current.model;
                if (finalUser.trim() || finalModel.trim()) {
                  setMessages(prev => [
                    ...prev,
                    ...(finalUser.trim() ? [{ id: `user-${Date.now()}`, role: 'user' as const, text: finalUser, timestamp: Date.now() }] : []),
                    ...(finalModel.trim() ? [{ id: `model-${Date.now()}`, role: 'model' as const, text: finalModel, timestamp: Date.now() }] : [])
                  ]);
                }
                transcriptRef.current = { user: '', model: '' };
                setTranscriptState({ user: '', model: '' });
              }

              const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
              if (base64Audio && !isPaused) {
                setIsSpeaking(true);
                const outputCtx = audioContextsRef.current?.output;
                if (!outputCtx) return;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                const audioBuffer = await decodeAudioData(decode(base64Audio), outputCtx, 24000, 1);
                const source = outputCtx.createBufferSource();
                source.buffer = audioBuffer;
                const gainNode = outputCtx.createGain();
                source.connect(gainNode);
                gainNode.connect(outputCtx.destination);
                source.addEventListener('ended', () => {
                  activeSourcesRef.current.delete(source);
                  if (activeSourcesRef.current.size === 0) setIsSpeaking(false);
                });
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                activeSourcesRef.current.add(source);
              }

              if (message.serverContent?.interrupted) {
                activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
                activeSourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                setIsSpeaking(false);
              }
            },
            onerror: (e) => {
              console.error('Session Error:', e);
              setError("Oops! Something went wrong with the connection.");
            },
            onclose: () => { if (isMounted) onEnd(); }
          },
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: TUTOR_SYSTEM_INSTRUCTION(config.grade, config.subject.name),
            tools: [{ functionDeclarations: [DRAW_TOOL] }],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            outputAudioTranscription: {},
            inputAudioTranscription: {},
          }
        });
        sessionRef.current = await sessionPromise;
      } catch (err) {
        console.error('Start Session Error:', err);
        setError("Could not access microphone or connect to EduSpark.");
      }
    };

    startSession();

    return () => {
      isMounted = false;
      if (sessionRef.current) sessionRef.current.close();
      if (audioContextsRef.current) {
        audioContextsRef.current.input.close();
        audioContextsRef.current.output.close();
      }
    };
  }, [config, onEnd]);

  // Handle Pause/Resume UI side
  useEffect(() => {
    if (isPaused) {
      // Clear active audio buffers to silent the tutor immediately
      activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
      activeSourcesRef.current.clear();
      setIsSpeaking(false);
    }
  }, [isPaused]);

  const handleWhiteboardFrame = (base64: string) => {
    if (sessionRef.current && !isPaused) {
      sessionRef.current.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-white rounded-3xl shadow-xl border border-red-100 max-w-lg mx-auto mt-20">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-red-600 mb-2">Connection Problem</h2>
        <p className="text-slate-600 text-center mb-6">{error}</p>
        <button onClick={onEnd} className="px-6 py-2 bg-slate-900 text-white rounded-full hover:bg-slate-800 transition">Go Back</button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 h-screen flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl ${config.subject.color} flex items-center justify-center text-xl shadow-md`}>{config.subject.icon}</div>
          <div>
            <h1 className="text-xl font-bold font-heading text-slate-900">{config.subject.name} Session</h1>
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">{config.grade}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsPaused(!isPaused)} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all shadow-sm flex items-center gap-2 ${isPaused ? 'bg-green-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
            {isPaused ? '▶️ Resume' : '⏸️ Pause'}
          </button>
          <div className="w-px h-6 bg-slate-200 mx-1"></div>
          <button onClick={() => setViewMode('canvas')} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all shadow-sm ${viewMode === 'canvas' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Whiteboard</button>
          <button onClick={() => setViewMode('visualizer')} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all shadow-sm ${viewMode === 'visualizer' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Focus</button>
          <div className="w-px h-6 bg-slate-200 mx-1"></div>
          <button onClick={onEnd} className="px-4 py-1.5 bg-red-50 text-red-600 rounded-full text-sm font-bold hover:bg-red-100 transition shadow-sm">End</button>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden min-h-0 relative">
        {isPaused && (
          <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center text-white animate-in fade-in zoom-in duration-300">
            <div className="p-8 bg-slate-800 rounded-3xl shadow-2xl border border-slate-700 text-center space-y-6 max-w-sm">
               <div className="text-6xl animate-pulse">⏸️</div>
               <div className="space-y-2">
                  <h2 className="text-2xl font-black uppercase tracking-tight">Session Paused</h2>
                  <p className="text-slate-400 text-sm font-medium">Take a breath! EduSpark is waiting for you to come back.</p>
               </div>
               <button onClick={() => setIsPaused(false)} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 rounded-2xl font-black text-lg shadow-xl transition-all active:scale-95">RESUME LEARNING</button>
            </div>
          </div>
        )}

        <div className="flex-[3] flex flex-col gap-4 overflow-hidden">
          <div className="flex-1 bg-white rounded-3xl shadow-lg border border-indigo-50 overflow-hidden relative flex flex-col">
            {isConnecting ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                <p className="text-slate-500 font-medium font-heading">EduSpark is waking up...</p>
              </div>
            ) : viewMode === 'canvas' ? (
              <Whiteboard ref={whiteboardRef} onFrame={handleWhiteboardFrame} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="mb-6">
                  <AudioVisualizer isListening={!isSpeaking && !isPaused} isSpeaking={isSpeaking} />
                </div>
                <div className="max-w-md space-y-4">
                  <h2 className="text-2xl font-bold text-slate-900">Learning in Progress</h2>
                  <p className="text-slate-700 font-medium italic">" {transcriptState.user || '... listening ...'} "</p>
                  <p className="text-indigo-700 font-bold text-xl leading-relaxed">{transcriptState.model}</p>
                </div>
              </div>
            )}
          </div>

          <div ref={scrollRef} className="h-48 bg-sky-50 rounded-2xl p-4 overflow-y-auto space-y-4 border border-sky-100 shadow-inner scroll-smooth">
             {messages.length === 0 && !transcriptState.user && !transcriptState.model && (
               <div className="flex flex-col items-center justify-center h-full opacity-60">
                  <div className="text-2xl mb-2">💬</div>
                  <p className="text-sky-500 text-xs font-bold uppercase tracking-widest">Conversation Log</p>
               </div>
             )}
             {messages.map(msg => (
               <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm shadow-sm ${msg.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-white text-slate-800 border border-sky-200'}`}>
                   <span className={`block text-[10px] mb-1 font-black uppercase tracking-tighter ${msg.role === 'user' ? 'text-indigo-100' : 'text-indigo-600'}`}>
                     {msg.role === 'user' ? 'Student' : 'EduSpark'}
                   </span>
                   <p className="leading-relaxed font-medium">{msg.text}</p>
                 </div>
               </div>
             ))}
             {transcriptState.user && (
               <div className="flex justify-end">
                 <div className="max-w-[85%] px-4 py-2 rounded-2xl text-sm bg-indigo-600 text-white italic animate-pulse border border-indigo-400 shadow-lg">
                   <span className="block text-[10px] mb-1 font-black uppercase tracking-tighter text-indigo-200">Listening...</span>
                   {transcriptState.user}
                 </div>
               </div>
             )}
             {transcriptState.model && (
               <div className="flex justify-start">
                 <div className="max-w-[85%] px-4 py-2 rounded-2xl text-sm bg-white/90 text-slate-800 border border-sky-300 shadow-sm">
                   <span className="block text-[10px] mb-1 font-black uppercase tracking-tighter text-indigo-600">EduSpark Speaking...</span>
                   {transcriptState.model}
                 </div>
               </div>
             )}
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-6 shrink-0">
          <div className="bg-white rounded-3xl p-6 shadow-lg border border-indigo-50 flex flex-col items-center text-center space-y-4">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center text-5xl bg-gradient-to-br from-indigo-100 to-purple-100 shadow-inner border-4 border-white transition-transform duration-300 ${isSpeaking ? 'scale-110' : ''}`}>✨</div>
            <div>
              <h3 className="font-bold text-lg font-heading text-slate-900">EduSpark Tutor</h3>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">K-12 Expert</p>
            </div>
            <div className="w-full space-y-2 pt-4 border-t border-slate-100">
              <div className={`px-4 py-2 rounded-xl text-[10px] font-black flex items-center justify-between gap-2 uppercase tracking-tighter shadow-sm transition-colors ${isSpeaking ? 'bg-indigo-600 text-white animate-pulse' : 'bg-slate-100 text-slate-500'}`}>
                <span>EDUSPARK VOICE</span>
                <div className="flex gap-0.5 h-3 items-center">
                   <div className={`w-1 h-full bg-current rounded-full ${isSpeaking ? 'animate-[bounce_0.8s_infinite]' : 'opacity-20'}`}></div>
                   <div className={`w-1 h-full bg-current rounded-full ${isSpeaking ? 'animate-[bounce_1.1s_infinite]' : 'opacity-20'}`}></div>
                   <div className={`w-1 h-full bg-current rounded-full ${isSpeaking ? 'animate-[bounce_0.9s_infinite]' : 'opacity-20'}`}></div>
                </div>
              </div>
              <div className={`px-4 py-2 rounded-xl text-[10px] font-black flex items-center justify-between gap-2 uppercase tracking-tighter shadow-sm transition-colors ${!isSpeaking && !isPaused ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                <span>MIC LISTENING</span>
                <div className={`w-2 h-2 rounded-full ${!isSpeaking && !isPaused ? 'bg-white animate-ping' : 'bg-slate-300'}`}></div>
              </div>
            </div>
          </div>
          <div className="flex-1 bg-indigo-600 rounded-3xl p-6 text-white shadow-xl overflow-hidden relative group">
            <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
            <h4 className="font-bold text-sm mb-4 flex items-center gap-2"><span className="p-1 bg-white/20 rounded-md">💡</span> Pro Tutor Tips</h4>
            <ul className="text-xs space-y-4 font-medium">
              <li className="flex gap-3 leading-relaxed"><span className="text-indigo-200">01.</span><span>The whiteboard is shared! Write or draw and ask me for feedback.</span></li>
              <li className="flex gap-3 leading-relaxed"><span className="text-indigo-200">02.</span><span>I can draw on the board too! Ask me to diagram a concept for you.</span></li>
              <li className="flex gap-3 leading-relaxed"><span className="text-indigo-200">03.</span><span>Need a break? Hit the Pause button at any time.</span></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SessionUI;
