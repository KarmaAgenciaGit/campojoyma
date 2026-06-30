-- Allow duplicate referencia_cliente for Rosegar (clienteid 1873) on P220 by adjusting partial unique index

DROP INDEX IF EXISTS "public"."pedidos_referencia_unique_p220";

CREATE UNIQUE INDEX "pedidos_referencia_unique_p220" ON "public"."pedidos" USING "btree" ("referencia_cliente")
WHERE (("tipo_pedido" = 'P220'::"text")
  AND ("referencia_cliente" IS NOT NULL)
  AND ("referencia_cliente" <> ''::"text")
  AND ("clienteid" IS DISTINCT FROM 1873::bigint));
