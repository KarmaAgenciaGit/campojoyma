import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Mic, Square, Play, Pause, ArrowLeft, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AudioRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AudioRecorder = ({ open, onOpenChange }: AudioRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const { toast } = useToast();

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        
        // Cleanup stream
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      setRecordingTime(0);
      
      // Start timer
      intervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast({
        title: "Error",
        description: "No se pudo acceder al micrófono",
        variant: "destructive"
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume();
        intervalRef.current = setInterval(() => {
          setRecordingTime(prev => prev + 1);
        }, 1000);
      } else {
        mediaRecorderRef.current.pause();
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      }
      setIsPaused(!isPaused);
    }
  };

  const playAudio = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const deleteRecording = () => {
    setAudioBlob(null);
    setAudioUrl('');
    setRecordingTime(0);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const handleUpload = async () => {
    if (!audioBlob) return;

    setIsUploading(true);
    try {
      // Convertir audio a base64 usando FileReader para manejar archivos grandes
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix (data:audio/webm;base64,)
          const base64Data = result.split(',')[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });
      
      // Enviar al webhook
      const response = await fetch('https://n8n.srv792815.hstgr.cloud/webhook/partes-audio-n8n-almia-desktop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio: base64,
          mimeType: 'audio/webm;codecs=opus',
          duration: recordingTime
        })
      });

      if (response.ok) {
        toast({
          title: "Éxito",
          description: "Parte de trabajo enviado correctamente"
        });
        handleClose();
      } else {
        throw new Error('Error en la respuesta del servidor');
      }
    } catch (error) {
      console.error('Error uploading audio:', error);
      toast({
        title: "Error",
        description: "Error al enviar el parte de trabajo",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (isRecording) {
      stopRecording();
    }
    deleteRecording();
    onOpenChange(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-gradient-to-br from-background via-background to-emerald-50/20 dark:to-emerald-950/20 border-0 shadow-2xl">
        <DialogHeader className="space-y-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-2 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600">
                <Mic className="h-5 w-5 text-white" />
              </div>
              <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent font-bold">
                Nuevo Parte de Trabajo
              </span>
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-9 w-9 rounded-full hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Enhanced Timer Display */}
          <div className="text-center py-6">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-green-600/20 to-emerald-600/20 rounded-2xl blur-xl"></div>
              <div className="relative bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-2xl p-6 border border-green-200 dark:border-green-800">
                <div className="text-4xl font-mono font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                  {formatTime(recordingTime)}
                </div>
                
                {/* Recording Status with Animation */}
                {isRecording && (
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <div className={`w-3 h-3 rounded-full bg-red-500 ${isPaused ? '' : 'animate-pulse'}`} />
                    <span className="text-sm font-medium text-muted-foreground">
                      {isPaused ? 'Pausado' : 'Grabando...'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-8 pb-6">
          {/* Enhanced Control Buttons */}
          <div className="flex justify-center gap-4">
            {!isRecording && !audioBlob && (
              <Button
                onClick={startRecording}
                className="h-16 w-16 rounded-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
              >
                <Mic className="h-6 w-6" />
              </Button>
            )}

            {isRecording && (
              <>
                <Button
                  onClick={pauseRecording}
                  variant="outline"
                  className="h-12 w-12 rounded-full border-2 border-green-200 hover:border-green-300 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-950/20 transition-all duration-200"
                >
                  {isPaused ? <Play className="h-5 w-5 text-green-600" /> : <Pause className="h-5 w-5 text-green-600" />}
                </Button>
                <Button
                  onClick={stopRecording}
                  className="h-16 w-16 rounded-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
                >
                  <Square className="h-6 w-6" />
                </Button>
              </>
            )}

            {audioBlob && (
              <>
                <Button
                  onClick={playAudio}
                  variant="outline"
                  className="h-12 w-12 rounded-full border-2 border-green-200 hover:border-green-300 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-950/20 transition-all duration-200"
                >
                  {isPlaying ? <Pause className="h-5 w-5 text-green-600" /> : <Play className="h-5 w-5 text-green-600" />}
                </Button>
                <Button
                  onClick={deleteRecording}
                  variant="outline"
                  className="h-12 w-12 rounded-full border-2 border-red-200 hover:border-red-300 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/20 text-red-600 hover:text-red-700 transition-all duration-200"
                >
                  <Trash2 className="h-5 w-5" />
                </Button>
              </>
            )}
          </div>

          {/* Hidden Audio Player */}
          {audioUrl && (
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />
          )}

          {/* Enhanced Action Buttons */}
          {(audioBlob || !isRecording) && (
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1 h-12 rounded-xl border-2 hover:bg-muted/50 transition-all duration-200"
              >
                Cancelar
              </Button>
              {audioBlob && (
                <Button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="flex-1 h-12 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50"
                >
                  {isUploading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Enviando...
                    </div>
                  ) : (
                    'Enviar Parte'
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};