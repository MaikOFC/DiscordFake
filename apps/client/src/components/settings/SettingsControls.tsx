import type { ReactNode } from 'react';

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="mb-6">
      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{title}</h3>
      {hint && <p className="mb-2 text-xs text-zinc-500">{hint}</p>}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 rounded-lg bg-[#2b2d31] px-3 py-2.5 ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <span>
        <span className="block text-sm text-zinc-100">{label}</span>
        {description && <span className="block text-xs text-zinc-400">{description}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-emerald-500"
      />
    </label>
  );
}

export function RadioGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; description?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${
            value === option.value ? 'border-emerald-500/70 bg-emerald-500/10' : 'border-transparent bg-[#2b2d31]'
          }`}
        >
          <input
            type="radio"
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-1 accent-emerald-500"
          />
          <span>
            <span className="block text-sm text-zinc-100">{option.label}</span>
            {option.description && <span className="block text-xs text-zinc-400">{option.description}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-lg bg-[#2b2d31] px-3 py-2.5">
      <div className="mb-1 flex justify-between text-sm text-zinc-100">
        <span>{label}</span>
        <span className="font-mono text-xs text-zinc-300">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-emerald-500"
      />
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-[#1e1f22] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-500';

export const buttonClass =
  'cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButtonClass =
  'cursor-pointer rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 transition hover:bg-zinc-600 disabled:opacity-50';
