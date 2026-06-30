import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Search, 
  Filter, 
  X, 
  Calendar, 
  Euro, 
  Building2, 
  User, 
  Hash,
  ChevronDown,
  ChevronUp,
  RotateCcw
} from 'lucide-react';

export interface FilterField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'date' | 'dateRange' | 'number' | 'numberRange';
  options?: { value: string; label: string }[];
  placeholder?: string;
  icon?: React.ReactNode;
}

export interface FilterValues {
  [key: string]: any;
}

interface AdvancedFiltersProps {
  fields: FilterField[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  onClear: () => void;
  activeFiltersCount: number;
  className?: string;
}

export const AdvancedFilters: React.FC<AdvancedFiltersProps> = ({
  fields,
  values,
  onChange,
  onClear,
  activeFiltersCount,
  className = ""
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(values.search || '');

  const handleFieldChange = (key: string, value: any) => {
    const newValues = { ...values, [key]: value };
    onChange(newValues);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSearchTerm = e.target.value;
    setSearchTerm(newSearchTerm);
    handleFieldChange('search', newSearchTerm);
  };

  const removeFilter = (key: string) => {
    const newValues = { ...values };
    delete newValues[key];
    if (key === 'search') {
      setSearchTerm('');
    }
    onChange(newValues);
  };

  const renderFieldInput = (field: FilterField) => {
    const value = values[field.key];

    switch (field.type) {
      case 'text':
        return (
          <Input
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className="bg-white/50 dark:bg-gray-800/50 border-white/20 dark:border-gray-700/30 backdrop-blur-sm"
          />
        );

      case 'select':
        return (
          <Select value={value || ''} onValueChange={(val) => handleFieldChange(field.key, val)}>
            <SelectTrigger className="bg-white/50 dark:bg-gray-800/50 border-white/20 dark:border-gray-700/30 backdrop-blur-sm">
              <SelectValue placeholder={field.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'date':
        return (
          <Input
            type="date"
            value={value || ''}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className="bg-white/50 dark:bg-gray-800/50 border-white/20 dark:border-gray-700/30 backdrop-blur-sm"
          />
        );

      case 'dateRange':
        return (
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              placeholder="Desde"
              value={value?.from || ''}
              onChange={(e) => handleFieldChange(field.key, { ...value, from: e.target.value })}
              className="bg-white/50 dark:bg-gray-800/50 border-white/20 dark:border-gray-700/30 backdrop-blur-sm"
            />
            <Input
              type="date"
              placeholder="Hasta"
              value={value?.to || ''}
              onChange={(e) => handleFieldChange(field.key, { ...value, to: e.target.value })}
              className="bg-white/50 dark:bg-gray-800/50 border-white/20 dark:border-gray-700/30 backdrop-blur-sm"
            />
          </div>
        );

      case 'number':
        return (
          <Input
            type="number"
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => handleFieldChange(field.key, parseFloat(e.target.value) || '')}
            className="bg-white/50 dark:bg-gray-800/50 border-white/20 dark:border-gray-700/30 backdrop-blur-sm"
          />
        );

      case 'numberRange':
        return (
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder="Mín"
              value={value?.min || ''}
              onChange={(e) => handleFieldChange(field.key, { ...value, min: parseFloat(e.target.value) || '' })}
              className="bg-white/50 dark:bg-gray-800/50 border-white/20 dark:border-gray-700/30 backdrop-blur-sm"
            />
            <Input
              type="number"
              placeholder="Máx"
              value={value?.max || ''}
              onChange={(e) => handleFieldChange(field.key, { ...value, max: parseFloat(e.target.value) || '' })}
              className="bg-white/50 dark:bg-gray-800/50 border-white/20 dark:border-gray-700/30 backdrop-blur-sm"
            />
          </div>
        );

      default:
        return null;
    }
  };

  const getActiveFilters = () => {
    return Object.entries(values)
      .filter(([key, value]) => {
        if (key === 'search') return false;
        if (value === '' || value === null || value === undefined) return false;
        if (typeof value === 'object' && (!value.from && !value.to && !value.min && !value.max)) return false;
        return true;
      })
      .map(([key, value]) => {
        const field = fields.find(f => f.key === key);
        return { key, value, field };
      });
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar en todos los campos..."
          value={searchTerm}
          onChange={handleSearchChange}
          className="pl-10 h-12 bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm border-white/20 dark:border-gray-700/30 text-lg placeholder:text-muted-foreground/70 focus:bg-white dark:focus:bg-gray-900 transition-all duration-300"
        />
        {searchTerm && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeFilter('search')}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Active Filters */}
      {getActiveFilters().length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-muted-foreground font-medium">Filtros activos:</span>
          {getActiveFilters().map(({ key, value, field }) => (
            <Badge
              key={key}
              variant="secondary"
              className="gap-2 bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors"
            >
              {field?.icon}
              <span className="font-medium">{field?.label}:</span>
              <span>
                {typeof value === 'object' 
                  ? `${value.from || value.min || '?'} - ${value.to || value.max || '?'}`
                  : String(value)
                }
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeFilter(key)}
                className="h-4 w-4 p-0 hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            className="gap-2 h-7 text-xs hover:bg-destructive/10 hover:text-destructive border-destructive/20"
          >
            <RotateCcw className="h-3 w-3" />
            Limpiar todo
          </Button>
        </div>
      )}

      {/* Advanced Filters */}
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            className="w-full gap-2 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm border-white/20 dark:border-gray-700/30 hover:bg-white/70 dark:hover:bg-gray-900/70 transition-all duration-300"
          >
            <Filter className="h-4 w-4" />
            Filtros Avanzados
            {activeFiltersCount > 0 && (
              <Badge variant="secondary" className="ml-2 bg-primary/20 text-primary">
                {activeFiltersCount}
              </Badge>
            )}
            {isOpen ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-4 mt-4">
          <Card className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl border-white/20 dark:border-gray-700/30">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5 text-primary" />
                Filtros Detallados
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {fields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      {field.icon}
                      {field.label}
                    </Label>
                    {renderFieldInput(field)}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};