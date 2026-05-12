import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { cn } from './Base';

interface Option {
  value: string;
  label: string;
  description?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export function SearchableSelect({ options, value, onChange, placeholder = "Select option...", label }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);

  const filteredOptions = options.filter(o => 
    (o.label?.toLowerCase().includes(search.toLowerCase()) ?? false) || 
    (o.value?.toLowerCase().includes(search.toLowerCase()) ?? false)
  ).slice(0, 100); // Limit to 100 for performance

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-1.5" ref={containerRef}>
      {label && <label className="text-sm font-semibold text-foreground">{label}</label>}
      <div className="relative">
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "flex items-center justify-between w-full rounded-lg border border-border bg-white py-2.5 px-3 text-sm cursor-pointer transition-all shadow-sm hover:border-slate-400",
            isOpen && "ring-1 ring-ring border-ring"
          )}
        >
          <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown className={cn("ml-2 h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
        </div>

        {isOpen && (
          <div className="absolute z-50 w-full mt-2 bg-white border border-border rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-2 border-b border-border bg-slate-50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                <input 
                  autoFocus
                  className="w-full bg-white border border-border rounded-md py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Type to search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto p-1 custom-scrollbar">
              {filteredOptions.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground italic text-center">No results found</div>
              ) : (
                filteredOptions.map((opt) => (
                  <div
                    key={opt.value}
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={cn(
                      "flex items-center justify-between px-3 py-2 text-sm rounded-md cursor-pointer transition-colors",
                      value === opt.value ? "bg-primary/10 text-primary font-medium" : "hover:bg-slate-100"
                    )}
                  >
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                      {opt.description && <span className="text-[10px] opacity-60">{opt.description}</span>}
                    </div>
                    {value === opt.value && <Check size={14} />}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
