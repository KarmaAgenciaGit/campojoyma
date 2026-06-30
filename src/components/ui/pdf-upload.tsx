import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Upload, FileText, X, ArrowLeft, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PdfUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const PdfUpload = ({ open, onOpenChange }: PdfUploadProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/jpg', 
        'image/png',
        'image/gif',
        'image/webp'
      ];
      
      if (allowedTypes.includes(file.type)) {
        setSelectedFile(file);
      } else {
        toast({
          title: "Error",
          description: "Solo se permiten archivos PDF e imágenes (JPG, PNG, GIF, WEBP)",
          variant: "destructive"
        });
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    try {
      // Convertir archivo a binario
      const arrayBuffer = await selectedFile.arrayBuffer();
      
      // Enviar al webhook
      const response = await fetch('https://n8n.srv792815.hstgr.cloud/webhook/facturas-n8n-almia-desktop', {
        method: 'POST',
        headers: {
          'Content-Type': selectedFile.type,
          'Content-Length': arrayBuffer.byteLength.toString(),
        },
        body: arrayBuffer
      });

      if (response.ok) {
        toast({
          title: "Éxito",
          description: "Factura enviada y procesada correctamente"
        });
        setSelectedFile(null);
        onOpenChange(false);
      } else {
        // Obtener detalles del error del servidor
        let errorMessage = `Error del servidor (${response.status})`;
        try {
          const errorText = await response.text();
          if (errorText) {
            errorMessage += `: ${errorText}`;
          }
        } catch (e) {
          // Si no se puede leer la respuesta, usar mensaje genérico
        }
        
        console.error('Server error:', response.status, response.statusText);
        toast({
          title: "Error del servidor",
          description: "El servidor de procesamiento no está disponible. Inténtalo más tarde.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error uploading PDF:', error);
      
      // Determinar el tipo de error
      let errorMessage = "Error al enviar la factura";
      if (error instanceof TypeError && error.message.includes('fetch')) {
        errorMessage = "No se puede conectar con el servidor. Verifica tu conexión a internet.";
      } else if (error instanceof Error) {
        errorMessage = `Error: ${error.message}`;
      }
      
      toast({
        title: "Error de conexión",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Loading Overlay */}
        {isUploading && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg">
            <div className="flex flex-col items-center gap-4 text-center">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div>
                <p className="text-lg font-medium text-foreground">Procesando factura...</p>
                <p className="text-sm text-muted-foreground">Espera mientras se procesa el documento</p>
              </div>
            </div>
          </div>
        )}

        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Nueva Factura
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-8 w-8"
              disabled={isUploading}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Upload Area */}
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
              onChange={handleFileSelect}
              className="hidden"
              id="pdf-upload"
              disabled={isUploading}
            />
            <label htmlFor="pdf-upload" className={`cursor-pointer ${isUploading ? 'pointer-events-none opacity-50' : ''}`}>
              <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Haz clic para seleccionar archivo
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                PDF o imágenes (JPG, PNG, GIF, WEBP)
              </p>
            </label>
          </div>

          {/* Selected File */}
          {selectedFile && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="h-8 w-8 text-blue-600" />
                  <div>
                    <p className="font-medium text-blue-900 dark:text-blue-100">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedFile(null)}
                  className="h-8 w-8 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900"
                  disabled={isUploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleClose}
              className="flex-1"
              disabled={isUploading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isUploading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enviando...
                </div>
              ) : (
                'Enviar Factura'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};