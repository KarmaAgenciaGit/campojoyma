import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Navigate } from 'react-router-dom';

const Auth = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, user } = useAuth();
  const { toast } = useToast();
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);

  // Fuerza tema claro en la pantalla de login
  useEffect(() => {
    try {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    const video = heroVideoRef.current;
    if (!video) return;

    const start = () => {
      video.loop = true;
      video.muted = true;
      video.playbackRate = 1.5;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    };

    if (video.readyState >= 2) {
      start();
    } else {
      const onReady = () => start();
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('canplay', onReady, { once: true });
      return () => {
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
      };
    }
  }, []);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await signIn(email, password);

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Ha ocurrido un error inesperado",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-grid">
        <div className="login-panel">
          <div className="login-panel-inner">
            <div className="flex flex-col items-center gap-0">
              <div className="login-logo-inline">
                <video
                  className="h-64 w-auto logo-video"
                  autoPlay
                  loop
                  muted
                  playsInline
                  ref={heroVideoRef}
                >
                  <source src="/lovable-uploads/Logo-Xfuego-All.mp4" type="video/mp4" />
                </video>
              </div>
              <div className="space-y-2 text-center -mt-2">
                <h1 className="text-3xl font-semibold text-foreground">¡Bienvenido!</h1>
                <p className="text-sm text-muted-foreground">
                  Inicia sesión para acceder al panel y mantener tus pedidos bajo control.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 login-form-plain">
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="border-input bg-card text-card-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-input bg-card text-card-foreground"
                />
              </div>
              <Button
                type="submit"
                className="w-full login-button text-primary-foreground"
                disabled={loading}
              >
                {loading ? 'Cargando...' : 'Entrar'}
              </Button>
            </form>
          </div>
        </div>

        <div className="login-visual">
          <div className="login-visual-overlay">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.14em] text-primary-foreground/80">
                AGRO xFuego
              </p>
              <h2 className="text-2xl font-semibold text-white leading-snug">
                <span className="block">Todo aquí,</span>
                <span className="block">ahorrándote tiempo mediante la Inteligencia Artificial</span>
              </h2>
              <p className="text-sm text-white/80 max-w-md">
                Inicia sesión para ver tus pedidos, previsiones y avisos en un solo vistazo.
              </p>
            </div>
            <div className="login-summary-card">
              <h3 className="text-2xl font-bold text-white leading-tight">Panel de pedidos</h3>
              <p className="text-sm text-white/85 mt-1">
                Accede para ver el estado de tus pedidos y más, aquí.
              </p>
              <div className="login-summary-skeleton">
                <div className="shimmer-line short" />
                <div className="shimmer-line" />
                <div className="shimmer-line" />
              </div>
                <p className="text-xs text-white/75 mt-2">
                  Datos generados automáticamente por la Inteligencia Artificial de AGRO xFUEGO.
                </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
