import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

interface PremiumCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  gradient?: boolean;
  hoverIntensity?: 'none' | 'subtle' | 'normal' | 'strong';
  accentColor?: string;
}

export function PremiumCard({ 
  children, 
  className = '', 
  hover = true, 
  gradient = false,
  hoverIntensity = 'subtle',
  accentColor
}: PremiumCardProps) {
  const baseClasses = "relative overflow-hidden backdrop-blur-sm bg-white/95 dark:bg-gray-900/95 border border-white/30 dark:border-gray-700/50 shadow-lg";
  
  const getHoverClasses = () => {
    if (!hover || hoverIntensity === 'none') return "";
    
    switch (hoverIntensity) {
      case 'subtle':
        return "hover:shadow-xl transition-all duration-300 ease-out";
      case 'normal':
        return "hover:shadow-xl hover:scale-[1.01] transition-all duration-300 ease-out";
      case 'strong':
        return "hover:shadow-2xl hover:scale-[1.02] hover:-translate-y-1 transition-all duration-500 ease-out";
      default:
        return "hover:shadow-xl transition-all duration-300 ease-out";
    }
  };
  
  const hoverClasses = getHoverClasses();
  const gradientClasses = gradient ? "bg-gradient-to-br from-white/98 via-blue-50/95 to-indigo-50/90 dark:from-gray-900/98 dark:via-blue-950/95 dark:to-indigo-950/90" : "";

  return (
    <Card className={`${baseClasses} ${hoverClasses} ${gradientClasses} ${className} animate-fade-in`}>
      {/* Enhanced background pattern with better gradient */}
      <div className="absolute inset-0 opacity-[0.03]">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-primary/10" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(120,119,198,0.1),transparent_50%)]" />
      </div>
      
      {/* Subtle border glow effect */}
      <div 
        className="absolute inset-0 rounded-[inherit] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: accentColor 
            ? `linear-gradient(to right, ${accentColor.includes('bg-') ? 'hsl(var(--primary))' : accentColor}/10, transparent, ${accentColor.includes('bg-') ? 'hsl(var(--primary))' : accentColor}/10)`
            : 'linear-gradient(to right, hsl(var(--primary))/10, transparent, hsl(var(--primary))/10)'
        }}
      />
      
      <div className="relative z-10">
        {children}
      </div>
    </Card>
  );
}

interface PremiumTableProps {
  children: ReactNode;
  className?: string;
}

export function PremiumTable({ children, className = '' }: PremiumTableProps) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-white/20 dark:border-gray-700/30 shadow-2xl ${className}`}>
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  className?: string;
}

export function EmptyState({ icon, title, description, className = '' }: EmptyStateProps) {
  return (
    <PremiumCard className={`text-center py-16 ${className}`} gradient>
      <div className="space-y-6">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full blur-xl opacity-20" />
          <div className="relative flex justify-center">
            {icon}
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-2xl font-bold text-foreground">{title}</h3>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">{description}</p>
        </div>
      </div>
    </PremiumCard>
  );
}