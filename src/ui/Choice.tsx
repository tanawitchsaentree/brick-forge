import type { ReactNode } from "react";
import { Tabs } from "pane-react";

// One choice out of a few (kinds, levels, sizes, sources): Pane's Tabs without
// panels, so the group gets roving focus and arrow keys. Values are strings,
// as Radix wants them; callers convert.

export interface ChoiceOption {
  value: string;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

interface Props {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  title?: string;
}

export function Choice({ label, value, options, onChange, title }: Props) {
  return (
    <Tabs.Root value={value} onValueChange={onChange} activationMode="manual" title={title}>
      <Tabs.List aria-label={label}>
        {options.map((o) => (
          <Tabs.Trigger key={o.value} value={o.value} title={o.title} disabled={o.disabled}>
            {o.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
