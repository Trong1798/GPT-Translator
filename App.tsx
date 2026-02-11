
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SubtitleEntry, ProcessingStatus, FileTask } from './types';
import { parseSRT, exportToSRT } from './utils/srtParser';
import { translateSubtitleBatch } from './services/openaiService';
import { translateSubtitleBatchGemini } from './services/geminiService';

type AIProvider = 'openai' | 'gemini';

const App: React.FC = () => {
  const [tasks, setTasks] = useState<FileTask[]>([]);
  const [activeAI, setActiveAI] = useState<AIProvider>('openai');
  
  const [apiKeyGPT, setApiKeyGPT] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [apiKeyGemini, setApiKeyGemini] = useState(() => localStorage.getItem('gemini_api_key') || '');
  
  const [isGlobalProcessing, setIsGlobalProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('openai_api_key', apiKeyGPT);
    localStorage.setItem('gemini_api_key', apiKeyGemini);
  }, [apiKeyGPT, apiKeyGemini]);

  const handleClearKey = (provider: AIProvider) => {
    if (window.confirm(`Xóa API Key của ${provider.toUpperCase()}?`)) {
      if (provider === 'openai') {
        setApiKeyGPT('');
        localStorage.removeItem('openai_api_key');
      } else {
        setApiKeyGemini('');
        localStorage.removeItem('gemini_api_key');
      }
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
            if (parsed.length === 0) throw new Error("File rỗng");
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

    Promise.all(newTasks).then((resolvedTasks) => {
      setTasks((prev) => [...prev, ...resolvedTasks]);
    });
  }, []);

  const updateTask = (id: string, updates: Partial<FileTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const processSingleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.originalSubs.length === 0) return;

    const currentKey = activeAI === 'openai' ? apiKeyGPT : apiKeyGemini;

    if (!currentKey) {
      setShowSettings(true);
      updateTask(task.id, { status: ProcessingStatus.ERROR, error: `Vui lòng nhập API Key cho ${activeAI.toUpperCase()}.` });
      return;
    }

    updateTask(task.id, { status: ProcessingStatus.PROCESSING, progress: 2, error: undefined });

    try {
      const results: SubtitleEntry[] = task.originalSubs.map(s => ({ ...s }));
      const totalEntries = task.originalSubs.length;
      const BATCH_SIZE = 40;
      const batches = [];
      for (let i = 0; i < totalEntries; i += BATCH_SIZE) {
        batches.push(task.originalSubs.slice(i, i + BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const translatedBatch = activeAI === 'openai' 
          ? await translateSubtitleBatch(batch, task.prompt, currentKey)
          : await translateSubtitleBatchGemini(batch, task.prompt, currentKey);
        
        translatedBatch.forEach((tSub) => {
          const index = results.findIndex(r => r.id === tSub.id);
          if (index !== -1) results[index].text = tSub.translatedText;
        });
        
        updateTask(task.id, { 
          progress: Math.floor(((i + 1) / batches.length) * 100),
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
    const currentKey = activeAI === 'openai' ? apiKeyGPT : apiKeyGemini;
    if (!currentKey) {
      setShowSettings(true);
      return;
    }
    setIsGlobalProcessing(true);
    const pending = tasks.filter(t => t.status !== ProcessingStatus.COMPLETED);
    for (const task of pending) {
      try { await processSingleTask(task.id); } catch {}
    }
    setIsGlobalProcessing(false);
  };

  const downloadTask = (task: FileTask) => {
    const content = exportToSRT(task.processedSubs);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeAI.toUpperCase()}_Translated_${task.fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const accentColor = activeAI === 'openai' ? 'emerald' : 'indigo';

  return (
    <div className={`min-h-screen bg-[#fcfdfd] text-slate-800 py-12 px-4 font-sans selection:bg-${accentColor}-100`}>
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Simple Header */}
        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-3xl font-black tracking-tighter">
              <span className={activeAI === 'openai' ? 'text-emerald-600' : 'text-indigo-600 transition-colors'}>SRT</span> TRANSLATOR
            </h1>
            <div className="flex items-center gap-2 mt-1 justify-center md:justify-start">
              <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Active:</span>
              <span className={`text-[10px] font-black uppercase tracking-widest ${activeAI === 'openai' ? 'text-emerald-600' : 'text-indigo-600'}`}>
                {activeAI === 'openai' ? 'GPT-4o mini' : 'Gemini 2.5 Flash'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* AI Switcher */}
            <div className="bg-slate-100 p-1.5 rounded-[1.25rem] flex items-center gap-1">
              <button 
                onClick={() => setActiveAI('openai')}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${activeAI === 'openai' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                GPT
              </button>
              <button 
                onClick={() => setActiveAI('gemini')}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${activeAI === 'gemini' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Gemini
              </button>
            </div>

            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-3.5 rounded-2xl border transition-all ${showSettings ? `bg-${accentColor}-50 border-${accentColor}-200 text-${accentColor}-600` : 'bg-slate-50 border-slate-100 text-slate-400 hover:bg-slate-100'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3.5 bg-white border border-slate-200 text-slate-700 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all shadow-sm"
            >
              Thêm file
            </button>
            <button
              onClick={processQueue}
              disabled={isGlobalProcessing || tasks.length === 0}
              className={`px-8 py-3.5 bg-${accentColor}-600 text-white rounded-2xl text-sm font-bold shadow-lg shadow-${accentColor}-100 hover:bg-${accentColor}-700 disabled:opacity-50 transition-all active:scale-95`}
            >
              {isGlobalProcessing ? 'Đang dịch...' : 'Bắt đầu dịch'}
            </button>
            <input ref={fileInputRef} type="file" multiple accept=".srt,.txt" className="hidden" onChange={(e) => e.target.files && processFiles(e.target.files)} />
          </div>
        </div>

        {/* Settings Area */}
        {showSettings && (
          <div className={`bg-white p-8 rounded-[2rem] border border-${accentColor}-100 shadow-sm animate-in fade-in slide-in-from-top-4 space-y-6`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-black uppercase tracking-[0.2em] text-${accentColor}-600`}>API Configuration (LocalStorage)</span>
              <button onClick={() => setShowSettings(false)} className="text-slate-300 hover:text-slate-500 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* GPT Key */}
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">OpenAI API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="sk-..."
                    className="flex-1 bg-slate-50 border border-slate-100 px-4 py-3 rounded-xl text-sm focus:ring-4 focus:ring-emerald-500/5 focus:bg-white outline-none font-mono transition-all"
                    value={apiKeyGPT}
                    onChange={(e) => setApiKeyGPT(e.target.value)}
                  />
                  <button onClick={() => handleClearKey('openai')} className="p-3 text-red-400 hover:bg-red-50 rounded-xl transition-all border border-transparent hover:border-red-100">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>

              {/* Gemini Key */}
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gemini API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    className="flex-1 bg-slate-50 border border-slate-100 px-4 py-3 rounded-xl text-sm focus:ring-4 focus:ring-indigo-500/5 focus:bg-white outline-none font-mono transition-all"
                    value={apiKeyGemini}
                    onChange={(e) => setApiKeyGemini(e.target.value)}
                  />
                  <button onClick={() => handleClearKey('gemini')} className="p-3 text-red-400 hover:bg-red-50 rounded-xl transition-all border border-transparent hover:border-red-100">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Task List & Drop Zone */}
        <div 
          className={`min-h-[400px] transition-all duration-500 rounded-[3rem] ${isDragging ? `bg-${accentColor}-50/50 ring-4 ring-${accentColor}-500/10 ring-dashed scale-[0.99]` : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); e.dataTransfer.files && processFiles(e.dataTransfer.files); }}
        >
          {tasks.length === 0 ? (
            <div className="border-2 border-dashed border-slate-100 rounded-[3rem] p-24 text-center flex flex-col items-center gap-6 opacity-60">
              <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-300">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              </div>
              <p className="text-sm font-bold text-slate-400">Kéo thả file .srt hoặc .txt vào vùng này</p>
            </div>
          ) : (
            <div className="space-y-4">
              {tasks.map((task) => (
                <div key={task.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-md transition-all">
                  <div className="flex items-center justify-between gap-4 mb-5">
                    <div className="flex items-center gap-4 truncate">
                      <div className={`w-12 h-12 bg-${accentColor}-50 text-${accentColor}-400 rounded-2xl flex items-center justify-center shrink-0`}>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <div className="truncate">
                        <h3 className="font-bold text-slate-700 truncate">{task.fileName}</h3>
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{task.originalSubs.length} entries</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        task.status === ProcessingStatus.COMPLETED ? `bg-${accentColor}-50 text-${accentColor}-600 border-${accentColor}-100` :
                        task.status === ProcessingStatus.PROCESSING ? 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse' :
                        task.status === ProcessingStatus.ERROR ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-400 border-slate-100'
                      }`}>
                        {task.status}
                      </span>
                      {task.status === ProcessingStatus.COMPLETED && (
                        <button onClick={() => downloadTask(task)} className={`p-2.5 bg-${accentColor}-600 text-white rounded-xl shadow-lg shadow-${accentColor}-100 hover:bg-${accentColor}-700 transition-all`}>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </button>
                      )}
                      <button onClick={() => setTasks(prev => prev.filter(t => t.id !== task.id))} className="p-2.5 text-slate-300 hover:text-red-500 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>

                  {task.status === ProcessingStatus.PROCESSING && (
                    <div className="mb-5 space-y-2">
                      <div className={`flex justify-between text-[10px] font-black text-${accentColor}-600 uppercase`}>
                        <span>{activeAI.toUpperCase()} IS TRANSLATING...</span>
                        <span>{task.progress}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full bg-${accentColor}-500 transition-all duration-500`} style={{ width: `${task.progress}%` }} />
                      </div>
                    </div>
                  )}

                  <div className="relative">
                    <div className={`absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-${accentColor}-500 transition-colors`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </div>
                    <input
                      type="text"
                      placeholder="Chỉ dẫn văn phong (VD: Dịch hài hước, trang trọng...)"
                      className={`w-full pl-11 pr-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:bg-white focus:ring-4 focus:ring-${accentColor}-500/5 outline-none transition-all font-medium`}
                      value={task.prompt}
                      onChange={(e) => updateTask(task.id, { prompt: e.target.value })}
                      disabled={task.status !== ProcessingStatus.IDLE}
                    />
                  </div>

                  {task.error && (
                    <div className="mt-4 p-4 bg-red-50 text-red-600 text-[10px] font-bold rounded-2xl border border-red-100 flex items-center gap-3">
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {task.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      <footer className="mt-20 text-center space-y-3">
        <div className="flex items-center justify-center gap-4 text-slate-300 text-[10px] font-black uppercase tracking-[0.3em]">
          <span>Hybrid AI Bridge</span>
          <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
          <span>Zero Loss Guaranteed</span>
        </div>
        <p className="text-[9px] text-slate-400 font-medium">© Professional Subtitle Engine &bull; GPT-4o mini & Gemini 2.5 Flash</p>
      </footer>
    </div>
  );
};

export default App;
