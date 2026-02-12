
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SubtitleEntry, ProcessingStatus, FileTask } from './types';
import { parseSRT, exportToSRT } from './utils/srtParser';
import { translateSubtitleBatch } from './services/openaiService';
import { translateSubtitleBatchGemini } from './services/geminiService';

type AIProvider = 'openai' | 'gemini';

const App: React.FC = () => {
  const [tasks, setTasks] = useState<FileTask[]>([]);
  const [activeAI, setActiveAI] = useState<AIProvider>(() => {
    return (localStorage.getItem('active_ai_provider') as AIProvider) || 'openai';
  });
  
  // OpenAI Keys
  const [activeKeyGPT, setActiveKeyGPT] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [draftKeyGPT, setDraftKeyGPT] = useState(activeKeyGPT);
  const [gptVersion, setGptVersion] = useState(0);

  // Gemini Key (Single Key)
  const [activeKeyGemini, setActiveKeyGemini] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [draftKeyGemini, setDraftKeyGemini] = useState(activeKeyGemini);
  const [geminiVersion, setGeminiVersion] = useState(0);

  const [showKeys, setShowKeys] = useState({ gpt: false, gemini: false });
  const [showSettings, setShowSettings] = useState(false);
  const [isGlobalProcessing, setIsGlobalProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('active_ai_provider', activeAI);
  }, [activeAI]);

  const handleSaveGPT = () => {
    setActiveKeyGPT(draftKeyGPT);
    localStorage.setItem('openai_api_key', draftKeyGPT);
    alert('Đã cập nhật OpenAI Key!');
  };

  const handleSaveGemini = () => {
    setActiveKeyGemini(draftKeyGemini);
    localStorage.setItem('gemini_api_key', draftKeyGemini);
    alert('Đã cập nhật Gemini Key!');
  };

  const handleClearGPT = () => {
    if (confirm('Xóa sạch OpenAI Key?')) {
      localStorage.removeItem('openai_api_key');
      setActiveKeyGPT('');
      setDraftKeyGPT('');
      setGptVersion(v => v + 1);
    }
  };

  const handleClearGemini = () => {
    if (confirm('Xóa sạch Gemini Key?')) {
      localStorage.removeItem('gemini_api_key');
      setActiveKeyGemini('');
      setDraftKeyGemini('');
      setGeminiVersion(v => v + 1);
    }
  };

  const processFiles = useCallback((files: FileList | File[]) => {
    const newTasks: Promise<FileTask>[] = Array.from(files).map((file: File) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          try {
            const parsed = parseSRT(content);
            resolve({
              id: Math.random().toString(36).substring(7),
              fileName: file.name,
              originalSubs: parsed,
              processedSubs: [],
              prompt: '',
              status: ProcessingStatus.IDLE,
              progress: 0
            });
          } catch (err: any) {
            resolve({
              id: Math.random().toString(36).substring(7),
              fileName: file.name,
              originalSubs: [],
              processedSubs: [],
              prompt: '',
              status: ProcessingStatus.ERROR,
              progress: 0,
              error: err.message
            });
          }
        };
        reader.readAsText(file);
      });
    });
    Promise.all(newTasks).then(resolved => setTasks(prev => [...prev, ...resolved]));
  }, []);

  const updateTask = (id: string, updates: Partial<FileTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const processSingleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.originalSubs.length === 0) return;

    updateTask(task.id, { status: ProcessingStatus.PROCESSING, progress: 0, error: undefined });

    try {
      const results: SubtitleEntry[] = task.originalSubs.map(s => ({ ...s }));
      const BATCH_SIZE = 40;
      const total = task.originalSubs.length;
      
      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = task.originalSubs.slice(i, i + BATCH_SIZE);

        if (activeAI === 'openai') {
          if (!activeKeyGPT) throw new Error("Chưa nhập OpenAI Key");
          const translated = await translateSubtitleBatch(batch, task.prompt, activeKeyGPT);
          translated.forEach(t => {
            const idx = results.findIndex(r => r.id === t.id);
            if (idx !== -1) results[idx].text = t.translatedText;
          });
        } else {
          if (!activeKeyGemini) throw new Error("Chưa nhập Gemini Key");
          // Chỉ sử dụng gemini-2.5-flash
          const translated = await translateSubtitleBatchGemini(batch, task.prompt, activeKeyGemini, 'gemini-2.5-flash');
          translated.forEach(t => {
            const idx = results.findIndex(r => r.id === t.id);
            if (idx !== -1) results[idx].text = t.translatedText;
          });
        }

        updateTask(task.id, { 
          progress: Math.floor(((i + BATCH_SIZE) / total) * 100),
          processedSubs: [...results] 
        });
      }

      updateTask(task.id, { status: ProcessingStatus.COMPLETED, progress: 100 });
    } catch (err: any) {
      updateTask(task.id, { status: ProcessingStatus.ERROR, error: err.message });
      throw err;
    }
  };

  const processQueue = async () => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    const pending = tasks.filter(t => t.status !== ProcessingStatus.COMPLETED);
    for (const task of pending) {
      try { await processSingleTask(task.id); } catch {}
    }
    setIsGlobalProcessing(false);
  };

  return (
    <div className="min-h-screen bg-[#fcfdfd] text-slate-800 py-12 px-4 font-sans selection:bg-indigo-100 transition-colors duration-500">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-3xl font-black tracking-tighter">
              <span className={activeAI === 'openai' ? 'text-emerald-600' : 'text-indigo-600'}>GEMINI</span> TRANSLATOR
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Direct gemini-2.5-flash Mode</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-slate-100 p-1.5 rounded-[1.25rem] flex items-center gap-1">
              {['openai', 'gemini'].map(type => (
                <button 
                  key={type}
                  onClick={() => setActiveAI(type as AIProvider)}
                  className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${activeAI === type ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {type}
                </button>
              ))}
            </div>
            <button onClick={() => setShowSettings(!showSettings)} className={`p-3.5 rounded-2xl border transition-all ${showSettings ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
            <button onClick={processQueue} disabled={isGlobalProcessing || tasks.length === 0} className={`px-8 py-3.5 bg-indigo-600 text-white rounded-2xl text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 transition-all`}>
              {isGlobalProcessing ? 'Đang dịch...' : 'Bắt đầu dịch'}
            </button>
            <input ref={fileInputRef} type="file" multiple accept=".srt,.txt" className="hidden" onChange={(e) => e.target.files && processFiles(e.target.files)} />
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-white p-8 rounded-[2rem] border border-indigo-100 shadow-sm space-y-10 animate-in fade-in slide-in-from-top-4">
            
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">OpenAI Configuration</span>
                {activeKeyGPT && <span className="text-[9px] text-emerald-500 font-bold tracking-widest">● ACTIVE</span>}
              </div>
              <div className="flex gap-2">
                <input
                  key={`gpt-v${gptVersion}`}
                  type={showKeys.gpt ? "text" : "password"}
                  placeholder="Paste OpenAI Key..."
                  className="flex-1 bg-slate-50 border border-slate-100 px-4 py-3 rounded-xl text-xs font-mono outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/10 transition-all"
                  value={draftKeyGPT}
                  onChange={(e) => setDraftKeyGPT(e.target.value)}
                />
                <button onClick={() => setShowKeys(p => ({...p, gpt: !p.gpt}))} className="p-3 text-slate-300 hover:text-slate-500 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveGPT} className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider shadow-md shadow-emerald-50 hover:bg-emerald-700 transition-all">Update GPT Key</button>
                <button onClick={handleClearGPT} className="px-4 py-2 text-red-500 border border-red-100 rounded-xl text-[10px] font-bold uppercase hover:bg-red-50 transition-all">Clear</button>
              </div>
            </div>

            <div className="h-px bg-slate-100 w-full"></div>

            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Gemini Configuration</span>
                {activeKeyGemini && <span className="text-[9px] text-indigo-500 font-bold tracking-widest">● ACTIVE</span>}
              </div>
              
              <div className="space-y-3">
                <div className="relative flex gap-2">
                  <input
                    key={`gem-v${geminiVersion}`}
                    type={showKeys.gemini ? "text" : "password"}
                    placeholder="Paste Gemini API Key..."
                    className="flex-1 bg-slate-50 border border-slate-100 px-4 py-3 rounded-xl text-xs font-mono outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/10 transition-all"
                    value={draftKeyGemini}
                    onChange={(e) => setDraftKeyGemini(e.target.value)}
                  />
                  <button 
                    onClick={() => setShowKeys(p => ({...p, gemini: !p.gemini}))}
                    className="p-3 text-slate-300 hover:text-slate-500"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  </button>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button onClick={handleSaveGemini} className="flex-1 bg-indigo-600 text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-indigo-50 hover:bg-indigo-700 transition-all">Update Gemini Key</button>
                <button onClick={handleClearGemini} className="px-6 py-3 text-red-500 border border-red-100 rounded-xl text-[10px] font-bold uppercase hover:bg-red-50">Clear</button>
              </div>
              
              <div className="p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100 text-[10px] text-indigo-700 leading-relaxed font-medium">
                <p>Hệ thống hiện đang sử dụng model <strong>gemini-2.5-flash</strong> cố định để dịch. Vui lòng đảm bảo API Key của bạn có quyền truy cập vào model này.</p>
              </div>
            </div>
          </div>
        )}

        {/* Task Area */}
        <div 
          className={`min-h-[400px] transition-all rounded-[3rem] ${isDragging ? 'bg-indigo-50/50 ring-4 ring-indigo-500/10 ring-dashed scale-[0.99]' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); e.dataTransfer.files && processFiles(e.dataTransfer.files); }}
        >
          {tasks.length === 0 ? (
            <div className="border-2 border-dashed border-slate-100 rounded-[3rem] p-24 text-center flex flex-col items-center gap-6 opacity-60">
              <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-300">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              </div>
              <p className="text-sm font-bold text-slate-400">Kéo thả file vào đây để bắt đầu</p>
            </div>
          ) : (
            <div className="space-y-4">
              {tasks.map((task) => (
                <div key={task.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-md transition-all animate-in fade-in zoom-in-95 duration-300">
                  <div className="flex items-center justify-between gap-4 mb-5">
                    <div className="flex items-center gap-4 truncate">
                      <div className={`w-12 h-12 bg-indigo-50 text-indigo-400 rounded-2xl flex items-center justify-center shrink-0`}>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <div className="truncate">
                        <h3 className="font-bold text-slate-700 truncate text-sm">{task.fileName}</h3>
                        <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{task.originalSubs.length} entries</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                        task.status === ProcessingStatus.COMPLETED ? 'bg-indigo-50 text-indigo-600 border-indigo-100' :
                        task.status === ProcessingStatus.PROCESSING ? 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse' :
                        task.status === ProcessingStatus.ERROR ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-400 border-slate-100'
                      }`}>
                        {task.status}
                      </span>
                      {task.status === ProcessingStatus.COMPLETED && (
                        <button onClick={() => {
                          const blob = new Blob([exportToSRT(task.processedSubs)], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `Translated_${task.fileName}`;
                          a.click();
                        }} className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </button>
                      )}
                      <button onClick={() => setTasks(p => p.filter(t => t.id !== task.id))} className="p-2.5 text-slate-300 hover:text-red-500 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>

                  {task.status === ProcessingStatus.PROCESSING && (
                    <div className="mb-4 space-y-2">
                      <div className="flex justify-between text-[9px] font-black text-indigo-600 uppercase">
                        <span>Gemini Processing...</span>
                        <span>{task.progress}%</span>
                      </div>
                      <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${task.progress}%` }} />
                      </div>
                    </div>
                  )}

                  <input
                    type="text"
                    placeholder="Chỉ dẫn văn phong..."
                    className="w-full pl-5 pr-5 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500/5 transition-all"
                    value={task.prompt}
                    onChange={(e) => updateTask(task.id, { prompt: e.target.value })}
                    disabled={task.status !== ProcessingStatus.IDLE}
                  />

                  {task.error && (
                    <div className="mt-3 p-3 bg-red-50 text-red-600 text-[9px] font-bold rounded-xl border border-red-100">
                      Lỗi: {task.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <footer className="mt-20 text-center text-[9px] text-slate-400 font-black uppercase tracking-[0.4em] pb-12">
        Powered by Gemini 2.5 Flash
      </footer>
    </div>
  );
};

export default App;
