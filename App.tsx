
import React, { useState } from 'react';
import { GradeLevel, Subject, SessionConfig } from './types';
import { SUBJECTS } from './constants';
import SessionUI from './components/SessionUI';

const App: React.FC = () => {
  const [grade, setGrade] = useState<GradeLevel>('Elementary (K-5)');
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [activeSession, setActiveSession] = useState<SessionConfig | null>(null);

  const handleStartSession = (subject: Subject) => {
    setActiveSession({ grade, subject });
  };

  const handleEndSession = () => {
    setActiveSession(null);
  };

  if (activeSession) {
    return <SessionUI config={activeSession} onEnd={handleEndSession} />;
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="bg-white border-b border-indigo-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-3xl">✨</span>
            <span className="text-2xl font-heading font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              EduSpark AI
            </span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <nav className="flex items-center gap-6 text-slate-500 font-semibold">
              <a href="#" className="text-indigo-600">Home</a>
              <a href="#" className="hover:text-slate-800 transition">Lessons</a>
              <a href="#" className="hover:text-slate-800 transition">Progress</a>
            </nav>
            <button className="px-6 py-2 bg-slate-900 text-white rounded-full font-bold hover:bg-slate-800 transition">
              My Profile
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 mt-12">
        {/* Welcome Section */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-12 mb-16">
          <div className="flex-1 space-y-6">
            <div className="inline-block px-4 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-bold tracking-wide uppercase">
              The smartest way to learn
            </div>
            <h1 className="text-5xl md:text-6xl font-heading font-bold text-slate-900 leading-tight">
              Unlock your potential with <br/>
              <span className="text-indigo-600 underline decoration-wavy decoration-indigo-200">Voice-Powered</span> tutoring.
            </h1>
            <p className="text-xl text-slate-600 max-w-xl">
              EduSpark is your personal AI tutor that speaks to you, listens, and helps you master any subject through real-time conversation.
            </p>
          </div>
          <div className="hidden lg:block flex-1">
            <img 
              src="https://picsum.photos/seed/tutor/800/600" 
              alt="Learning Illustration" 
              className="rounded-3xl shadow-2xl rotate-2 hover:rotate-0 transition-transform duration-500"
            />
          </div>
        </div>

        {/* Configuration */}
        <div className="bg-white rounded-3xl p-8 shadow-xl border border-indigo-50 space-y-10">
          <div>
            <h2 className="text-2xl font-bold mb-6 text-slate-800 flex items-center gap-2">
              <span className="p-2 bg-amber-100 rounded-xl">📍</span> First, select your level
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['Elementary (K-5)', 'Middle School (6-8)', 'High School (9-12)'] as GradeLevel[]).map(lvl => (
                <button
                  key={lvl}
                  onClick={() => setGrade(lvl)}
                  className={`px-6 py-4 rounded-2xl border-2 font-bold transition-all ${
                    grade === lvl 
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700' 
                    : 'border-slate-100 bg-white text-slate-500 hover:border-indigo-200'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold mb-6 text-slate-800 flex items-center gap-2">
              <span className="p-2 bg-blue-100 rounded-xl">🎒</span> What are we studying today?
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
              {SUBJECTS.map(subject => (
                <div 
                  key={subject.id}
                  onClick={() => setSelectedSubject(subject)}
                  className={`group relative p-6 rounded-3xl border-2 cursor-pointer transition-all duration-300 ${
                    selectedSubject?.id === subject.id 
                    ? 'border-indigo-600 shadow-xl bg-indigo-50/50' 
                    : 'border-slate-100 bg-white hover:border-indigo-200 hover:shadow-lg'
                  }`}
                >
                  <div className={`w-14 h-14 rounded-2xl ${subject.color} flex items-center justify-center text-3xl mb-4 shadow-md group-hover:scale-110 transition-transform`}>
                    {subject.icon}
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">{subject.name}</h3>
                  <p className="text-sm text-slate-500 line-clamp-2">{subject.description}</p>
                  
                  {selectedSubject?.id === subject.id && (
                    <div className="absolute -top-3 -right-3 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg border-4 border-white">
                      ✓
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100 flex items-center justify-between gap-6">
            <div className="text-slate-500">
              {selectedSubject ? (
                <p>Ready to start <span className="font-bold text-indigo-600">{selectedSubject.name}</span> for <span className="font-bold">{grade}</span>?</p>
              ) : (
                <p>Select a subject to begin your session.</p>
              )}
            </div>
            <button
              disabled={!selectedSubject}
              onClick={() => selectedSubject && handleStartSession(selectedSubject)}
              className={`px-10 py-4 rounded-full font-bold text-lg shadow-xl transition-all ${
                selectedSubject 
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105 active:scale-95' 
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              Start Live Session
            </button>
          </div>
        </div>

        {/* Features/Trust Section */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
          <div className="space-y-4">
            <div className="text-4xl">🎙️</div>
            <h3 className="text-xl font-bold">Natural Conversations</h3>
            <p className="text-slate-500">Just speak naturally. EduSpark understands you like a real person.</p>
          </div>
          <div className="space-y-4">
            <div className="text-4xl">🎓</div>
            <h3 className="text-xl font-bold">Smart Curriculum</h3>
            <p className="text-slate-500">Personalized learning paths adapted to your specific grade and pace.</p>
          </div>
          <div className="space-y-4">
            <div className="text-4xl">🔒</div>
            <h3 className="text-xl font-bold">Safe Environment</h3>
            <p className="text-slate-500">Kid-friendly content and secure interactions designed for K-12.</p>
          </div>
        </div>
      </main>

      <footer className="mt-24 border-t border-slate-100 py-12">
        <div className="max-w-[1400px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-2 grayscale">
            <span className="text-2xl">✨</span>
            <span className="text-xl font-heading font-bold text-slate-400">EduSpark</span>
          </div>
          <p className="text-slate-400 text-sm">© 2025 EduSpark AI. Empowering the next generation of thinkers.</p>
          <div className="flex gap-6 text-slate-400">
            <a href="#" className="hover:text-indigo-600">Privacy</a>
            <a href="#" className="hover:text-indigo-600">Terms</a>
            <a href="#" className="hover:text-indigo-600">Help</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
