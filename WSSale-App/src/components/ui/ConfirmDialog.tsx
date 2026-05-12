import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Info } from 'lucide-react';
import { Button } from './Base';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger';
}

export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary'
}: ConfirmDialogProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-[400px] bg-white rounded-[32px] shadow-2xl overflow-hidden border border-slate-200"
          >
            <div className="p-8">
              <div className="flex flex-col items-center text-center gap-4 mb-6">
                <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${variant === 'danger' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                  {variant === 'danger' ? <AlertTriangle size={32} /> : <Info size={32} />}
                </div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight leading-tight mt-2">
                  {title}
                </h3>
              </div>

              <p className="text-slate-600 text-[15px] leading-relaxed font-medium text-center px-2">
                {message || "Are you sure you want to proceed?"}
              </p>

              <div className="mt-8 flex flex-col gap-3">
                <Button
                  variant={variant === 'danger' ? 'danger' : 'primary'}
                  onClick={() => {
                    onConfirm();
                    onClose();
                  }}
                  className="w-full h-14 rounded-2xl font-bold shadow-lg shadow-primary/10 text-base"
                >
                  {confirmText}
                </Button>
                <Button
                  variant="ghost"
                  onClick={onClose}
                  className="w-full h-12 rounded-2xl font-bold text-slate-500"
                >
                  {cancelText}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
