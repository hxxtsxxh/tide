"use client";
import { useRef } from "react";
import { MODES, type ModeId } from "@/lib/modes";

/** Segmented research-mode control: a radio group with roving focus (arrow keys, Home/End). */
export default function ModePicker({ value, onChange, disabled }: { value: ModeId; onChange: (m: ModeId) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + MODES.length) % MODES.length;
    onChange(MODES[n]!.id);
    refs.current[n]?.focus();
  };
  return (
    <div className="mode-picker" role="radiogroup" aria-label="Research mode">
      {MODES.map((m, i) => (
        <button
          key={m.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === m.id}
          tabIndex={value === m.id ? 0 : -1}
          data-testid={`mode-${m.id}`}
          className="mode-option"
          title={m.description}
          disabled={disabled}
          onClick={() => onChange(m.id)}
          onKeyDown={(e) => {
            const k = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: MODES.length - 1 }[e.key];
            if (k === undefined) return;
            e.preventDefault();
            move(k);
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
