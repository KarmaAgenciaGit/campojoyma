import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export type SelectOption = {
  value: string;
  label: string;
};

type CustomSelectProps = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

const CustomSelect = ({
  options,
  value,
  onChange,
  id,
  placeholder = 'Selecciona...',
  disabled = false,
  className = '',
}: CustomSelectProps) => {
  return (
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger
        id={id}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3.5 text-sm text-foreground shadow-sm outline-none transition-[border-color,box-shadow,background-color] hover:border-slate-300 focus:border-primary/40 focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60 data-[placeholder]:text-muted-foreground dark:hover:border-slate-700',
          className,
        )}
        aria-label={placeholder}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          className="z-[80] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-slate-200 bg-popover text-popover-foreground shadow-[0_24px_50px_-24px_rgba(15,23,42,0.45)] dark:border-slate-800"
          position="popper"
          sideOffset={8}
        >
          <Select.Viewport className="p-1">
            {options.map((opt) => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className="relative flex min-h-10 cursor-default select-none items-center rounded-md py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-slate-100 data-[highlighted]:text-foreground data-[state=checked]:bg-primary data-[state=checked]:font-medium data-[state=checked]:text-primary-foreground dark:data-[highlighted]:bg-slate-800"
              >
                <Select.ItemIndicator className="absolute left-3 inline-flex items-center justify-center">
                  <Check size={13} />
                </Select.ItemIndicator>
                <Select.ItemText>{opt.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

export default CustomSelect;
