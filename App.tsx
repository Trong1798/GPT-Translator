
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SubtitleEntry, ProcessingStatus, FileTask } from './types';
import { parseSRT, exportToSRT } from './utils/srtParser';
import { translateSubtitleBatch } from './services/openaiService';

const App: React.FC = () => {
  const [tasks, setTasks] = useState<FileTask[]>([]);
  // Lấy key từ localStorage nếu có
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [isGlobalProcessing, setIsGlobalProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tự động lưu key mỗi khi thay đổi
  useEffect(() => {
    localStorage.setItem('openai_api_key', apiKey);
  }, [apiKey]);

  const handleClearKey = () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa Key đã lưu?")) {
      setApiKey('');
      localStorage.removeItem('openai_api_key');
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
            if (parsed.length === 0) throw new Error("File không có dữ liệu phụ đề");
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
              error: err.message || 'Lỗi định dạng'
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    processFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  };

  const updateTask = (id: string, updates: Partial<FileTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const processSingleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.originalSubs.length === 0) return;

    if (!apiKey) {
      updateTask(task.id, { status: ProcessingStatus.ERROR, error: "Thiếu API Key. Vui lòng cấu hình trong mục 'Cài đặt API'." });
      setShowSettings(true); // Tự động mở settings nếu thiếu key
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
        const translatedBatch = await translateSubtitleBatch(batch, task.prompt, apiKey);
        
        translatedBatch.forEach((tSub) => {
          const index = results.findIndex(r => r.id === tSub.id);
          if (index !== -1) {
            results[index].text = tSub.translatedText;
          }
        });
        
        const currentProgress = Math.floor(((i + 1) / batches.length) * 100);
        updateTask(task.id, { progress: currentProgress, processedSubs: [...results] });
      }

      updateTask(task.id, { 
        processedSubs: results, 
        status: ProcessingStatus.COMPLETED, 
        progress: 100 
      });
    } catch (err: any) {
      updateTask(task.id, { status: ProcessingStatus.ERROR, error: err.message });
      throw err;
    }
  };

  const processQueue = async () => {
    if (isGlobalProcessing) return;
    if (!apiKey) {
      setShowSettings(true);
      alert("Vui lòng nhập API Key trong phần cài đặt trước!");
      return;
    }
    
    setIsGlobalProcessing(true);
    const pendingTasks = tasks.filter(t => t.status !== ProcessingStatus.COMPLETED);
    for (const task of pendingTasks) {
      try {
        await processSingleTask(task.id);
      } catch (err) {
        console.error(`Task ${task.fileName} failed.`);
      }
    }
    setIsGlobalProcessing(false);
  };

  const downloadTask = (task: FileTask) => {
    const content = exportToSRT(task.processedSubs);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Translated_${task.fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#f9fafb] flex flex-col items-center py-8 px-4 font-sans selection:bg-emerald-100">
      <div className="max-w-4xl w-full space-y-6">
        
        {/* Main Header */}
        <div className="bg-white p-6 md:p-10 rounded-[2.5rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] border border-slate-100 relative overflow-hidden">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
            <div className="text-center md:text-left">
              <h1 className="text-4xl font-black text-slate-900 tracking-tighter flex items-center justify-center md:justify-start gap-3">
                <span className="text-emerald-600">OpenAI</span> SRT
              </h1>
              <p className="text-slate-400 text-sm mt-1 font-medium">Công cụ dịch phụ đề chuyên nghiệp</p>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-3 rounded-2xl transition-all border ${showSettings ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}
                title="Cài đặt API"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-3 bg-white text-slate-700 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2 border border-slate-200 shadow-sm"
              >
                Thêm file
              </button>
              <button
                onClick={processQueue}
                disabled={isGlobalProcessing || tasks.length === 0}
                className="px-10 py-3 bg-emerald-600 text-white rounded-2xl text-sm font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 disabled:opacity-50 transition-all transform hover:-translate-y-0.5"
              >
                {isGlobalProcessing ? 'Đang chạy...' : 'Bắt đầu dịch'}
              </button>
              <input ref={fileInputRef} type="file" multiple accept=".srt,.txt" className="hidden" onChange={handleFileUpload} />
            </div>
          </div>

          {/* Optional API Key Section (Collapsible) */}
          {showSettings && (
            <div className="mt-8 pt-8 border-t border-slate-100 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Cấu hình OpenAI API</h3>
                  <button onClick={() => setShowSettings(false)} className="text-slate-300 hover:text-slate-500">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="flex flex-col md:flex-row items-stretch gap-3">
                  <div className="relative flex-1">
                    <input
                      type="password"
                      placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full bg-slate-50 border border-slate-200 px-5 py-3.5 rounded-2xl text-sm focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-200 outline-none font-mono tracking-widest transition-all"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                       {apiKey && <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>}
                    </div>
                  </div>
                  <button
                    onClick={handleClearKey}
                    className="px-6 py-3.5 bg-red-50 text-red-600 rounded-2xl text-sm font-bold hover:bg-red-100 transition-all border border-red-100 flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    Xóa Key
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 font-medium">Key của bạn sẽ được lưu an toàn trong LocalStorage của trình duyệt này.</p>
              </div>
            </div>
          )}
        </div>

        {/* Task List / Drop Zone */}
        <div 
          className={`space-y-4 min-h-[450px] rounded-[3rem] transition-all duration-500 ${isDragging ? 'bg-emerald-50/40 ring-4 ring-emerald-400/20 ring-dashed scale-[0.99]' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {tasks.length === 0 ? (
            <div 
              className={`bg-white/40 backdrop-blur-sm border-2 border-dashed rounded-[3rem] p-32 text-center transition-all duration-500 flex flex-col items-center gap-6 ${isDragging ? 'border-emerald-500 bg-white/80 translate-y-2' : 'border-slate-200'}`}
            >
              <div className={`w-24 h-24 rounded-[2rem] flex items-center justify-center transition-all shadow-xl ${isDragging ? 'bg-emerald-600 text-white rotate-12 scale-110' : 'bg-white text-slate-300 border border-slate-100'}`}>
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div>
                <p className={`text-2xl font-black transition-colors ${isDragging ? 'text-emerald-700' : 'text-slate-400'}`}>
                  {isDragging ? 'Thả để bắt đầu dịch' : 'Kéo thả file .srt vào đây'}
                </p>
                <p className="text-slate-400 text-sm mt-2 font-medium">Xử lý hàng loạt 40 dòng/lần</p>
              </div>
            </div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className={`bg-white p-7 rounded-[2.5rem] shadow-sm border transition-all duration-300 ${task.status === ProcessingStatus.ERROR ? 'border-red-200 bg-red-50/10' : 'border-slate-100 hover:shadow-xl hover:shadow-emerald-500/5'}`}>
                <div className="flex items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-5 min-w-0">
                    <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex flex-col items-center justify-center font-black text-[9px] shrink-0 border border-emerald-100">
                      <svg className="w-6 h-6 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      SRT
                    </div>
                    <div className="truncate">
                      <h3 className="font-bold text-slate-800 text-lg truncate">{task.fileName}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-slate-400 text-[10px] uppercase font-black tracking-widest">{task.originalSubs.length} DÒNG</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                      task.status === ProcessingStatus.COMPLETED ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                      task.status === ProcessingStatus.PROCESSING ? 'bg-amber-100 text-amber-700 border-amber-200 animate-pulse' :
                      task.status === ProcessingStatus.ERROR ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-400 border-slate-100'
                    }`}>
                      {task.status}
                    </span>
                    {task.status === ProcessingStatus.COMPLETED && (
                      <button onClick={() => downloadTask(task)} className="p-3 text-emerald-600 bg-emerald-50 rounded-2xl hover:bg-emerald-600 hover:text-white transition-all shadow-sm border border-emerald-100">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      </button>
                    )}
                    <button 
                      onClick={() => setTasks(prev => prev.filter(t => t.id !== task.id))}
                      className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                      disabled={task.status === ProcessingStatus.PROCESSING}
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>

                {task.status === ProcessingStatus.PROCESSING && (
                  <div className="space-y-2 mb-6">
                    <div className="flex justify-between text-[10px] font-black text-emerald-600 uppercase tracking-tighter">
                      <span>Tiến độ dịch thuật</span>
                      <span>{task.progress}%</span>
                    </div>
                    <div className="bg-slate-100 h-2 rounded-full overflow-hidden shadow-inner">
                      <div className="bg-emerald-500 h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${task.progress}%` }} />
                    </div>
                  </div>
                )}

                <div className="relative group">
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none group-focus-within:text-emerald-500 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Gợi ý văn phong (Hài hước, trang trọng, dịch cho trẻ em...)"
                    className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-[1.5rem] text-sm focus:ring-4 focus:ring-emerald-500/10 focus:bg-white outline-none transition-all placeholder:text-slate-300 font-medium"
                    value={task.prompt}
                    onChange={(e) => updateTask(task.id, { prompt: e.target.value })}
                    disabled={task.status !== ProcessingStatus.IDLE}
                  />
                </div>

                {task.error && (
                  <div className="mt-5 p-5 bg-red-50 text-red-600 text-[11px] font-bold rounded-[1.5rem] border border-red-100 flex items-start gap-3">
                    <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span className="leading-relaxed">{task.error}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      
      <footer className="mt-16 text-slate-300 font-bold text-[10px] tracking-[0.4em] uppercase flex flex-col items-center gap-4">
        <div className="flex items-center gap-5">
          <span>GPT-4O MINI</span>
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
          <span>NO-SKIP GUARANTEE</span>
          <span className="w-1.5 h-1.5 bg-slate-200 rounded-full"></span>
          <span>SECURE STORAGE</span>
        </div>
        <div className="text-[9px] opacity-60 text-center font-medium lowercase tracking-normal text-slate-400">Tất cả dữ liệu được xử lý trực tiếp trên trình duyệt &bull; Không lưu trữ file trên máy chủ</div>
      </footer>
    </div>
  );
};

export default App;
