import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Upload, X, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

interface SemillasUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SemillasUpload({ open, onOpenChange, onSuccess }: SemillasUploadProps) {
  const [frontalImage, setFrontalImage] = useState<File | null>(null);
  const [traseroImage, setTraseroImage] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [step, setStep] = useState<'frontal' | 'trasero' | 'confirm'>('frontal');

  const handleFileSelect = (file: File, type: 'frontal' | 'trasero') => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Por favor selecciona una imagen válida');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('La imagen debe ser menor a 10MB');
      return;
    }

    if (type === 'frontal') {
      setFrontalImage(file);
      setStep('trasero');
    } else {
      setTraseroImage(file);
      setStep('confirm');
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, type: 'frontal' | 'trasero') => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file, type);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const convertToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data:image/...;base64, prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleUpload = async () => {
    if (!frontalImage && !traseroImage) {
      toast.error('Debes seleccionar al menos una imagen');
      return;
    }

    setIsUploading(true);

    try {
      const data: any = {};

      if (frontalImage) {
        const frontalBase64 = await convertToBase64(frontalImage);
        data.base64_frontal_bolsa = frontalBase64;
      }

      if (traseroImage) {
        const traseroBase64 = await convertToBase64(traseroImage);
        data.base64_trasero_bolsa = traseroBase64;
      }

      // Get user token and session for webhook
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !session?.user?.id) {
        toast.error('No se pudo obtener el token de autenticación');
        return;
      }

      // Send to webhook
      const response = await fetch('https://n8n.srv792815.hstgr.cloud/webhook/semillas-n8n-almia-desktop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...data,
          token: session.access_token,
          type: 'semillas'
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      let result;
      try {
        result = await response.json();
        console.log('Upload response:', result);
      } catch (parseError) {
        // If response is not JSON, just treat as success if status is ok
        console.log('Response is not JSON, treating as success');
        toast.success('Imágenes procesadas correctamente');
        handleClose();
        onSuccess?.();
        return;
      }

      // Check if result contains semillas data to insert in database
      if (result && result.fabricante && result.variedad && result.tipo_semilla) {
        console.log('Processing semillas data from n8n response');
        
        // Parse and format the data for database insertion
        const parseDate = (dateStr: string) => {
          if (!dateStr || dateStr === 'No especificado') return null;
          
          // Handle MM/YYYY format (like "09/2021")
          if (/^\d{2}\/\d{4}$/.test(dateStr)) {
            const [month, year] = dateStr.split('/');
            return `${year}-${month}-01`;
          }
          
          // Handle MM-YYYY format (like "03-2021")
          if (/^\d{2}-\d{4}$/.test(dateStr)) {
            const [month, year] = dateStr.split('-');
            return `${year}-${month}-01`;
          }
          
          // Handle YYYY-MM-DD format (already valid)
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
          }
          
          // If format is not recognized, return null to avoid database errors
          console.warn(`Unrecognized date format: ${dateStr}`);
          return null;
        };

        const semillaData = {
          user_id: session.user.id,
          fabricante: result.fabricante,
          variedad: result.variedad,
          tipo_semilla: result.tipo_semilla,
          cantidad_semillas: result.cantidad_semillas,
          numero_producto: result.numero_producto,
          numero_lote: result.numero_lote,
          color_cultivo: result.color_cultivo || null,
          especie: result.especie,
          fecha_envasado: parseDate(result.fecha_envasado),
          origen: result.origen || null,
          tratamiento: result.tratamiento || null,
          germinacion_minima: result.germinacion_minima,
          pureza: result.pureza,
          categoria: result.categoria && result.categoria !== 'No especificado' ? result.categoria : null,
          test_fecha: parseDate(result.test_fecha),
          codigo_apc: result.codigo_apc || null,
          base64_frontal_bolsa: result.base64_frontal_bolsa || null,
          base64_trasero_bolsa: result.base64_trasero_bolsa || null,
          is_processed: true
        };

        // Insert into database
        const { error: insertError } = await supabase
          .from('semillas')
          .insert(semillaData);

        if (insertError) {
          console.error('Error inserting semilla:', insertError);
          toast.error('Error al guardar los datos de semillas en la base de datos');
          return;
        }

        toast.success('Semillas procesadas y guardadas correctamente');
      } else {
        // If no semillas data, just show success for image upload
        toast.success('Imágenes procesadas correctamente');
      }

      handleClose();
      onSuccess?.();
    } catch (error) {
      console.error('Error uploading images:', error);
      toast.error('Error al procesar las imágenes');
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      setFrontalImage(null);
      setTraseroImage(null);
      setStep('frontal');
      onOpenChange(false);
    }
  };

  const handleSkipTrasero = () => {
    setStep('confirm');
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'frontal' && 'Subir Imagen Frontal'}
            {step === 'trasero' && 'Subir Imagen Trasera (Opcional)'}
            {step === 'confirm' && 'Confirmar Envío'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {step === 'frontal' && (
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Sube la imagen de la parte frontal de la bolsa de semillas
              </p>
              
              <Card 
                className="border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-colors cursor-pointer"
                onDrop={(e) => handleDrop(e, 'frontal')}
                onDragOver={handleDragOver}
              >
                <label className="flex flex-col items-center justify-center p-8 cursor-pointer">
                  <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-sm font-medium mb-2">Haz clic o arrastra la imagen aquí</p>
                  <p className="text-xs text-muted-foreground">PNG, JPG hasta 10MB</p>
                  <Input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file, 'frontal');
                    }}
                  />
                </label>
              </Card>
            </div>
          )}

          {step === 'trasero' && (
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Sube la imagen de la parte trasera de la bolsa de semillas (opcional)
              </p>
              
              <Card 
                className="border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-colors cursor-pointer"
                onDrop={(e) => handleDrop(e, 'trasero')}
                onDragOver={handleDragOver}
              >
                <label className="flex flex-col items-center justify-center p-8 cursor-pointer">
                  <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-sm font-medium mb-2">Haz clic o arrastra la imagen aquí</p>
                  <p className="text-xs text-muted-foreground">PNG, JPG hasta 10MB</p>
                  <Input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file, 'trasero');
                    }}
                  />
                </label>
              </Card>

              <div className="flex gap-2">
                <Button variant="outline" onClick={handleSkipTrasero} className="flex-1">
                  Omitir Trasera
                </Button>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Confirma las imágenes que vas a enviar para procesar
              </p>
              
              <div className="space-y-4">
                {frontalImage && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Imagen Frontal</h4>
                    <div className="flex items-center gap-3 p-3 border rounded-lg">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{frontalImage.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(frontalImage.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFrontalImage(null);
                          setStep('frontal');
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {traseroImage && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Imagen Trasera</h4>
                    <div className="flex items-center gap-3 p-3 border rounded-lg">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{traseroImage.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(traseroImage.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setTraseroImage(null);
                          setStep('trasero');
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {isUploading && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">Procesando imágenes...</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-4">
          <Button 
            variant="outline" 
            onClick={handleClose} 
            disabled={isUploading}
            className="flex-1"
          >
            Cancelar
          </Button>
          {step === 'confirm' && (
            <Button 
              onClick={handleUpload} 
              disabled={isUploading || (!frontalImage && !traseroImage)}
              className="flex-1"
            >
              Enviar Semillas
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}