import { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  borderColor: string;
  processed: number;
  pending: number;
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
  primaryActionText: string;
  secondaryActionText?: string;
  isDisabled?: boolean;
  gradient: string;
}

export function StatCard({
  title,
  description,
  icon: Icon,
  iconColor,
  borderColor,
  processed,
  pending,
  onPrimaryAction,
  onSecondaryAction,
  primaryActionText,
  secondaryActionText,
  isDisabled = false,
  gradient
}: StatCardProps) {
  return (
    <Card className={`group relative overflow-hidden backdrop-blur-sm bg-white/90 dark:bg-gray-900/90 border-l-4 ${borderColor} hover:shadow-2xl hover:scale-[1.02] transition-all duration-500 ease-out animate-fade-in h-[400px] flex flex-col`}>
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-current to-transparent" />
      </div>
      
      <CardHeader className="relative pb-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-4 rounded-2xl ${gradient} shadow-lg group-hover:shadow-xl transition-all duration-300 group-hover:scale-110`}>
              <Icon className={`h-7 w-7 ${iconColor} group-hover:animate-pulse`} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors duration-300">
                {title}
              </h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          <div className="hidden sm:block p-2 rounded-lg bg-muted/50 group-hover:bg-primary/10 transition-colors duration-300">
            <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors duration-300" />
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col justify-between space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {/* Processed Stats */}
          <div className="group/stat relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/50 dark:to-emerald-900/50 p-5 hover:shadow-lg transition-all duration-300 hover:scale-105">
            <div className="absolute top-0 right-0 p-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-emerald-700 dark:text-emerald-400 mb-2 group-hover/stat:scale-110 transition-transform duration-300">
                {processed.toLocaleString()}
              </div>
              <div className="text-xs font-medium text-emerald-600 dark:text-emerald-500 flex items-center justify-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                Procesados
              </div>
            </div>
          </div>
          
          {/* Pending Stats */}
          <div className="group/stat relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/50 dark:to-amber-900/50 p-5 hover:shadow-lg transition-all duration-300 hover:scale-105">
            <div className="absolute top-0 right-0 p-2">
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-amber-700 dark:text-amber-400 mb-2 group-hover/stat:scale-110 transition-transform duration-300">
                {pending.toLocaleString()}
              </div>
              <div className="text-xs font-medium text-amber-600 dark:text-amber-500 flex items-center justify-center gap-2">
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                Pendientes
              </div>
            </div>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="space-y-3">
          <Button
            onClick={onPrimaryAction}
            disabled={isDisabled}
            className="w-full group relative overflow-hidden bg-gradient-to-r from-gray-900 to-gray-700 text-white border-0 hover:from-gray-800 hover:to-gray-600 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed h-12 text-sm font-semibold"
          >
            <span className="relative z-10">{primaryActionText}</span>
            {!isDisabled && (
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            )}
          </Button>
          
          {secondaryActionText && onSecondaryAction && (
            <Button
              onClick={onSecondaryAction}
              variant="outline"
              className="w-full border-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all duration-300 hover:scale-[1.02] h-10 text-sm"
            >
              {secondaryActionText}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}