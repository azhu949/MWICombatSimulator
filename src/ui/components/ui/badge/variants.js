import { cva } from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-[11px] font-semibold tabular-nums',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border bg-transparent text-foreground',
        success: 'border-success/35 bg-success/12 text-success',
        warning: 'border-warning/35 bg-warning/12 text-warning',
        destructive: 'border-destructive/35 bg-destructive/12 text-destructive',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);
