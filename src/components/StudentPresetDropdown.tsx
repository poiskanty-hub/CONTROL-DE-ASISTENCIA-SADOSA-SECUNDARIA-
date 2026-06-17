import React, { useState, useEffect, useRef } from 'react';
import { Tag, Check, ChevronDown } from 'lucide-react';
import { PresetTag, PRESET_TAGS } from '../types';

interface StudentPresetDropdownProps {
  selectedTags: string[];
  onToggleTag: (tag: PresetTag) => void;
}

export const StudentPresetDropdown: React.FC<StudentPresetDropdownProps> = ({
  selectedTags,
  onToggleTag
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const activeCount = selectedTags.length;

  // Pretty display text helper
  const getLabel = (tag: PresetTag): string => {
    switch (tag) {
      case 'No presento cuaderno':
        return 'No presentó cuaderno';
      case 'No presento trabajo':
        return 'No presentó trabajo';
      case 'No participo en clases':
        return 'No participó en clases';
      case 'Genera indisciplina en el aula':
        return 'Genera indisciplina en el aula';
      default:
        return tag;
    }
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition duration-150 border cursor-pointer select-none ${
          activeCount > 0
            ? 'bg-amber-50 text-amber-900 border-amber-300 ring-1 ring-amber-300'
            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
        }`}
      >
        <Tag className={`h-3.5 w-3.5 ${activeCount > 0 ? 'text-amber-500 font-bold' : 'text-slate-400'}`} />
        <span>Rápidos</span>
        {activeCount > 0 && (
          <span className="bg-amber-200 text-amber-900 text-[10px] font-black px-1.5 py-0.2 rounded-full font-mono">
            {activeCount}
          </span>
        )}
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-64 rounded-xl bg-white border border-slate-200 shadow-xl z-50 py-1.5 focus:outline-none animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="px-3 py-1 border-b border-slate-100 mb-1.5 flex items-center justify-between">
            <span className="text-[9.5px] font-extrabold text-slate-400 uppercase tracking-widest block">Seleccionar Observaciones</span>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  PRESET_TAGS.forEach(tag => {
                    if (selectedTags.includes(tag)) {
                      onToggleTag(tag);
                    }
                  });
                }}
                className="text-[9px] font-black text-rose-500 hover:text-rose-700 uppercase"
              >
                Limpiar
              </button>
            )}
          </div>
          <div className="space-y-0.5 max-h-60 overflow-y-auto">
            {PRESET_TAGS.map((tag) => {
              const isSelected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    onToggleTag(tag);
                  }}
                  className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between hover:bg-slate-50 transition font-medium ${
                    isSelected ? 'text-amber-900 bg-amber-50/50 hover:bg-amber-50 font-semibold' : 'text-slate-700'
                  }`}
                >
                  <span className="leading-snug">{getLabel(tag)}</span>
                  {isSelected ? (
                    <Check className="h-3.5 w-3.5 text-amber-600 shrink-0 ml-2" />
                  ) : (
                    <span className="h-3.5 w-3.5 rounded border border-slate-200 shrink-0 ml-2 block" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
