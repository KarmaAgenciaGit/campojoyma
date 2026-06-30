import { serveReviewImapAdmin } from "../_shared/review-imap-admin.ts";

serveReviewImapAdmin({
  functionName: "review-imap-sales-mails",
  mailbox: "INBOX",
  filterScope: "cuentaventa",
  allowedRoutes: ["/admin/correo-cuentas-venta"],
  authErrorText: "No autorizado para consultar correo de cuentas de venta",
  missingConfigText: "Configuracion IMAP de cuentas de venta incompleta",
  invalidCredsText: "Credenciales IMAP invalidas para correo de cuentas de venta",
  timeoutText: "Timeout consultando IMAP de cuentas de venta",
  imapEnv: {
    host: ["IMAP_SALES_HOST", "IMAP_CUENTAS_VENTA_HOST"],
    user: ["IMAP_SALES_USER", "IMAP_CUENTAS_VENTA_USER"],
    pass: ["IMAP_SALES_PASS", "IMAP_CUENTAS_VENTA_PASS"],
    port: ["IMAP_SALES_PORT", "IMAP_CUENTAS_VENTA_PORT"],
    secure: [
      "IMAP_SALES_SECURE",
      "IMAP_SALES_TLS",
      "IMAP_CUENTAS_VENTA_SECURE",
      "IMAP_CUENTAS_VENTA_TLS",
    ],
    tlsRejectUnauthorized: [
      "IMAP_SALES_TLS_REJECT_UNAUTHORIZED",
      "IMAP_CUENTAS_VENTA_TLS_REJECT_UNAUTHORIZED",
    ],
    connectionTimeout: [
      "IMAP_SALES_CONNECTION_TIMEOUT_MS",
      "IMAP_CUENTAS_VENTA_CONNECTION_TIMEOUT_MS",
      "IMAP_CONNECTION_TIMEOUT_MS",
    ],
    greetingTimeout: [
      "IMAP_SALES_GREETING_TIMEOUT_MS",
      "IMAP_CUENTAS_VENTA_GREETING_TIMEOUT_MS",
      "IMAP_GREETING_TIMEOUT_MS",
    ],
    authTimeout: [
      "IMAP_SALES_AUTH_TIMEOUT_MS",
      "IMAP_CUENTAS_VENTA_AUTH_TIMEOUT_MS",
      "IMAP_AUTH_TIMEOUT_MS",
    ],
    socketTimeout: [
      "IMAP_SALES_SOCKET_TIMEOUT_MS",
      "IMAP_CUENTAS_VENTA_SOCKET_TIMEOUT_MS",
      "IMAP_SOCKET_TIMEOUT_MS",
    ],
    scanLimit: ["IMAP_SALES_SCAN_LIMIT", "IMAP_CUENTAS_VENTA_SCAN_LIMIT"],
  },
});
