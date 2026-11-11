import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { bangkokDate, formatThaiDate } from '../../utils/date';

interface ThaiDateTimePickerProps {
  value: string; // YYYY-MM-DDTHH:mm or ISO datetime
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const DAYS_IN_WEEK = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function parseIncomingValue(value: string): { dateStr: string; hh: string; mm: string } | null {
  if (!value) return null;
  const raw = String(value).trim();
  const wall = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (wall && !/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    return { dateStr: wall[1], hh: wall[2], mm: wall[3] };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const bkk = new Date(d.getTime() + 7 * 3600000);
  const dateStr = bkk.toISOString().slice(0, 10);
  return {
    dateStr,
    hh: String(bkk.getUTCHours()).padStart(2, '0'),
    mm: String(bkk.getUTCMinutes()).padStart(2, '0'),
  };
}

export const ThaiDateTimePicker: React.FC<ThaiDateTimePickerProps> = ({
  value,
  onChange,
  className = 'w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]',
  placeholder = 'วว/ดด/ปปปป HH:mm',
  disabled = false,
}) => {
  const parsed = parseIncomingValue(value);
  const todayStr = bangkokDate();
  const [selectedDate, setSelectedDate] = useState(parsed?.dateStr || '');
  const [hour, setHour] = useState(parsed?.hh || '08');
  const [minute, setMinute] = useState(parsed?.mm || '00');
  const [isOpen, setIsOpen] = useState(false);

  const initialYear = parsed ? Number(parsed.dateStr.slice(0, 4)) : Number(todayStr.slice(0, 4));
  const initialMonth = parsed ? Number(parsed.dateStr.slice(5, 7)) - 1 : Number(todayStr.slice(5, 7)) - 1;
  const [currentYear, setCurrentYear] = useState(initialYear);
  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const p = parseIncomingValue(value);
    if (p) {
      setSelectedDate(p.dateStr);
      setHour(p.hh);
      setMinute(p.mm);
      setCurrentYear(Number(p.dateStr.slice(0, 4)));
      setCurrentMonth(Number(p.dateStr.slice(5, 7)) - 1);
    } else {
      setSelectedDate('');
    }
  }, [value]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const emit = (dateStr: string, h: string, m: string) => {
    if (!dateStr) {
      onChange('');
      return;
    }
    onChange(`${dateStr}T${h}:${m}`);
  };

  const displayText = selectedDate
    ? formatThaiDate(`${selectedDate}T${hour}:${minute}:00`, true)
    : '';

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();

  return (
    <div className="relative inline-block w-full" ref={containerRef}>
      <div className="relative">
        <input
          type="text"
          readOnly
          value={displayText}
          placeholder={placeholder}
          disabled={disabled}
          onClick={() => !disabled && setIsOpen(o => !o)}
          className={`${className} pl-3 pr-9 cursor-pointer bg-white ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-100' : ''}`}
        />
        <Calendar
          size={15}
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
          onClick={() => !disabled && setIsOpen(o => !o)}
        />
      </div>

      {isOpen && !disabled && (
        <div className="absolute left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-[290px]">
          <div className="flex justify-between items-center mb-2">
            <button
              type="button"
              onClick={() => {
                if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
                else setCurrentMonth(m => m - 1);
              }}
              className="p-1 hover:bg-gray-100 rounded-full text-gray-600"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="font-bold text-gray-800 text-sm">
              {THAI_MONTHS[currentMonth]} {currentYear + 543}
            </div>
            <button
              type="button"
              onClick={() => {
                if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
                else setCurrentMonth(m => m + 1);
              }}
              className="p-1 hover:bg-gray-100 rounded-full text-gray-600"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[11px] font-bold text-gray-400">
            {DAYS_IN_WEEK.map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1 place-items-center mb-3">
            {Array.from({ length: firstDay }).map((_, idx) => <div key={`e-${idx}`} className="h-7 w-7" />)}
            {Array.from({ length: daysInMonth }, (_, idx) => idx + 1).map(day => {
              const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = selectedDate === dateStr;
              const isToday = todayStr === dateStr;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    setSelectedDate(dateStr);
                    emit(dateStr, hour, minute);
                  }}
                  className={`h-7 w-7 rounded-full flex items-center justify-center text-xs transition-colors ${
                    isSelected
                      ? 'bg-[#0C447C] text-white font-bold'
                      : isToday
                        ? 'text-[#0C447C] font-bold border border-[#0C447C]'
                        : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <Clock size={14} className="text-[#0C447C]" />
              <span>เวลา (24 ชม.)</span>
            </div>
            <div className="flex items-center gap-1">
              <select
                value={hour}
                onChange={e => {
                  const nh = e.target.value;
                  setHour(nh);
                  const d = selectedDate || todayStr;
                  setSelectedDate(d);
                  emit(d, nh, minute);
                }}
                className="border border-gray-300 rounded px-1.5 py-1 text-xs font-mono bg-white"
              >
                {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="font-bold text-gray-500">:</span>
              <select
                value={minute}
                onChange={e => {
                  const nm = e.target.value;
                  setMinute(nm);
                  const d = selectedDate || todayStr;
                  setSelectedDate(d);
                  emit(d, hour, nm);
                }}
                className="border border-gray-300 rounded px-1.5 py-1 text-xs font-mono bg-white"
              >
                {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-between items-center mt-2.5 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => { setSelectedDate(''); emit('', hour, minute); setIsOpen(false); }}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
            >
              ล้างค่า
            </button>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const now = new Date(Date.now() + 7 * 3600000);
                  const d = now.toISOString().slice(0, 10);
                  const h = String(now.getUTCHours()).padStart(2, '0');
                  const m = String(now.getUTCMinutes()).padStart(2, '0');
                  setSelectedDate(d);
                  setHour(h);
                  setMinute(m);
                  emit(d, h, m);
                  setIsOpen(false);
                }}
                className="text-xs text-[#0C447C] font-semibold hover:bg-blue-50 px-2 py-1 rounded"
              >
                ตอนนี้
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xs bg-[#0C447C] text-white font-semibold px-2.5 py-1 rounded"
              >
                ตกลง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

