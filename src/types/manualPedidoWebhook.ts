export interface ManualPedidoDomicilio {
  PAIS: string;
  DOMICILIO: string;
  POBLACION: string;
  ID_DOMSUJ: string;
  sujetodomicilioid: number;
  codigopostal: string;
  nombre_identificador_domicilio_sujeto: string;
}

export interface ManualPedidoClienteX {
  clienteid: number;
  perfilclienteid: number | null;
  empresaid: string;
  comercialid: string;
}

export interface ManualPedidoClienteObtenido {
  sujetocontactoid: number | null;
  sujetoid: number;
  clienteid: number;
  cliente: string;
  persona_contacto: string;
  observacion: string;
  sujetocontactodetid: number | null;
  tipo_dato: string;
  dato: string;
  perfilcliente: string;
  subgrupoanalisis: string;
  clienteX: ManualPedidoClienteX;
  domicilio: ManualPedidoDomicilio;
}

export interface ManualPedidoPdf {
  b64: string;
  fileName: string;
  texto_extraido: null;
}

export interface ManualPedidoPayloadItem {
  subject: string;
  clienteObtenido: ManualPedidoClienteObtenido;
  adjuntosIgnorados: unknown[];
  pdf: ManualPedidoPdf;
  pdfExiste: boolean;
  pdfHash: string | null;
  pdfIdSupabase: string | null;
  skip: boolean;
  skip_reason: string | null;
  ipOrizon: string;
  idSupabase: string;
  data: string;
  tipoEntrada: 'PEDIDO';
}
