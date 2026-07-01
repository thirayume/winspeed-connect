import React, { useState, useEffect, useRef } from 'react';
import { parseThaiDateToGregorian, toThaiDateInputFormat } from '../../utils/date';
import { Calendar } from 'lucide-react';

interface ThaiDatePickerProps {
  value: string; // Expected in YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export const ThaiDatePicker: React.FC<ThaiDatePickerProps> = ({ 
  value, 
  onChange, 
  className = "w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C] focus:border-transparent",
  placeholder = "วว/ดด/ปปปป"
}) => {
  const [displayValue, setDisplayValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync prop value to display value
  useEffect(() => {
    if (value) {
      const thaiFormat = toThaiDateInputFormat(value);
      if (thaiFormat !== displayValue) {
        setDisplayValue(thaiFormat);
      }
    } else {
      setDisplayValue('');
    }
  }, [value]);

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

    // Restrict max length to 10 (dd/MM/yyyy)
    if (raw.length > 10) return;

    setDisplayValue(raw);

    // If fully typed, try to parse and trigger onChange
    if (raw.length === 10) {
      const gregorian = parseThaiDateToGregorian(raw);
      if (gregorian) {
        onChange(gregorian);
      }
    } else if (raw === '') {
      onChange(''); // Handle clearing
    }
  };

  const handleBlur = () => {
    // If partial or invalid input, revert to last valid value or clear if it was meant to be cleared
    if (displayValue.length > 0 && displayValue.length < 10) {
      if (value) {
        setDisplayValue(toThaiDateInputFormat(value));
      } else {
        setDisplayValue('');
      }
    } else if (displayValue.length === 10) {
       const gregorian = parseThaiDateToGregorian(displayValue);
       if (!gregorian) {
         setDisplayValue(value ? toThaiDateInputFormat(value) : '');
       }
    }
  };

  return (
    <div className="relative inline-block w-full">
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={`${className} pl-3 pr-8 w-full`}
        maxLength={10}
      />
      <Calendar size={16} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input 
        type="date"
        value={value || ''}
        onChange={(e) => {
          if (e.target.value) {
            onChange(e.target.value);
            setDisplayValue(toThaiDateInputFormat(e.target.value));
          }
        }}
        className="absolute right-0 top-0 bottom-0 opacity-0 cursor-pointer w-10 h-full"
      />
    </div>
  );
};
