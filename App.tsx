
import React, { useState, useRef, useEffect } from 'react';
import { SubtitleEntry, ProcessingStatus, FileTask } from './types';
import { parseSRT, exportToSRT } from './utils/srtParser';
import { translateSubtitleBatch } from './services/geminiService';

const App: React.FC = () => {
  const [tasks, setTasks] = useState<FileTask[]>([]);
  const [isGlobalProcessing, setIsGlobalProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // API Key state
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('user_gemini_api_key') || '');
  const [draftKey, setDraftKey] = useState(apiKey);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpdateKey = () => {
    localStorage.setItem('user_gemini_api_key', draftKey);
    setApiKey(draftKey);
    setShowSettings(false);
    alert('Đã cập nhật API Key!');
  };

  const handleClearKey = () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa API Key này khỏi trình duyệt?')) {
      localStorage.removeItem('user_gemini_api_key');
      setApiKey('');
      setDraftKey('');
      alert('Đã xóa API Key.');
    }
  };

  const processFiles = (files: FileList | null) => {
    if (!files) return;

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
              error: err.message || 'Định dạng file không hợp lệ'
            });
          }
        };
        reader.readAsText(file);
      });
    });

    Promise.all(newTasks).then((resolvedTasks) => {
      setTasks((prev) => [...prev, ...resolvedTasks]);
    });
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const updateTask = (id: string, updates: Partial<FileTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const processSingleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.originalSubs.length === 0) return;

    const activeKey = apiKey || process.env.API_KEY;
    if (!activeKey) {
      updateTask(task.id, { status: ProcessingStatus.ERROR, error: "Chưa cấu hình API Key. Vui lòng nhấn vào biểu tượng cài đặt." });
      setShowSettings(true);
      return;
    }

    updateTask(task.id, { status: ProcessingStatus.PROCESSING, progress: 2, error: undefined });

    try {
      // GIẢM BATCH_SIZE xuông 30 để AI không bị "lười" bỏ sót dòng
      const BATCH_SIZE = 30; 
      const results: SubtitleEntry[] = task.originalSubs.map(s => ({ ...s }));
      const totalEntries = task.originalSubs.length;
      let completedEntries = 0;

      const batches = [];
      for (let i = 0; i < totalEntries; i += BATCH_SIZE) {
        batches.push(task.originalSubs.slice(i, i + BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const translatedBatch = await translateSubtitleBatch(batch, task.prompt, activeKey);
        
        translatedBatch.forEach((tSub) => {
          // Sử dụng loose equality == để an toàn hơn với kiểu dữ liệu ID
          const index = results.findIndex(r => r.id == tSub.id);
          if (index !== -1) {
            results[index] = { ...results[index], text: tSub.translatedText };
          }
        });
        
        completedEntries += batch.length;
        const currentProgress = 5 + Math.floor((completedEntries / totalEntries) * 94);
        updateTask(task.id, { progress: currentProgress, processedSubs: [...results] });

        if (i < batches.length - 1) await new Promise(r => setTimeout(r, 2000));
      }

      updateTask(task.id, { 
        processedSubs: results, 
        status: ProcessingStatus.COMPLETED, 
        progress: 100 
      });
    } catch (err: any) {
      updateTask(task.id, { 
        status: ProcessingStatus.ERROR, 
        error: err.message || "Lỗi trong quá trình dịch" 
      });
      throw err;
    }
  };

  const processQueue = async () => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);

    const pendingTasks = tasks.filter(t => t.status !== ProcessingStatus.COMPLETED);
    
    for (const task of pendingTasks) {
      try {
        await processSingleTask(task.id);
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`Task ${task.fileName} failed`);
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
    a.download = `translated_${task.fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter(t => t.id !== id));
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4 font-sans">
      <div className="max-w-6xl w-full space-y-6">
        
        {/* Header & Main Controls */}
        <div className="bg-white p-6 md:p-8 rounded-3xl shadow-xl border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-indigo-600"></div>
          
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                <div className="bg-indigo-600 p-2 rounded-xl text-white">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                  </svg>
                </div>
                Gemini SRT Pro
              </h1>
              <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mt-2 flex items-center gap-2 justify-center md:justify-start">
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></span>
                Gemini 2.5 Flash &bull; Stable Engine
              </p>
            </div>
            
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-3 rounded-xl transition-all ${showSettings ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-slate-50 text-slate-500 border-slate-200'} border`}
                title="Cài đặt API Key"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-3 bg-white text-slate-700 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                Thêm file
              </button>

              <button
                onClick={processQueue}
                disabled={isGlobalProcessing || !tasks.some(t => t.status !== ProcessingStatus.COMPLETED)}
                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2"
              >
                {isGlobalProcessing ? 'Đang dịch...' : 'Bắt đầu ngay'}
              </button>
              
              <input 
                ref={fileInputRef} 
                type="file" 
                multiple 
                accept=".srt,.txt" 
                className="hidden" 
                onChange={handleFileUpload} 
              />
            </div>
          </div>

          {/* Settings Section */}
          {showSettings && (
            <div className="mt-6 pt-6 border-t border-slate-100 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="bg-slate-50 p-4 rounded-2xl flex flex-col md:flex-row items-center gap-4">
                <div className="flex-1 w-full relative">
                  <input
                    type="password"
                    placeholder="Nhập Gemini API Key của bạn (sẽ được che ***)"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                  />
                  {apiKey && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">
                      ĐÃ LƯU
                    </div>
                  )}
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                  <button 
                    onClick={handleUpdateKey}
                    className="flex-1 md:flex-none px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all"
                  >
                    Update
                  </button>
                  <button 
                    onClick={handleClearKey}
                    className="px-6 py-3 bg-white text-red-500 border border-red-100 rounded-xl text-sm font-bold hover:bg-red-50 transition-all"
                  >
                    Xóa
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 mt-2 ml-2">
                API Key được lưu trữ trực tiếp trong trình duyệt của bạn và chỉ được dùng để gọi API Gemini.
              </p>
            </div>
          )}
        </div>

        {/* Task List / Drop Zone */}
        <div 
          className={`relative min-h-[400px] transition-all rounded-[2.5rem] ${isDragging ? 'bg-indigo-50/50 scale-[0.99]' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {tasks.length === 0 ? (
            <div className={`border-3 border-dashed rounded-[2.5rem] p-24 text-center transition-all ${isDragging ? 'border-indigo-400 bg-white' : 'border-slate-200 bg-white shadow-sm'}`}>
              <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 transition-all ${isDragging ? 'bg-indigo-600 text-white scale-110' : 'bg-slate-50 text-slate-300'}`}>
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-700">Kéo thả file vào đây</h2>
              <p className="text-slate-400 font-medium mt-2 max-w-xs mx-auto">Hỗ trợ các định dạng .srt và .txt. Kéo file vào vùng này để bắt đầu dịch ngay.</p>
              
              {!apiKey && (
                <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-100">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  Bạn chưa nhập API Key
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {tasks.map((task) => (
                <div key={task.id} className={`bg-white p-5 rounded-3xl shadow-sm border ${task.status === ProcessingStatus.ERROR ? 'border-red-100 bg-red-50/30' : 'border-slate-100'} flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-300`}>
                  
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                    <div className="flex items-center gap-4 overflow-hidden">
                      <div className={`w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center ${
                        task.status === ProcessingStatus.COMPLETED ? 'bg-green-100 text-green-600' : 
                        task.status === ProcessingStatus.ERROR ? 'bg-red-100 text-red-600' :
                        'bg-slate-50 text-slate-400'
                      }`}>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-700 truncate text-sm" title={task.fileName}>{task.fileName}</h3>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{task.originalSubs.length} entries</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 w-full md:w-auto shrink-0">
                      {task.status === ProcessingStatus.PROCESSING && (
                        <div className="flex-1 md:w-40 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-indigo-600 h-full transition-all duration-700 ease-in-out" style={{ width: `${task.progress}%` }} />
                        </div>
                      )}
                      
                      <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border ${
                        task.status === ProcessingStatus.COMPLETED ? 'bg-green-50 text-green-700 border-green-100' :
                        task.status === ProcessingStatus.PROCESSING ? 'bg-indigo-50 text-indigo-700 border-indigo-100 animate-pulse' :
                        task.status === ProcessingStatus.ERROR ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-400 border-slate-100'
                      }`}>
                        {task.status} {task.status === ProcessingStatus.PROCESSING && `${task.progress}%`}
                      </span>

                      <div className="flex gap-1.5">
                        {task.status === ProcessingStatus.COMPLETED && (
                          <button onClick={() => downloadTask(task)} className="p-2.5 bg-green-600 text-white rounded-xl shadow-lg shadow-green-100 hover:bg-green-700 transition-all" title="Tải về">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </button>
                        )}
                        <button 
                          onClick={() => removeTask(task.id)}
                          disabled={task.status === ProcessingStatus.PROCESSING}
                          className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl disabled:opacity-30 transition-all"
                          title="Xóa"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      placeholder="Prompt cho file này: Ví dụ 'Dịch theo phong cách kiếm hiệp'..."
                      className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/10 transition-all"
                      value={task.prompt}
                      disabled={task.status === ProcessingStatus.PROCESSING || task.status === ProcessingStatus.COMPLETED}
                      onChange={(e) => updateTask(task.id, { prompt: e.target.value })}
                    />
                  </div>

                  {task.error && (
                    <div className="p-3 bg-red-100/50 text-red-700 text-[10px] font-bold rounded-2xl flex items-start gap-2 border border-red-100">
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      {task.error}
                    </div>
                  )}
                </div>
              ))}
              
              <div 
                className={`border-2 border-dashed rounded-3xl p-8 text-center transition-all ${isDragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-100 bg-slate-50/50 opacity-60'}`}
              >
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Kéo thả thêm file vào đây</p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <footer className="mt-20 text-slate-400 text-[10px] font-black uppercase tracking-[0.4em] text-center pb-10">
        Professional Translation Hub
      </footer>
    </div>
  );
};

export default App;
