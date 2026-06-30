import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface PremiumLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  backPath?: string;
  stats?: {
    total: number;
    processed: number;
    pending: number;
  };
}

export function PremiumLayout({ 
  children, 
  title, 
  subtitle, 
  icon, 
  backPath = '/dashboard',
  stats 
}: PremiumLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-blue-950 dark:to-indigo-950">
      {/* Floating Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-blue-400/10 rounded-full blur-3xl animate-float" />
        <div className="absolute top-3/4 right-1/4 w-96 h-96 bg-purple-400/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-3/4 w-64 h-64 bg-indigo-400/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '4s' }} />
      </div>

      {/* Premium Header - Completamente Responsive */}
      <header className="relative border-b border-white/20 dark:border-gray-700/30 glass-effect shadow-xl sticky top-0 z-50">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-purple-600/5 to-indigo-600/10" />
        <div className="relative w-full max-w-full overflow-hidden">
          <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4 lg:py-6 max-w-full">
            <div className="flex flex-col gap-3 sm:gap-4 w-full max-w-full">
              {/* Top Row - Navigation & Title */}
              <div className="flex items-start gap-3 sm:gap-4 lg:gap-6 group animate-fade-in w-full max-w-full">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => navigate(backPath)}
                  className="group relative overflow-hidden border-2 border-white/20 dark:border-gray-700/30 hover:border-primary/40 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm hover:bg-primary/5 transition-all duration-300 flex-shrink-0"
                >
                  <ArrowLeft className="h-4 w-4 mr-1 sm:mr-2 group-hover:-translate-x-1 transition-transform duration-300" />
                  <span className="font-medium text-xs sm:text-sm">Volver</span>
                </Button>
                
                <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 min-w-0 flex-1">
                  <div className="relative flex-shrink-0">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl sm:rounded-2xl blur-lg opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                    <div className="relative p-2 sm:p-3 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-xl sm:rounded-2xl border border-white/20 dark:border-gray-700/30">
                      {icon}
                    </div>
                  </div>
                  
                  <div className="min-w-0 flex-1">
                    <h1 className="text-lg sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent break-words word-wrap leading-tight">
                      {title}
                    </h1>
                    {subtitle && (
                      <p className="text-muted-foreground font-medium mt-1 text-xs sm:text-sm lg:text-base break-words word-wrap">{subtitle}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats Section - Mobile Optimized */}
              {stats && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 animate-slide-in-right w-full max-w-full overflow-hidden">
                  {/* Total registros */}
                  <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-full border border-white/20 dark:border-gray-700/30 flex-shrink-0">
                    <Sparkles className="h-3 w-3 sm:h-4 sm:w-4 text-primary animate-pulse flex-shrink-0" />
                    <span className="text-xs sm:text-sm font-medium text-muted-foreground whitespace-nowrap">
                      {stats.total} <span className="hidden sm:inline">registros</span> total<span className="hidden sm:inline">es</span>
                    </span>
                  </div>
                  
                  {/* Status badges */}
                  <div className="flex gap-2 flex-wrap">
                    <div className="px-2 sm:px-3 py-1 bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 rounded-full text-xs sm:text-sm font-semibold border border-green-200 dark:border-green-800 whitespace-nowrap">
                      ✓ {stats.processed} <span className="hidden sm:inline">Procesados</span><span className="sm:hidden">Proc.</span>
                    </div>
                    <div className="px-2 sm:px-3 py-1 bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 rounded-full text-xs sm:text-sm font-semibold border border-amber-200 dark:border-amber-800 whitespace-nowrap">
                      ⏳ {stats.pending} <span className="hidden sm:inline">Pendientes</span><span className="sm:hidden">Pend.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative">
        {children}
      </main>
    </div>
  );
}