import { useState } from 'react';
import type { ChangeEvent, ChangeEventHandler, FocusEvent, FocusEventHandler, HTMLAttributes, ReactNode } from 'react';
import { formatNumericDisplayValue, normalizeNumericInput } from '../../utils/numberInput';

interface BadgeProps {
  label: string;
  className?: string;
}

export function Badge({ label, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-tight ${className}`}>
      {label.replace(/_/g, ' ')}
    </span>
  );
}

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`bg-white dark:bg-brand-700 rounded-2xl border border-brand-100 dark:border-brand-600 shadow-sm ${className}`} {...props}>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  color?: string;
}

export function StatCard({ label, value, sub, icon, color = 'text-brand-600' }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-400 dark:text-brand-200 mb-1.5">{label}</p>
          <p className={`text-[1.75rem] leading-8 font-bold ${color}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-brand-200 mt-1 leading-5">{sub}</p>}
        </div>
        {icon && <div className="text-brand-300 dark:text-brand-300 mt-0.5 [&>svg]:h-7 [&>svg]:w-7">{icon}</div>}
      </div>
    </Card>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-7 gap-4">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight text-brand-900 dark:text-brand-50">{title}</h1>
        {subtitle && <p className="text-sm text-brand-400 dark:text-brand-200 mt-1 leading-6 max-w-3xl">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', children, className = '', ...rest }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-semibold rounded-xl transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-1 [&>svg]:h-4 [&>svg]:w-4';
  const sizes = { sm: 'h-9 px-3 text-sm', md: 'h-10 px-4 text-sm' };
  const variants = {
    primary: 'bg-accent-500 text-white shadow-sm hover:bg-accent-600',
    secondary: 'bg-white dark:bg-brand-700 border border-brand-100 dark:border-brand-600 text-brand-900 dark:text-brand-50 shadow-sm hover:bg-accent-50 dark:hover:bg-brand-600',
    danger: 'bg-accent-700 text-white shadow-sm hover:bg-accent-800',
    ghost: 'text-brand-700 dark:text-brand-200 hover:bg-accent-50 dark:hover:bg-brand-700',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

function renderFieldLabel(label: string, required?: boolean) {
  const hasAsterisk = label.includes('*');
  const baseLabel = label.replace(/\s*\*+\s*$/, '').trim();

  return (
    <label className="text-sm font-medium text-gray-700 dark:text-brand-200">
      {baseLabel}
      {(required || hasAsterisk) && <span className="ml-1 text-accent-700">*</span>}
    </label>
  );
}

export function Input({ label, error, className = '', ...rest }: InputProps) {
  const isNumericInput = rest.type === 'number';
  const [numericDraftValue, setNumericDraftValue] = useState<string | null>(null);
  let rawValue: string | number = '';
  if (typeof rest.value === 'number' || typeof rest.value === 'string') {
    rawValue = rest.value;
  } else if (Array.isArray(rest.value)) {
    rawValue = rest.value.join('');
  }

  const numericDisplayValue = numericDraftValue ?? formatNumericDisplayValue(rawValue);
  const displayedValue = isNumericInput
    ? numericDisplayValue
    : rest.value;

  const handleNumberChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    const normalized = normalizeNumericInput(event.target.value);
    if (!/^-?\d*\.?\d*$/.test(normalized)) return;
    setNumericDraftValue(normalized);

    if (!rest.onChange) return;

    const patchedEvent = {
      ...event,
      target: {
        ...event.target,
        value: normalized,
      },
      currentTarget: {
        ...event.currentTarget,
        value: normalized,
      },
    } as ChangeEvent<HTMLInputElement>;

    rest.onChange(patchedEvent);
  };

  const handleNumberFocus: FocusEventHandler<HTMLInputElement> = (event) => {
    setNumericDraftValue(normalizeNumericInput(String(rawValue ?? '')));
    event.currentTarget.select();
    rest.onFocus?.(event);
  };

  const handleNumberBlur: FocusEventHandler<HTMLInputElement> = (event) => {
    setNumericDraftValue(null);
    rest.onBlur?.(event as FocusEvent<HTMLInputElement>);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {label && renderFieldLabel(label, rest.required)}
      <input
        className={`h-10 border border-brand-100 dark:border-brand-600 rounded-xl bg-white dark:bg-brand-700 px-3 text-sm text-brand-900 dark:text-brand-50 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 ${error ? 'border-accent-500' : ''} ${className}`}
        {...rest}
        type={isNumericInput ? 'text' : rest.type}
        inputMode={isNumericInput ? 'decimal' : rest.inputMode}
        value={displayedValue}
        onChange={isNumericInput ? handleNumberChange : rest.onChange}
        onFocus={isNumericInput ? handleNumberFocus : rest.onFocus}
        onBlur={isNumericInput ? handleNumberBlur : rest.onBlur}
      />
      {error && <p className="text-xs text-accent-700">{error}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
}

export function Select({ label, error, className = '', children, ...rest }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && renderFieldLabel(label, rest.required)}
      <select
        className={`h-10 border border-brand-100 dark:border-brand-600 rounded-xl px-3 text-sm text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 bg-white dark:bg-brand-700 shadow-sm ${className}`}
        {...rest}
      >
        {children}
      </select>
      {error && <p className="text-xs text-accent-700">{error}</p>}
    </div>
  );
}

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function TextArea({ label, className = '', ...rest }: TextAreaProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && renderFieldLabel(label, rest.required)}
      <textarea
        rows={3}
        className={`border border-brand-100 dark:border-brand-600 rounded-xl px-3 py-2 text-sm text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 resize-none bg-white dark:bg-brand-700 shadow-sm ${className}`}
        {...rest}
      />
    </div>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, footer, wide = false }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative bg-white dark:bg-brand-700 rounded-2xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] flex flex-col border border-brand-100 dark:border-brand-600`}>
        <div className="flex items-center justify-between p-5 border-b border-brand-100 dark:border-brand-600">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">{title}</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-100 text-xl leading-none h-8 w-8 rounded-lg hover:bg-brand-100 dark:hover:bg-brand-700">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
        {footer && <div className="p-5 border-t border-brand-100 dark:border-brand-600 flex justify-end gap-2 bg-brand-50/60 dark:bg-brand-800/60">{footer}</div>}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  helpText?: ReactNode;
}

export function EmptyState({ icon, title, description, action, secondaryAction, helpText }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      {icon ? (
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-100 dark:border-brand-600 bg-brand-50 dark:bg-brand-800 text-brand-700 dark:text-brand-200 [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
      ) : null}
      <p className="text-brand-700 dark:text-brand-100 text-base font-semibold mb-2 max-w-lg">{title}</p>
      {description && <p className="text-brand-400 dark:text-brand-200 text-sm mb-4 max-w-xl leading-6">{description}</p>}
      {(action || secondaryAction) ? (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
          {action}
          {secondaryAction}
        </div>
      ) : null}
      {helpText ? <div className="mt-4 max-w-xl text-xs leading-5 text-gray-500 dark:text-brand-300">{helpText}</div> : null}
    </div>
  );
}
