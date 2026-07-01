import { useEffect, useRef, useState, useCallback } from 'react';
import { ScanLine, X, CheckCircle, History, Camera, CameraOff } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { scanPaper, fetchPaperHistory } from '../../services/api';
import type { PaperScanRow, PaperCopy } from '../../types';

const ACTIONS = [
  { key: 'TRANSIT', label: 'กำลังส่ง (In Transit)' },
  { key: 'SIGN',    label: 'เซ็นรับแล้ว (Signed)' },
  { key: 'FILE',    label: 'จัดเก็บ (Filed)' },
  { key: 'LOST',    label: 'แจ้งหาย (Lost)' },
  { key: 'FOUND',   label: 'พบแล้ว (Found)' },
];

export function ScanModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [showCamera, setShowCamera] = useState(false);
  const [nonce, setNonce] = useState('');
  const [action, setAction] = useState('SIGN');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>('');
  const [err, setErr] = useState('');
  const [copy, setCopy] = useState<PaperCopy | null>(null);
  const [history, setHistory] = useState<PaperScanRow[]>([]);

  async function lookup() {
    setErr(''); setResult('');
    if (!nonce.trim()) return;
    try {
      const r = await fetchPaperHistory(nonce.trim());
      setCopy(r.copy); setHistory(r.history);
    } catch (e) { setErr((e as Error).message); setCopy(null); setHistory([]); }
  }

  async function submit() {
    if (!nonce.trim()) { setErr('กรอก/สแกน QR ก่อน'); return; }
    setBusy(true); setErr(''); setResult('');
    try {
      const r = await scanPaper(nonce.trim(), action);
      setResult(`✓ ${r.color} → ${r.status}`);
      await lookup();
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  // Effect to lookup automatically if nonce changes (and it looks like a full QR)
  useEffect(() => {
    if (nonce && nonce.length > 10 && !busy) {
      lookup();
    }
  }, [nonce]);

  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;
    
    if (showCamera) {
      html5QrCode = new Html5Qrcode("reader");
      html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          setNonce(decodedText);
          setShowCamera(false);
        },
        (errorMessage) => {
          // ignore scan errors, they happen continuously until a QR is found
        }
      ).catch(err => {
        setErr("ไม่สามารถเปิดกล้องได้: " + err);
        setShowCamera(false);
      });
    }

    return () => {
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(console.error);
      }
    };
  }, [showCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-800 flex items-center gap-2"><ScanLine size={18} className="text-[#0C447C]" /> สแกนเอกสาร (QR)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-gray-500">รหัส QR (สแกนหรือพิมพ์)</label>
          <button 
            onClick={() => setShowCamera(!showCamera)}
            className={`text-xs px-2 py-1 rounded-md flex items-center gap-1 font-semibold transition-colors ${showCamera ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}
          >
            {showCamera ? <><CameraOff size={14}/> ปิดกล้อง</> : <><Camera size={14}/> เปิดกล้องสแกน</>}
          </button>
        </div>
        
        {showCamera && (
          <div className="mb-3 rounded-lg overflow-hidden border border-gray-200 bg-black">
            <div id="reader" className="w-full"></div>
          </div>
        )}

        <input autoFocus value={nonce} onChange={e => setNonce(e.target.value)} onBlur={lookup}
          onKeyDown={e => { if (e.key === 'Enter') lookup(); }}
          placeholder="เช่น I69-03842-PINK-A1B2C3D4"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono mb-3 focus:ring-2 focus:ring-blue-500 outline-none" />

        <label className="text-xs font-semibold text-gray-500 block mb-1">การกระทำ</label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {ACTIONS.map(a => (
            <button key={a.key} onClick={() => setAction(a.key)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border ${action === a.key ? 'border-[#0C447C] bg-[#E6F1FB] text-[#0C447C]' : 'border-gray-200 text-gray-600'}`}>
              {a.label}
            </button>
          ))}
        </div>

        {copy && (
          <div className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-2.5 mb-3">
            <div className="flex justify-between"><span className="text-gray-400">SO</span><b>{copy.WfRef}</b></div>
            <div className="flex justify-between"><span className="text-gray-400">สำเนา</span><b>{copy.CopyLabel} ({copy.CopyColor})</b></div>
            <div className="flex justify-between"><span className="text-gray-400">สถานะปัจจุบัน</span><b>{copy.Status}</b></div>
            {history.length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-gray-200">
                <div className="flex items-center gap-1 text-gray-400 mb-0.5"><History size={11} /> ประวัติ</div>
                {history.slice(0, 4).map(h => (
                  <div key={h.Id} className="flex justify-between text-[11px] text-gray-500">
                    <span>{h.Action} → {h.ToStatus}</span>
                    <span>{new Date(h.ScannedAt).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {result && <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2 mb-2 flex items-center gap-1.5"><CheckCircle size={15} /> {result}</div>}
        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{err}</div>}

        <button disabled={busy} onClick={submit}
          className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: '#0C447C' }}>
          {busy ? 'กำลังบันทึก...' : 'ยืนยันการสแกน'}
        </button>
      </div>
    </div>
  );
}
