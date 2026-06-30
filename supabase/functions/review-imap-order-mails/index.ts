import { serveReviewImapAdmin } from "../_shared/review-imap-admin.ts";

serveReviewImapAdmin({
  functionName: "review-imap-order-mails",
  mailbox: "INBOX",
  filterScope: "pedidos",
  allowedRoutes: ["/admin/correo-pedidos"],
  authErrorText: "No autorizado para consultar correo de pedidos",
  missingConfigText: "Configuracion IMAP de pedidos incompleta",
  invalidCredsText: "Credenciales IMAP invalidas para correo de pedidos",
  timeoutText: "Timeout consultando IMAP de pedidos",
  imapEnv: {
    host: ["IMAP_HOST"],
    user: ["IMAP_USER"],
    pass: ["IMAP_PASS"],
    port: ["IMAP_PORT"],
    secure: ["IMAP_SECURE", "IMAP_TLS"],
    tlsRejectUnauthorized: ["IMAP_TLS_REJECT_UNAUTHORIZED"],
    connectionTimeout: ["IMAP_CONNECTION_TIMEOUT_MS"],
    greetingTimeout: ["IMAP_GREETING_TIMEOUT_MS"],
    authTimeout: ["IMAP_AUTH_TIMEOUT_MS"],
    socketTimeout: ["IMAP_SOCKET_TIMEOUT_MS"],
    scanLimit: ["IMAP_ORDER_SCAN_LIMIT"],
  },
});
