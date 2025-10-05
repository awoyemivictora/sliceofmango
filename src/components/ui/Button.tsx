// import React from 'react';

// interface ButtonProps {
//   children: React.ReactNode;
//   onClick?: () => void;
//   variant?: 'primary' | 'secondary' | 'success' | 'warning';
//   size?: 'sm' | 'md' | 'lg';
//   disabled?: boolean;
//   className?: string;
// }

// const Button: React.FC<ButtonProps> = ({ 
//   children, 
//   onClick, 
//   variant = 'primary', 
//   size = 'md', 
//   disabled = false,
//   className = ''
// }) => {
//   const variants = {
//     primary: 'bg-primary text-white hover:bg-accent',
//     secondary: 'bg-secondary text-light hover:bg-dark-1',
//     success: 'bg-success text-white hover:bg-success/80',
//     warning: 'bg-warning-light text-warning hover:bg-warning-light/80'
//   };

//   const sizes = {
//     sm: 'px-3 py-1 text-sm',
//     md: 'px-4 py-2',
//     lg: 'px-6 py-3 text-lg'
//   };

//   return (
//     <button
//       onClick={disabled ? undefined : onClick}
//       disabled={disabled}
//       className={`rounded-lg font-medium transition-colors ${variants[variant]} ${sizes[size]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
//     >
//       {children}
//     </button>
//   );
// };

// export default Button;

























import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
