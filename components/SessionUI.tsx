
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { SessionConfig, ChatMessage } from '../types';
import { TUTOR_SYSTEM_INSTRUCTION } from '../constants';
import { decode, decodeAudioData, createPcmBlob } from '../services/audioUtils';
import AudioVisualizer from './AudioVisualizer';
import Whiteboard, { WhiteboardHandle } from './Whiteboard';

interface LearningMaterial {
  title: string;
  content: string;
  imageUrl?: string;
  isGenerating?: boolean;
}

interface SessionUIProps {
  config: SessionConfig;
  onEnd: () => void;
}

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error' | 'ready_to_start';

const formatAIText = (text: string): string => {
  return text.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
};

const DRAW_TOOL: FunctionDeclaration = {
  name: 'draw_on_whiteboard',
  parameters: {
    type: Type.OBJECT,
    description: 'Allows the tutor to draw shapes or write text on the whiteboard.',
    properties: {
      action: { type: Type.STRING, enum: ['draw_rect', 'draw_circle', 'draw_line', 'write_text', 'clear'] },
      params: {
        type: Type.OBJECT,
        properties: {
          x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, w: { type: Type.NUMBER }, h: { type: Type.NUMBER },
          r: { type: Type.NUMBER }, x1: { type: Type.NUMBER }, y1: { type: Type.NUMBER }, x2: { type: Type.NUMBER },
          y2: { type: Type.NUMBER }, text: { type: Type.STRING }, color: { type: Type.STRING }
        }
      }
    },
    required: ['action', 'params']
  }
};

const MATERIAL_TOOL: FunctionDeclaration = {
  name: 'show_learning_material',
  parameters: {
    type: Type.OBJECT,
    description: 'Displays an educational card. Can generate images.',
    properties: {
      title: { type: Type.STRING },
      content: { type: Type.STRING },
      imageUrl: { type: Type.STRING },
      image_prompt: { type: Type.STRING },
      action: { type: Type.STRING, enum: ['show', 'hide'] }
    },
    required: ['title', 'content', 'action']
  }
};

const SessionUI: React.FC<SessionUIProps> = ({ config, onEnd }) => {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [transcriptState, setTranscriptState] = useState({ user: '', model: '' });
  const [viewMode, setViewMode] = useState<'canvas' | 'materials' | 'visualizer'>('materials');
  const [currentMaterial, setCurrentMaterial] = useState<LearningMaterial | null>(null);
  const [hasNewMaterial, setHasNewMaterial] = useState(false);

  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const whiteboardRef = useRef<WhiteboardHandle>(null);
  const transcriptTextRef = useRef({ user: '', model: '' });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const isConnectingRef = useRef(false);
  const isConnectedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Auto-scroll logic with enhanced precision
  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, transcriptState.user, transcriptState.model]);

  const cleanupAudio = useCallback(() => {
    activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const stopEverything = useCallback(() => {
    cleanupAudio();
    isConnectedRef.current = false;
    isConnectingRef.current = false;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    sessionPromiseRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, [cleanupAudio]);

  const downloadMaterialImage = () => {
    if (currentMaterial?.imageUrl) {
      const link = document.createElement('a');
      link.download = `eduspark-material-${Date.now()}.png`;
      link.href = currentMaterial.imageUrl;
      link.click();
    }
  };

  const generateImageForMaterial = async (prompt: string) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: `High quality educational illustration for student: ${prompt}` }] },
        config: { imageConfig: { aspectRatio: "16:9" } }
      });
      const imagePart = response.candidates[0].content.parts.find(p => p.inlineData);
      if (imagePart?.inlineData) {
        const url = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
        setCurrentMaterial(prev => prev ? { ...prev, imageUrl: url, isGenerating: false } : null);
      }
    } catch (err) {
      console.error("Image generation failed:", err);
      setCurrentMaterial(prev => prev ? { ...prev, isGenerating: false } : null);
    }
  };

  const activateAudioAndGreet = async () => {
    try {
      if (audioContextsRef.current) {
        await audioContextsRef.current.output.resume();
        await audioContextsRef.current.input.resume();
      }
      
      // Ensure session exists before marking as connected
      if (sessionRef.current) {
        isConnectedRef.current = true;
        setStatus('connected');
        
        const greetingPrompt = config.subject.id === 'chinese'
          ? `[SYSTEM: 立即开始。用非常热情的声音问候学生，大声介绍你自己是 EduSpark 老师。]`
          : `[SYSTEM: Start now. Greet the student enthusiastically and introduce yourself as EduSpark.]`;
          
        sessionRef.current.send({
          clientContent: { turns: [{ role: 'user', parts: [{ text: greetingPrompt }] }], turnComplete: true }
        });
      }
    } catch (err) {
      console.error("Activation failed", err);
    }
  };

  const connectToLiveAPI = useCallback(async (isReconnect = false) => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    
    if (!isReconnect) {
      setStatus('connecting');
      stopEverything();
    } else {
      setStatus('reconnecting');
      cleanupAudio();
      if (sessionRef.current) try { sessionRef.current.close(); } catch(e) {}
    }

    try {
      if (!audioContextsRef.current) {
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        audioContextsRef.current = { input: inputCtx, output: outputCtx };
      }

      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      }
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            console.log("Live Session Opened");
            reconnectAttemptsRef.current = 0;
            isConnectingRef.current = false;
            
            if (isReconnect) {
              isConnectedRef.current = true;
              setStatus('connected');
            } else {
              // Wait for user gesture to mark as actually "connected"
              setStatus('ready_to_start');
            }

            const source = audioContextsRef.current!.input.createMediaStreamSource(streamRef.current!);
            const scriptProcessor = audioContextsRef.current!.input.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              // Strictly only send input if explicitly connected via button
              if (!isConnectedRef.current) return; 
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(s => {
                if (s && isConnectedRef.current) {
                  try { s.sendRealtimeInput({ media: pcmBlob }); } catch(err) {}
                }
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextsRef.current!.input.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'draw_on_whiteboard') {
                  whiteboardRef.current?.tutorDraw(fc.args.action, fc.args.params);
                  sessionPromise.then(s => s?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } }));
                } else if (fc.name === 'show_learning_material') {
                  if (fc.args.action === 'show') {
                    setCurrentMaterial({ 
                      title: formatAIText(fc.args.title), 
                      content: formatAIText(fc.args.content), 
                      imageUrl: fc.args.imageUrl,
                      isGenerating: !!fc.args.image_prompt
                    });
                    setHasNewMaterial(true);
                    setViewMode('materials');
                    if (fc.args.image_prompt) generateImageForMaterial(fc.args.image_prompt);
                  }
                  sessionPromise.then(s => s?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } }));
                }
              }
            }

            if (message.serverContent?.outputTranscription) {
              transcriptTextRef.current.model += message.serverContent.outputTranscription.text;
              setTranscriptState(prev => ({ ...prev, model: formatAIText(transcriptTextRef.current.model) }));
            } else if (message.serverContent?.inputTranscription) {
              transcriptTextRef.current.user += message.serverContent.inputTranscription.text;
              setTranscriptState(prev => ({ ...prev, user: transcriptTextRef.current.user }));
            }

            if (message.serverContent?.turnComplete) {
              const uTxt = transcriptTextRef.current.user;
              const mTxt = formatAIText(transcriptTextRef.current.model);
              if (uTxt.trim() || mTxt.trim()) {
                setMessages(prev => [
                  ...prev,
                  ...(uTxt.trim() ? [{ id: `u-${Date.now()}`, role: 'user' as const, text: uTxt, timestamp: Date.now() }] : []),
                  ...(mTxt.trim() ? [{ id: `m-${Date.now()}`, role: 'model' as const, text: mTxt, timestamp: Date.now() }] : [])
                ]);
              }
              transcriptTextRef.current = { user: '', model: '' };
              setTranscriptState({ user: '', model: '' });
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setIsSpeaking(true);
              const oCtx = audioContextsRef.current?.output;
              if (oCtx) {
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, oCtx.currentTime);
                const audioBuffer = await decodeAudioData(decode(base64Audio), oCtx, 24000, 1);
                const source = oCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(oCtx.destination);
                source.onended = () => {
                  activeSourcesRef.current.delete(source);
                  if (activeSourcesRef.current.size === 0) setIsSpeaking(false);
                };
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                activeSourcesRef.current.add(source);
              }
            }
            if (message.serverContent?.interrupted) cleanupAudio();
          },
          onerror: (e) => { 
            console.error('Session Error:', e);
            handleDisconnect();
          },
          onclose: () => { 
            console.log('Session Closed');
            handleDisconnect();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: TUTOR_SYSTEM_INSTRUCTION(config.grade, config.subject.name),
          tools: [{ functionDeclarations: [DRAW_TOOL, MATERIAL_TOOL] }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        }
      });
      sessionPromiseRef.current = sessionPromise;
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Connection failed", err);
      handleDisconnect();
    }
  }, [config, cleanupAudio, stopEverything]);

  const handleDisconnect = useCallback(() => {
    isConnectedRef.current = false;
    isConnectingRef.current = false;
    
    if (reconnectAttemptsRef.current < 5) {
      const delay = Math.pow(2, reconnectAttemptsRef.current) * 1000;
      reconnectAttemptsRef.current++;
      setStatus('reconnecting');
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectToLiveAPI(true);
      }, delay);
    } else {
      setStatus('error');
    }
  }, [connectToLiveAPI]);

  useEffect(() => {
    // Start initial connection setup
    connectToLiveAPI();
    return stopEverything;
  }, []);

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8 h-screen flex flex-col overflow-hidden relative font-sans">
      {/* Enhanced Initialization Overlay */}
      {(status === 'ready_to_start' || status === 'connecting') && (
        <div className="absolute inset-0 z-[100] bg-indigo-600/95 backdrop-blur-2xl flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="bg-white rounded-[4rem] p-16 shadow-2xl max-w-xl w-full text-center space-y-12 border-[16px] border-white/20 transform transition-all scale-100 hover:scale-[1.01]">
            <div className="relative mx-auto w-32 h-32 flex items-center justify-center">
               <div className="absolute inset-0 bg-indigo-50 rounded-full animate-ping opacity-20"></div>
               <div className="text-9xl relative z-10 animate-bounce drop-shadow-xl">👩‍🏫</div>
            </div>
            
            <div className="space-y-4">
              <h2 className="text-5xl font-black text-slate-900 font-heading tracking-tight">
                {status === 'connecting' ? 'Setting up Class...' : 'Teacher is Ready!'}
              </h2>
              <p className="text-2xl text-slate-600 font-medium leading-relaxed">
                {status === 'connecting' 
                  ? 'Connecting to the EduSpark smart classroom...' 
                  : 'Your classroom is ready. Shall we begin the lesson?'}
              </p>
            </div>

            {status === 'ready_to_start' ? (
              <button 
                onClick={activateAudioAndGreet} 
                className="w-full py-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[3rem] font-black text-3xl shadow-2xl transition-all active:scale-95 flex items-center justify-center gap-4 group"
              >
                🚀 START LESSON
                <span className="group-hover:translate-x-2 transition-transform">→</span>
              </button>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                <span className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em]">Synchronizing...</span>
              </div>
            )}
            
            <button onClick={onEnd} className="text-slate-400 text-sm font-bold hover:text-slate-600 underline">Exit Classroom</button>
          </div>
        </div>
      )}

      {/* Header with connection status */}
      <div className="flex items-center justify-between mb-6 shrink-0 z-10">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl ${config.subject.color} flex items-center justify-center text-2xl shadow-lg ring-4 ring-white`}>{config.subject.icon}</div>
          <div>
            <h1 className="text-2xl font-black font-heading text-slate-900 leading-none mb-1">{config.subject.name}</h1>
            <div className="flex items-center gap-2">
               <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">{config.grade}</p>
               <span className="w-1.5 h-1.5 bg-slate-200 rounded-full"></span>
               <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${status === 'connected' ? 'bg-green-500 animate-pulse' : status === 'reconnecting' ? 'bg-amber-400 animate-spin' : 'bg-red-400'}`}></div>
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {status === 'connected' ? 'Live Session' : status === 'reconnecting' ? 'Reconnecting...' : 'Offline'}
                  </span>
               </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {status === 'error' && (
            <button onClick={() => connectToLiveAPI()} className="px-6 py-2 bg-amber-500 text-white rounded-full text-sm font-black shadow-lg shadow-amber-200 animate-pulse">Reconnect Now</button>
          )}
          <button onClick={() => { setViewMode('materials'); setHasNewMaterial(false); }} className={`px-5 py-2 rounded-full text-sm font-black relative transition-all ${viewMode === 'materials' ? 'bg-indigo-600 text-white shadow-xl scale-105' : 'bg-white text-slate-600 border border-indigo-50 hover:bg-indigo-50'}`}>
            📖 Material
            {hasNewMaterial && viewMode !== 'materials' && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full border-2 border-white animate-bounce"></span>}
          </button>
          <button onClick={() => setViewMode('canvas')} className={`px-5 py-2 rounded-full text-sm font-black transition-all ${viewMode === 'canvas' ? 'bg-indigo-600 text-white shadow-xl scale-105' : 'bg-white text-slate-600 border border-indigo-50 hover:bg-indigo-50'}`}>🖌️ Board</button>
          <button onClick={() => setViewMode('visualizer')} className={`px-5 py-2 rounded-full text-sm font-black transition-all ${viewMode === 'visualizer' ? 'bg-indigo-600 text-white shadow-xl scale-105' : 'bg-white text-slate-600 border border-indigo-50 hover:bg-indigo-50'}`}>✨ Focus</button>
          <div className="w-px h-8 bg-slate-200 mx-1"></div>
          <button onClick={onEnd} className="px-5 py-2 bg-red-50 text-red-600 rounded-full text-sm font-black hover:bg-red-100 transition-colors">Exit</button>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden min-h-0 relative">
        <div className="flex-[3.5] flex flex-col gap-4 overflow-hidden">
          {/* Main Workspace */}
          <div className="flex-1 bg-white rounded-[3rem] shadow-2xl border border-indigo-50 overflow-hidden relative flex flex-col group transition-all duration-500">
            {viewMode === 'canvas' ? (
              <Whiteboard ref={whiteboardRef} onFrame={(b64) => { if (isConnectedRef.current) sessionRef.current?.sendRealtimeInput({ media: { data: b64, mimeType: 'image/jpeg' } }) }} />
            ) : viewMode === 'materials' ? (
              currentMaterial ? (
                <div className="flex-1 flex flex-col overflow-y-auto p-10 bg-slate-50/20">
                  <div className="max-w-5xl mx-auto w-full space-y-10">
                    <h2 className="text-5xl font-medium text-slate-900 font-heading text-center leading-tight tracking-tight">{currentMaterial.title}</h2>
                    <div className="relative rounded-[3rem] overflow-hidden shadow-[0_24px_48px_-8px_rgba(0,0,0,0.12)] border-[12px] border-white bg-slate-100 aspect-video flex items-center justify-center group/img">
                      {currentMaterial.isGenerating ? (
                        <div className="flex flex-col items-center gap-6 text-indigo-500">
                          <div className="w-16 h-16 border-[6px] border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                          <p className="font-black animate-pulse uppercase text-xs tracking-[0.3em]">AI is drawing for you...</p>
                        </div>
                      ) : currentMaterial.imageUrl ? (
                        <>
                          <img src={currentMaterial.imageUrl} className="w-full h-full object-contain" alt="Lesson Visual" />
                          <button 
                            onClick={downloadMaterialImage}
                            className="absolute top-6 right-6 p-4 bg-white/90 backdrop-blur-md shadow-xl rounded-2xl text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all opacity-0 group-hover/img:opacity-100 flex items-center gap-2 font-bold text-sm"
                          >
                            <span>Download Visual</span>
                            <span className="text-lg">💾</span>
                          </button>
                        </>
                      ) : (
                        <div className="text-slate-200 text-9xl">🏛️</div>
                      )}
                    </div>
                    <div className="bg-white p-10 rounded-[3rem] shadow-xl text-slate-800 text-2xl font-normal whitespace-pre-wrap leading-relaxed border border-indigo-50/50">
                      {currentMaterial.content}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
                   <div className="text-[8rem] mb-10 animate-pulse opacity-20">🏛️</div>
                   <h3 className="text-5xl font-black text-slate-900 font-heading mb-6 tracking-tight">Interactive Canvas</h3>
                   <p className="text-slate-400 text-2xl max-w-lg font-medium">Sit back and listen. Educational materials and diagrams will pop up here as the teacher speaks.</p>
                </div>
              )
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gradient-to-b from-white to-indigo-50/20 relative">
                <AudioVisualizer isListening={!isSpeaking && status === 'connected'} isSpeaking={isSpeaking} />
                <div className="max-w-3xl w-full mt-12">
                  <div className="p-12 bg-indigo-600 rounded-[3rem] shadow-[0_20px_50px_rgba(79,70,229,0.3)] border-b-[10px] border-indigo-800 transform transition-transform group-hover:scale-[1.02]">
                     <p className="text-white font-medium text-5xl leading-[1.3] text-left">
                       {transcriptState.model || (status === 'connected' ? 'Listening carefully...' : 'Waiting for connection...')}
                     </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Transcript History (Enhanced bubble contrast) */}
          <div ref={scrollContainerRef} className="h-[26rem] bg-white/60 rounded-[2.5rem] p-6 overflow-y-auto space-y-6 border border-slate-200 shadow-inner backdrop-blur-sm transition-all duration-500">
             {messages.length === 0 && !transcriptState.user && !transcriptState.model && (
               <div className="h-full flex items-center justify-center text-slate-300 font-black uppercase tracking-widest text-xs">Lesson Transcript History</div>
             )}
             {messages.map(msg => (
               <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[90%] px-8 py-5 rounded-[2rem] font-normal shadow-sm transition-all hover:shadow-md ${msg.role === 'user' ? 'bg-indigo-500 text-white text-lg' : 'bg-white text-slate-800 border border-slate-200 text-2xl'}`}>
                   {msg.text}
                 </div>
               </div>
             ))}
             {/* Live Transcription Bubbles (Improved visibility) */}
             {transcriptState.user && (
               <div className="flex justify-end">
                 <div className="px-8 py-4 rounded-[2rem] text-lg bg-indigo-50 text-indigo-900 font-medium italic animate-pulse border border-indigo-200 shadow-sm">
                   {transcriptState.user}
                 </div>
               </div>
             )}
             {transcriptState.model && (
               <div className="flex justify-start">
                 <div className="px-8 py-5 rounded-[2rem] text-2xl bg-slate-50 text-slate-900 border-2 border-indigo-200 font-medium shadow-md animate-in fade-in slide-in-from-left-4">
                   {transcriptState.model}
                 </div>
               </div>
             )}
          </div>
        </div>

        {/* Sidebar Controls */}
        <div className="flex-1 shrink-0 space-y-6 flex flex-col">
          <div className="bg-white rounded-[3rem] p-10 shadow-2xl border border-indigo-50 text-center space-y-8 flex-1 flex flex-col justify-center">
            <div className="relative mx-auto w-fit">
              <div className={`w-32 h-32 mx-auto rounded-full flex items-center justify-center text-7xl bg-indigo-50 shadow-inner border-[6px] border-white transition-all duration-500 ${isSpeaking ? 'scale-110 rotate-3 ring-[12px] ring-indigo-400/10' : ''}`}>🤖</div>
              {status === 'connected' && <div className="absolute bottom-1 right-1 w-8 h-8 bg-green-500 rounded-full border-4 border-white animate-pulse"></div>}
            </div>
            
            <div className="space-y-2">
               <h3 className="font-black text-slate-900 text-2xl font-heading tracking-tight">EduSpark AI</h3>
               <p className="text-xs text-slate-400 font-black uppercase tracking-[0.3em]">Advanced Tutoring Engine</p>
            </div>

            <div className="w-full space-y-4 pt-8 border-t border-slate-100">
               <div className={`px-5 py-4 rounded-[2rem] text-sm font-black flex items-center justify-between transition-all duration-500 ${isSpeaking ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400'}`}>
                 <span>TEACHER</span>
                 <div className="flex gap-1.5 h-6 items-end">
                    {[0, 1, 2, 3, 4].map(i => <div key={i} className={`w-1.5 bg-current rounded-full transition-all ${isSpeaking ? 'animate-[bounce_1s_infinite]' : 'h-1.5'}`} style={{ animationDelay: `${i*0.12}s`, minHeight: '6px' }}></div>)}
                 </div>
               </div>
               
               <div className={`px-5 py-4 rounded-[2rem] text-sm font-black flex items-center justify-between transition-all duration-500 ${!isSpeaking && status === 'connected' ? 'bg-green-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400'}`}>
                 <span>STUDENT</span>
                 <div className="flex items-center gap-3">
                   {status === 'connected' && !isSpeaking && <div className="text-[10px] font-black mr-1 animate-pulse tracking-tighter">LISTENING...</div>}
                   <div className={`w-4 h-4 rounded-full ${!isSpeaking && status === 'connected' ? 'bg-white animate-ping' : 'bg-slate-300'}`}></div>
                 </div>
               </div>
            </div>
          </div>
          
          <div className="p-8 bg-indigo-600 rounded-[3rem] shadow-xl text-white overflow-hidden relative group">
             <div className="absolute top-0 right-0 p-4 opacity-20 transform translate-x-4 -translate-y-4 group-hover:translate-x-0 group-hover:translate-y-0 transition-transform">✨</div>
             <h4 className="text-[11px] font-black text-indigo-200 uppercase tracking-[0.25em] mb-4 text-center">Class Activity Monitor</h4>
             <div className="flex justify-center items-end gap-1.5 h-12">
                {[...Array(14)].map((_, i) => (
                  <div 
                    key={i} 
                    className={`w-1.5 rounded-full transition-all duration-300 ${status === 'connected' ? 'bg-white' : 'bg-indigo-400'}`} 
                    style={{ 
                      height: status === 'connected' ? `${20 + Math.random() * 80}%` : '15%',
                      opacity: 0.3 + (Math.random() * 0.7)
                    }}
                  ></div>
                ))}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SessionUI;
