import { UnifiedPedidosView } from '@/components/UnifiedPedidosView';

const Orders = () => {
  return (
    <UnifiedPedidosView
      tipoPedido="P220"
      title="Pedidos"
      emptyMessage="No hay pedidos registrados"
    />
  );
};

export default Orders;
