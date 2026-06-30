import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PremiumCard } from '@/components/ui/premium-components';
import { Settings, Plus, Edit, Save, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface ProductConfig {
  id: string;
  genero: string;
  emoji: string;
  color_class: string;
}

interface ProductConfigEditorProps {
  onConfigUpdate?: () => void;
}

const colorOptions = [
  { name: 'Rojo', value: 'bg-red-500/10 text-red-600 border-red-200', preview: 'bg-red-500' },
  { name: 'Naranja', value: 'bg-orange-500/10 text-orange-600 border-orange-200', preview: 'bg-orange-500' },
  { name: 'Amarillo', value: 'bg-yellow-500/10 text-yellow-600 border-yellow-200', preview: 'bg-yellow-500' },
  { name: 'Verde', value: 'bg-green-500/10 text-green-600 border-green-200', preview: 'bg-green-500' },
  { name: 'Esmeralda', value: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', preview: 'bg-emerald-500' },
  { name: 'Azul', value: 'bg-blue-500/10 text-blue-600 border-blue-200', preview: 'bg-blue-500' },
  { name: 'Púrpura', value: 'bg-purple-500/10 text-purple-600 border-purple-200', preview: 'bg-purple-500' },
  { name: 'Rosa', value: 'bg-pink-500/10 text-pink-600 border-pink-200', preview: 'bg-pink-500' },
  { name: 'Ámbar', value: 'bg-amber-500/10 text-amber-600 border-amber-200', preview: 'bg-amber-500' },
  { name: 'Violeta', value: 'bg-violet-500/10 text-violet-600 border-violet-200', preview: 'bg-violet-500' },
  { name: 'Gris', value: 'bg-gray-500/10 text-gray-600 border-gray-200', preview: 'bg-gray-500' },
];

export function ProductConfigEditor({ onConfigUpdate }: ProductConfigEditorProps = {}) {
  const { isAdmin } = useUserRole();
  const [products, setProducts] = useState<ProductConfig[]>([]);
  const [editingProduct, setEditingProduct] = useState<ProductConfig | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    genero: '',
    emoji: '',
    color_class: ''
  });

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('product_configs')
        .select('*')
        .order('genero');

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      toast.error('Error al cargar las configuraciones de productos');
    }
  };

  const handleEdit = (product: ProductConfig) => {
    setEditingProduct(product);
    setFormData({
      genero: product.genero,
      emoji: product.emoji,
      color_class: product.color_class
    });
    setIsNewProduct(false);
    setIsDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingProduct(null);
    setFormData({
      genero: '',
      emoji: '🌱',
      color_class: 'bg-green-500/10 text-green-600 border-green-200'
    });
    setIsNewProduct(true);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.genero.trim() || !formData.emoji.trim()) {
      toast.error('Por favor completa todos los campos obligatorios');
      return;
    }

    setLoading(true);
    try {
      if (isNewProduct) {
        const { error } = await supabase
          .from('product_configs')
          .insert([formData]);

        if (error) throw error;
        toast.success('Producto agregado correctamente');
      } else if (editingProduct) {
        const { error } = await supabase
          .from('product_configs')
          .update(formData)
          .eq('id', editingProduct.id);

        if (error) throw error;
        toast.success('Producto actualizado correctamente');
      }

      await fetchProducts();
      setIsDialogOpen(false);
      onConfigUpdate?.();
    } catch (error) {
      console.error('Error saving product:', error);
      toast.error('Error al guardar el producto');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (product: ProductConfig) => {
    if (!confirm(`¿Estás seguro de que quieres eliminar "${product.genero}"?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('product_configs')
        .delete()
        .eq('id', product.id);

      if (error) throw error;
      
      toast.success('Producto eliminado correctamente');
      await fetchProducts();
      onConfigUpdate?.();
    } catch (error) {
      console.error('Error deleting product:', error);
      toast.error('Error al eliminar el producto');
    }
  };

  const getColorPreview = (colorClass: string) => {
    const colorOption = colorOptions.find(opt => opt.value === colorClass);
    return colorOption?.preview || 'bg-gray-500';
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Configuración de Productos
        </h3>
        <Button onClick={handleAdd} size="sm" className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Agregar Producto
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((product) => (
          <PremiumCard key={product.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${product.color_class}`}>
                  <span className="text-lg">{product.emoji}</span>
                </div>
                <div>
                  <p className="font-medium capitalize">{product.genero}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className={`w-3 h-3 rounded-full ${getColorPreview(product.color_class)}`}></div>
                    <span className="text-xs text-muted-foreground">
                      {colorOptions.find(opt => opt.value === product.color_class)?.name || 'Color personalizado'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(product)}
                  className="h-8 w-8 p-0"
                >
                  <Edit className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(product)}
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </PremiumCard>
        ))}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isNewProduct ? 'Agregar Producto' : 'Editar Producto'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="genero">Nombre del Producto *</Label>
              <Input
                id="genero"
                value={formData.genero}
                onChange={(e) => setFormData({ ...formData, genero: e.target.value })}
                placeholder="ej: tomate, lechuga, pepino..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="emoji">Emoji *</Label>
              <Input
                id="emoji"
                value={formData.emoji}
                onChange={(e) => setFormData({ ...formData, emoji: e.target.value })}
                placeholder="🍅"
                maxLength={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <Select
                value={formData.color_class}
                onValueChange={(value) => setFormData({ ...formData, color_class: value })}
              >
                <SelectTrigger>
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full ${getColorPreview(formData.color_class)}`}></div>
                      {colorOptions.find(opt => opt.value === formData.color_class)?.name || 'Seleccionar color'}
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {colorOptions.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full ${color.preview}`}></div>
                        {color.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>Vista previa</Label>
              <div className={`p-3 rounded-lg ${formData.color_class} flex items-center gap-2`}>
                <span className="text-lg">{formData.emoji}</span>
                <span className="capitalize font-medium">{formData.genero || 'Producto'}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}