
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SubtitleEntry, ProcessingStatus, FileTask } from './types';
import { parseSRT, exportToSRT } from './utils/srtParser';
import { translateSubtitleBatch } from './services/openaiService';

const App: React.FC = () => {
  const [tasks, setTasks] = useState<FileTask[]>([]);
  
  // 1. Khởi tạo State từ LocalStorage nếu có
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('gemini_api_key') || '';
  });

  const [isGlobalProcessing, setIsGlobalProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 2. Tự động lưu Key vào LocalStorage mỗi khi apiKey thay đổi
  useEffect(() => {
    localStorage.setItem('gemini_api_key', apiKey);
  }, [apiKey]);

  // Hàm xóa Key nhanh
  const handleClearKey = () => {
    setApiKey('');
    localStorage.removeItem('gemini_api_key');
    alert('Đã xóa API Key khỏi trình duyệt!');
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
              progress: 0
            });
          }
        };
        reader.readAsText(file);
      });
    });

    Promise.all(newTasks).then(tasks => {
      setTasks(prev => [...prev, ...tasks]);
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
      updateTask(task.id, { status: ProcessingStatus.ERROR, error: "Vui lòng nhập OpenAI API Key của bạn." });
      return;
    }

    updateTask(task.id, { status: ProcessingStatus.PROCESSING, progress: 2, error: undefined });

    try {
      const results: SubtitleEntry[] = task.originalSubs.map(s => ({ ...s }));
      const totalEntries = task.originalSubs.length;
      
      const BATCH_SIZE = 40; // Giảm nhẹ batch size để OpenAI tập trung hơn, tránh sót dòng
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
      alert("Vui lòng nhập OpenAI API Key trước!");
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
    a.download = `GPT_${task.fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#fcfdfc] flex flex-col items-center py-10 px-4 font-sans">
      <div className="max-w-4xl w-full space-y-6">
        
        {/* OpenAI Styled Header */}
        <header className="bg-white p-8 rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-emerald-50 space-y-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h1 className="text-4xl font-black text-emerald-600 tracking-tighter flex items-center justify-center md:justify-start gap-3">
                OpenAI SRT
                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full font-black border border-emerald-100">GPT-4O MINI</span>
              </h1>
              {/* Khu vực nhập API Key */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Google Gemini API Key (Sẽ được lưu an toàn trên trình duyệt của bạn)
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Dán API Key của bạn vào đây..."
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            {apiKey && (
              <button
                onClick={handleClearKey}
                className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Xóa Key
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            * Lưu ý: Key chỉ lưu tại LocalStorage trên máy bạn, không gửi về server.
          </p>
        </div>
              <p className="text-slate-500 text-sm mt-1 font-medium italic">"Dịch đủ, dịch đúng, không bỏ sót dòng"</p>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-3 bg-slate-50 text-slate-600 rounded-2xl text-sm font-bold hover:bg-slate-100 transition-all flex items-center gap-2 border border-slate-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                Thêm file
              </button>
              <button
                onClick={processQueue}
                disabled={isGlobalProcessing || tasks.length === 0}
                className="px-10 py-3 bg-emerald-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 disabled:opacity-50 transition-all transform hover:-translate-y-0.5"
              >
                {isGlobalProcessing ? 'Đang dịch thuật...' : 'Bắt đầu dịch'}
              </button>
              <input ref={fileInputRef} type="file" multiple accept=".srt,.txt" className="hidden" onChange={handleFileUpload} />
            </div>
          </div>

          {/* Secure API Key Input */}
          <div className="bg-emerald-50/30 p-5 rounded-[2rem] border border-emerald-100 flex flex-col md:flex-row items-center gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <div className="p-2.5 bg-white text-emerald-600 rounded-xl shadow-sm border border-emerald-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
              </div>
              <span className="text-[11px] font-black text-emerald-800 uppercase tracking-widest">OpenAI Key:</span>
            </div>
            <input
              type="password"
              placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
              className="flex-1 bg-white border border-emerald-100 px-5 py-3 rounded-2xl text-sm focus:ring-4 focus:ring-emerald-500/10 outline-none font-mono tracking-wider transition-all"
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
            />
            {apiKey.length > 5 && (
              <div className="flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-xl text-[10px] font-black border border-emerald-200">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                READY
              </div>
            )}
          </div>
        </header>

        {/* Task List / Drop Zone */}
        <div 
          className={`space-y-4 min-h-[400px] rounded-[3rem] transition-all duration-500 ${isDragging ? 'bg-emerald-50/50 ring-4 ring-emerald-400 ring-dashed scale-[0.98]' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {tasks.length === 0 ? (
            <div 
              className={`bg-white/70 backdrop-blur-sm border-2 border-dashed rounded-[3rem] p-24 text-center transition-all duration-500 flex flex-col items-center gap-6 ${isDragging ? 'border-emerald-500 bg-white/90' : 'border-slate-200'}`}
            >
              <div className={`w-20 h-20 rounded-3xl flex items-center justify-center transition-all shadow-xl ${isDragging ? 'bg-emerald-600 text-white rotate-6' : 'bg-slate-100 text-slate-400'}`}>
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div>
                <p className={`text-xl font-black transition-colors ${isDragging ? 'text-emerald-700' : 'text-slate-400'}`}>
                  {isDragging ? 'Thả để nạp file!' : 'Kéo thả file .srt hoặc .txt vào đây'}
                </p>
                <p className="text-slate-400 text-sm mt-2 font-medium">Model GPT-4o mini được cấu hình dịch 40 dòng/lượt</p>
              </div>
            </div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className={`bg-white p-7 rounded-[2.5rem] shadow-sm border transition-all duration-300 ${task.status === ProcessingStatus.ERROR ? 'border-red-200 bg-red-50/10' : 'border-slate-100 hover:shadow-lg'}`}>
                <div className="flex items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-5 min-w-0">
                    <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-[1.25rem] flex flex-col items-center justify-center font-black text-[9px] shrink-0 border border-emerald-100">
                      <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      SRT
                    </div>
                    <div className="truncate">
                      <h3 className="font-bold text-slate-800 text-lg truncate">{task.fileName}</h3>
                      <p className="text-slate-400 text-[10px] uppercase font-black tracking-widest mt-1">{task.originalSubs.length} DÒNG PHỤ ĐỀ</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                      task.status === ProcessingStatus.COMPLETED ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                      task.status === ProcessingStatus.PROCESSING ? 'bg-amber-100 text-amber-700 border-amber-200 animate-pulse' :
                      task.status === ProcessingStatus.ERROR ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-500 border-slate-100'
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
                    <div className="flex justify-between text-[10px] font-black text-emerald-600 uppercase">
                      <span>Đang đối chiếu dữ liệu...</span>
                      <span>{task.progress}%</span>
                    </div>
                    <div className="bg-slate-100 h-2.5 rounded-full overflow-hidden shadow-inner">
                      <div className="bg-emerald-500 h-full rounded-full transition-all duration-700" style={{ width: `${task.progress}%` }} />
                    </div>
                  </div>
                )}

                <div className="relative group">
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none group-focus-within:text-emerald-500 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Gợi ý văn phong: Dịch hài hước, dịch sát nghĩa, phong cách Gen Z..."
                    className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-[1.5rem] text-sm focus:ring-4 focus:ring-emerald-500/10 focus:bg-white outline-none transition-all placeholder:text-slate-300 font-medium"
                    value={task.prompt}
                    onChange={(e) => updateTask(task.id, { prompt: e.target.value })}
                    disabled={task.status !== ProcessingStatus.IDLE}
                  />
                </div>

                {task.error && (
                  <div className="mt-5 p-5 bg-red-50 text-red-600 text-[11px] font-bold rounded-[1.5rem] border border-red-100 flex items-start gap-3">
                    <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>{task.error}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      
      <footer className="mt-16 text-slate-400 font-bold text-[10px] tracking-[0.4em] uppercase flex flex-col items-center gap-4">
        <div className="flex items-center gap-5">
          <span>GPT-4O MINI</span>
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
          <span>STRICT TRANSLATION MODE</span>
          <span className="w-1.5 h-1.5 bg-slate-300 rounded-full"></span>
          <span>OPENAI API</span>
        </div>
        <div className="text-[9px] opacity-40 text-center font-medium lowercase tracking-normal">Đã loại bỏ cơ chế nghỉ &bull; Ưu tiên tốc độ và độ chính xác dòng</div>
      </footer>
    </div>
  );
};

export default App;
