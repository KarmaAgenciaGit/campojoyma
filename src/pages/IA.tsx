import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const initialMessages: Message[] = [];

const STORAGE_KEY = 'ia-chat-history';
const WEBHOOK_URL = 'https://n8n.srv792815.hstgr.cloud/webhook/80012763-530d-486b-a569-757186ac09b1';

const IA = () => {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        } else {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(initialMessages));
        }
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initialMessages));
      }
    } catch (error) {
      console.error('Error loading IA chat history:', error);
    }
  }, []);

  const appendMessage = (message: Message) => {
    setMessages((prev) => {
      const next = [...prev, message];
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (error) {
          console.error('Error persisting IA chat history:', error);
        }
      }
      return next;
    });
  };

  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (anchor) {
      anchor.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messages]);

  const handleClearConversation = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    setMessages([]);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    };

    const conversationSnapshot = [...messages, userMessage];

    appendMessage(userMessage);
    setInputValue('');
    setIsSending(true);

    const payload = {
      question: userMessage.content,
      timestamp: userMessage.timestamp,
      conversation: conversationSnapshot,
    };

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status} ${response.statusText}`);
      }

      let assistantContent = '';

      const contentType = response.headers.get('Content-Type') ?? '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        assistantContent =
          data.reply || data.response || data.message || data.content || JSON.stringify(data, null, 2);
      } else {
        const text = await response.text();
        if (text.trim().length > 0) {
          assistantContent = text;
        }
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      };

      appendMessage(assistantMessage);
    } catch (error) {
      console.error('Error sending message to webhook:', error);
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          'Ups, hubo un problema al contactar con el asistente. Vuelve a intentarlo en unos minutos o contacta con soporte.',
        timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      };
      appendMessage(assistantMessage);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="container mx-auto px-2 py-8">
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.6fr)_360px]">
        <Card className="border border-border/60 shadow-sm">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-semibold">BETA</Badge>
                  Asistente de Inteligencia Artificial
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Conversa con la Inteligencia Artificial para obtener ayuda contextual sobre pedidos, previsiones o cambios.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearConversation}
                disabled={messages.length === 0}
              >
                Limpiar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex h-[900px] 2xl:min-h-[960px] flex-col">
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 rounded-2xl border border-border/60 bg-muted/20 p-5">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'flex flex-col gap-1 rounded-2xl px-4 py-3 text-sm shadow-sm transition-transform duration-150 border',
                    message.role === 'assistant'
                      ? 'max-w-[85%] bg-white/80 text-slate-900 dark:bg-slate-900/80 dark:text-slate-50 border-blue-200 dark:border-blue-900'
                      : 'ml-auto max-w-[75%] bg-gradient-to-r from-primary to-primary/80 text-white border-primary/40 hover:scale-[1.01]'
                  )}
                >
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {message.role === 'assistant' ? 'Inteligencia Artificial Karma' : 'Tú'}
                  </span>
                  <span className="leading-relaxed whitespace-pre-wrap">{message.content}</span>
                  <span className="text-[11px] text-muted-foreground/70">{message.timestamp}</span>
                </div>
              ))}
              {messages.length === 0 && (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Aún no hay conversación. Empieza escribiendo tu consulta.
                </div>
              )}
              <div ref={scrollAnchorRef} />
            </div>
            <Separator className="my-4" />
            <form onSubmit={handleSubmit} className="flex items-end gap-3 rounded-2xl border border-border/60 bg-background p-4 shadow-sm">
              <div className="flex-1 space-y-2">
                <label htmlFor="chat-input" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Escribe tu pregunta
                </label>
                <textarea
                  id="chat-input"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder="Ej. ¿Cuántos pedidos se validaron hoy?"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-border/60 bg-background px-4 py-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <p className="text-[11px] text-muted-foreground">Presiona Enter para enviar. Shift + Enter para salto de línea.</p>
              </div>
              <Button type="submit" disabled={!inputValue.trim() || isSending} className="self-start px-6">
                {isSending ? 'Enviando…' : 'Enviar'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="hidden xl:flex h-fit flex-col gap-4 border border-border/60 bg-muted/30 p-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground">¿Qué puedes preguntar?</h2>
            <p className="text-xs text-muted-foreground mt-2">
              La Inteligencia Artificial está diseñada para ayudarte con tareas de logística y planificación. Prueba con consultas como:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>“Resúmeme los pedidos pendientes de procesar.”</li>
              <li>“¿Qué previsiones están retrasadas?”</li>
              <li>“Sugiere acciones para optimizar las cargas de mañana.”</li>
            </ul>
          </div>
          <Separator />
          <div className="space-y-2 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Limitaciones actuales</p>
            <p>
              Esta beta aún no está conectada con un modelo conversacional real. El flujo de interacción simula las
              respuestas mientras se finaliza la integración.
            </p>
            <p>Estamos trabajando para habilitar un modelo capaz de responder en base a tus datos y contexto corporativo.</p>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default IA;
