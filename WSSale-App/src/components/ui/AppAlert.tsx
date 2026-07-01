import { createRoot, Root } from 'react-dom/client';
import { AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';

type AlertType = 'error' | 'success' | 'info';

let alertRoot: Root | null = null;
let alertContainer: HTMLDivElement | null = null;

const AlertComponent = ({ message, type, onClose }: { message: string, type: AlertType, onClose: () => void }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(true);
  }, []);

  const handleClose = () => {
    setOpen(false);
    setTimeout(onClose, 300); // wait for exit animation
  };

  const isError = type === 'error';
  const isSuccess = type === 'success';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[99999] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-sm flex flex-col items-center p-6 text-center"
          >
            <div className={`h-16 w-16 rounded-full flex items-center justify-center mb-4 ${
              isError ? 'bg-red-50 text-red-500' : 
              isSuccess ? 'bg-emerald-50 text-emerald-500' : 
              'bg-blue-50 text-blue-500'
            }`}>
              {isError ? <AlertTriangle size={32} /> : isSuccess ? <CheckCircle size={32} /> : <Info size={32} />}
            </div>
            
            <h3 className="text-xl font-bold text-slate-800 mb-2">
              {isError ? 'แจ้งเตือน' : isSuccess ? 'สำเร็จ' : 'ข้อมูล'}
            </h3>
            
            <div className="text-slate-600 mb-6 break-words whitespace-pre-wrap max-h-48 overflow-y-auto w-full text-sm">
              {message}
            </div>
            
            <button
              onClick={handleClose}
              className={`w-full py-3 px-4 rounded-xl font-bold text-white transition-all active:scale-[0.98] ${
                isError ? 'bg-red-500 hover:bg-red-600 shadow-red-500/25' : 
                isSuccess ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/25' : 
                'bg-blue-500 hover:bg-blue-600 shadow-blue-500/25'
              } shadow-lg`}
            >
              ตกลง
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export const appConfirm = (message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    let container = document.createElement('div');
    document.body.appendChild(container);
    let root = createRoot(container);
    
    const cleanup = (result: boolean) => {
      root.unmount();
      container.remove();
      resolve(result);
    };

    const isError = message.includes('⚠️') || message.includes('ลบ') || message.includes('ยกเลิก');

    root.render(
      <AnimatePresence>
        <div className="fixed inset-0 z-[99999] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-sm flex flex-col items-center p-6 text-center"
          >
            <div className={`h-16 w-16 rounded-full flex items-center justify-center mb-4 ${isError ? 'bg-amber-50 text-amber-500' : 'bg-blue-50 text-blue-500'}`}>
              {isError ? <AlertTriangle size={32} /> : <Info size={32} />}
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">ยืนยันการทำรายการ</h3>
            <div className="text-slate-600 mb-6 break-words whitespace-pre-wrap max-h-48 overflow-y-auto w-full text-sm">
              {message}
            </div>
            <div className="flex gap-3 w-full">
              <button onClick={() => cleanup(false)} className="flex-1 py-2.5 px-4 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all active:scale-[0.98]">
                ยกเลิก
              </button>
              <button onClick={() => cleanup(true)} className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-white transition-all active:scale-[0.98] ${isError ? 'bg-red-500 hover:bg-red-600 shadow-red-500/25 shadow-lg' : 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/25 shadow-lg'}`}>
                ตกลง
              </button>
            </div>
          </motion.div>
        </div>
      </AnimatePresence>
    );
  });
};

export const appPrompt = (message: string, defaultValue: string = ''): Promise<string | null> => {
  return new Promise((resolve) => {
    let container = document.createElement('div');
    document.body.appendChild(container);
    let root = createRoot(container);
    
    let inputValue = defaultValue;
    
    const cleanup = (submit: boolean) => {
      root.unmount();
      container.remove();
      resolve(submit ? inputValue : null);
    };

    const PromptModal = () => {
      const [val, setVal] = useState(defaultValue);
      return (
        <AnimatePresence>
          <div className="fixed inset-0 z-[99999] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-sm flex flex-col items-center p-6 text-center"
            >
              <h3 className="text-xl font-bold text-slate-800 mb-2">ระบุข้อมูล</h3>
              <div className="text-slate-600 mb-4 break-words whitespace-pre-wrap w-full text-sm">
                {message}
              </div>
              <input 
                type="text" 
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 mb-6"
                value={val}
                onChange={e => { setVal(e.target.value); inputValue = e.target.value; }}
                onKeyDown={e => { if (e.key === 'Enter') cleanup(true); else if (e.key === 'Escape') cleanup(false); }}
              />
              <div className="flex gap-3 w-full">
                <button onClick={() => cleanup(false)} className="flex-1 py-2.5 px-4 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all active:scale-[0.98]">
                  ยกเลิก
                </button>
                <button onClick={() => cleanup(true)} className="flex-1 py-2.5 px-4 rounded-xl font-bold text-white bg-blue-500 hover:bg-blue-600 shadow-blue-500/25 shadow-lg transition-all active:scale-[0.98]">
                  ตกลง
                </button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>
      );
    };
    
    root.render(<PromptModal />);
  });
};

export const setupGlobalAlert = () => {
  if (typeof window === 'undefined') return;
  
  // Store original just in case
  (window as any)._originalAlert = window.alert;
  
  window.alert = (message?: any) => {
    const msgString = String(message || '');
    
    // Auto-detect type from message context
    const msgLower = msgString.toLowerCase();
    let type: AlertType = 'info';
    if (msgLower.includes('error') || msgLower.includes('fail') || msgLower.includes('ไม่สำเร็จ') || msgLower.includes('กรุณา') || msgLower.includes('ต้อง')) {
      type = 'error';
    } else if (msgLower.includes('success') || msgLower.includes('สำเร็จ') || msgLower.includes('✓')) {
      type = 'success';
    } else if (msgLower.includes('⚠')) {
      type = 'error';
    }

    if (!alertContainer) {
      alertContainer = document.createElement('div');
      document.body.appendChild(alertContainer);
      alertRoot = createRoot(alertContainer);
    }
    
    const cleanup = () => {
      if (alertRoot) {
        alertRoot.unmount();
        alertRoot = null;
      }
      if (alertContainer) {
        alertContainer.remove();
        alertContainer = null;
      }
    };

    alertRoot.render(<AlertComponent message={msgString} type={type} onClose={cleanup} />);
  };
};
