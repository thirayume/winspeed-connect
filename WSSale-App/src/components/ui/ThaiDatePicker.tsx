import React, { useState, useEffect, useRef } from 'react';
import { parseThaiDateToGregorian, toThaiDateInputFormat } from '../../utils/date';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface ThaiDatePickerProps {
  value: string; // Expected in YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  min?: string;
  max?: string;
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const DAYS_IN_WEEK = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export const ThaiDatePicker: React.FC<ThaiDatePickerProps> = ({ 
  value, 
  onChange, 
  className = "w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C] focus:border-transparent",
  placeholder = "วว/ดด/ปปปป",
  min,
  max
}) => {
  const [displayValue, setDisplayValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync prop value to display value and calendar state
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        setCurrentMonth(d.getMonth());
        setCurrentYear(d.getFullYear());
      }
      const thaiFormat = toThaiDateInputFormat(value);
      if (thaiFormat !== displayValue) {
        setDisplayValue(thaiFormat);
      }
    } else {
      setDisplayValue('');
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/[^\d/]/g, ''); // Allow only numbers and slash
    
    // Auto-insert slash logic when typing forward
    if (raw.length > displayValue.length) {
      if (raw.length === 2 && !raw.includes('/')) {
        raw += '/';
      } else if (raw.length === 5 && raw.split('/').length === 2) {
        raw += '/';
      }
    }

    if (raw.length > 10) return;

    setDisplayValue(raw);

    // If fully typed, try to parse and trigger onChange
    if (raw.length === 10) {
      const gregorian = parseThaiDateToGregorian(raw);
      if (gregorian) {
        onChange(gregorian);
        const d = new Date(gregorian);
        if (!isNaN(d.getTime())) {
          setCurrentMonth(d.getMonth());
          setCurrentYear(d.getFullYear());
        }
      }
    } else if (raw === '') {
      onChange('');
    }
  };

  const handleBlur = () => {
    if (displayValue.length > 0 && displayValue.length < 10) {
      setDisplayValue(value ? toThaiDateInputFormat(value) : '');
    } else if (displayValue.length === 10) {
       const gregorian = parseThaiDateToGregorian(displayValue);
       if (!gregorian) {
         setDisplayValue(value ? toThaiDateInputFormat(value) : '');
       }
    }
  };

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(y => y - 1);
    } else {
      setCurrentMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(y => y + 1);
    } else {
      setCurrentMonth(m => m + 1);
    }
  };

  const selectDate = (day: number) => {
    const d = new Date(currentYear, currentMonth, day);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const gregorian = `${yyyy}-${mm}-${dd}`;
    
    if (min && gregorian < min) return;
    if (max && gregorian > max) return;

    onChange(gregorian);
    setIsOpen(false);
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
    
    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-8 w-8"></div>);
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(currentYear, currentMonth, day);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      
      let isDisabled = false;
      if (min && dateStr < min) isDisabled = true;
      if (max && dateStr > max) isDisabled = true;
      
      const isSelected = value === dateStr;
      const isToday = new Date().toISOString().split('T')[0] === dateStr;

      days.push(
        <button
          key={day}
          type="button"
          disabled={isDisabled}
          onClick={() => selectDate(day)}
          className={`h-8 w-8 rounded-full flex items-center justify-center text-sm transition-colors
            ${isDisabled ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 cursor-pointer'}
            ${isSelected ? 'bg-[#0C447C] text-white hover:bg-[#0a3866]' : 'text-gray-700'}
            ${isToday && !isSelected ? 'text-[#0C447C] font-bold border border-[#0C447C]' : ''}
          `}
        >
          {day}
        </button>
      );
    }
    
    return days;
  };

  const setToday = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const gregorian = `${yyyy}-${mm}-${dd}`;
    if ((min && gregorian < min) || (max && gregorian > max)) return;
    onChange(gregorian);
    setCurrentMonth(d.getMonth());
    setCurrentYear(d.getFullYear());
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block w-full" ref={containerRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          onClick={() => setIsOpen(true)}
          className={`${className} pl-3 pr-8 w-full`}
          maxLength={10}
        />
        <Calendar 
          size={16} 
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer" 
          onClick={() => setIsOpen(!isOpen)}
        />
      </div>

      {isOpen && (
        <div className="absolute left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[280px]">
          <div className="flex justify-between items-center mb-3">
            <button type="button" onClick={handlePrevMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
              <ChevronLeft size={18} />
            </button>
            <div className="font-bold text-gray-800 text-sm">
              {THAI_MONTHS[currentMonth]} {currentYear + 543}
            </div>
            <button type="button" onClick={handleNextMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>
          
          <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-bold text-gray-400">
            {DAYS_IN_WEEK.map(day => (
              <div key={day}>{day}</div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-1 place-items-center">
            {renderCalendar()}
          </div>

          <div className="flex justify-between mt-3 pt-3 border-t border-gray-100">
            <button 
              type="button" 
              onClick={() => { onChange(''); setIsOpen(false); }}
              className="text-xs text-red-500 font-medium hover:text-red-700 px-2 py-1 transition-colors"
            >
              ล้างค่า
            </button>
            <button 
              type="button" 
              onClick={setToday}
              className="text-xs text-[#0C447C] font-bold hover:bg-blue-50 px-2 py-1 rounded transition-colors"
            >
              วันนี้
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
