import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';

interface StudentObservationInputProps {
  studentId: string;
  value: string;
  onSave: (studentId: string, text: string) => void;
  isListening: boolean;
  onVoiceToggle: () => void;
}

export const StudentObservationInput: React.FC<StudentObservationInputProps> = ({
  studentId,
  value,
  onSave,
  isListening,
  onVoiceToggle
}) => {
  const [localVal, setLocalVal] = useState(value);
  const isFocused = useRef(false);

  // Sync with prop when NOT focused
  useEffect(() => {
    if (!isFocused.current) {
      setLocalVal(value);
    }
  }, [value]);

  const handleBlur = () => {
    isFocused.current = false;
    onSave(studentId, localVal);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalVal(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  return (
    <div className="flex items-center gap-2 flex-1">
      <input
        type="text"
        placeholder="Añada observaciones para este estudiante..."
        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-800 focus:border-transparent transition-all"
        value={localVal}
        onChange={handleChange}
        onFocus={() => { isFocused.current = true; }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      
      {/* DICTADO POR VOZ INDICATOR BUTTON */}
      <button
        type="button"
        onClick={() => {
          // Blur if focused to save current typed text first
          if (isFocused.current) {
            onSave(studentId, localVal);
          }
          onVoiceToggle();
        }}
        className={`p-2 rounded-xl transition cursor-pointer shrink-0 border ${
          isListening 
            ? 'bg-rose-500 text-white border-rose-600 mic-active shadow-md' 
            : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'
        }`}
        title="Dictar observación por voz"
      >
        {isListening ? (
          <div className="flex items-center gap-1 px-1">
            <MicOff className="h-4 w-4 text-white shrink-0" />
            <span className="text-[10px] font-bold uppercase animate-pulse w-max">Grabando...</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-1">
            <Mic className="h-4 w-4 text-rose-500 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-700">Dictar</span>
          </div>
        )}
      </button>
    </div>
  );
};
