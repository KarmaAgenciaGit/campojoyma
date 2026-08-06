from __future__ import annotations

import json
import sys
import urllib.parse
from copy import deepcopy
from decimal import Decimal

import run_material_cycles as r


def main() -> int:
    if r.Path(r.os.path.realpath(r.RELEASE)) != r.EXPECTED_RELEASE:
        r.fail("active release changed")
    lock = r.MAINTENANCE_LOCK.open("a", encoding="utf-8")
    try:
        r.fcntl.flock(lock.fileno(), r.fcntl.LOCK_EX | r.fcntl.LOCK_NB)
    except BlockingIOError:
        r.fail("another Netagro maintenance operation is active")

    initial = r.snapshot()
    a_marker = f"NETAGRO-MA:{r.REQUEST_A}"
    if initial["business"]["references"] != {"T260806-MA-209-A": 1}:
        r.fail("cycle A reference is not the exact expected committed row")
    if initial["business"]["markers"] != {a_marker: 1}:
        r.fail("cycle A marker is not the exact expected committed row")
    idem = {row["request_id"]: row for row in initial["idempotency"]["rows"]}
    if set(idem) != {r.REQUEST_A}:
        r.fail("B/negative request already exists or A request is absent")
    if idem[r.REQUEST_A]["status"] != "completed" or idem[r.REQUEST_A]["phase"] != "commit":
        r.fail("cycle A is not completed in idempotency")
    r.assert_gate()

    with r.reader_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT AMA_idalb
                FROM {r.SCHEMA}.albmaterial
                WHERE AMA_referencia=%s
                """,
                ("T260806-MA-209-A",),
            )
            rows = cursor.fetchall()
    if len(rows) != 1:
        r.fail("cycle A cannot be resolved uniquely")
    a_id = int(rows[0]["AMA_idalb"])
    query = urllib.parse.urlencode(
        {"target_id": r.TARGET_ID, "dataset_epoch": r.DATASET_EPOCH}
    )
    a_get = r.api_json("GET", f"/albaranes/material/{a_id}?{query}")
    a_lines = r.api_json("GET", f"/albaranes/material/{a_id}/lineas?{query}")
    if (
        int(a_get["albaran"]["AMA_idacreedor"]) != 209
        or Decimal(str(a_get["albaran"]["AMA_importe"])) != Decimal("7.99")
        or len(a_get.get("lineas") or []) != 1
        or int(a_get["lineas"][0]["AML_idmaterial"]) != 905
        or len(a_lines.get("items") or []) != 1
        or int(a_lines["items"][0]["line_id"])
        != int(a_get["lineas"][0]["AML_idlinea"])
    ):
        r.fail("cycle A target-aware GET readback mismatch")
    r.emit(
        "RESUME_PREFLIGHT",
        {
            "cycle_a_completed": True,
            "cycle_a_id": a_id,
            "cycle_a_target_get": True,
            "cycle_b_absent": True,
            "negative_absent": True,
            "gate": True,
            "target_id": r.TARGET_ID,
            "dataset_epoch": r.DATASET_EPOCH,
        },
    )

    payload_b = {
        "contract_version": 3,
        "operation": "validate",
        "request_id": r.REQUEST_B,
        "target_id": r.TARGET_ID,
        "dataset_epoch": r.DATASET_EPOCH,
        "cabecera": {
            "empresa_id": 1,
            "campana": 25,
            "serie": "A26",
            "fecha": "2026-08-06",
            "acreedor_id": 17,
            "referencia": "T260806-MA-017-B",
            "observaciones": "TEST CICLO B MATERIAL 905",
            "centro_id": 1,
            "punto_venta_id": 1,
            "almacen_id": 1,
            "tipo_cp": "P",
            "matricula": "",
            "importe_esperado": "79.90",
            "duplicado_confirmado_distinto": False,
            "duplicados_revisados_ids": [],
        },
        "lineas": [
            {
                "material_id": 905,
                "marca_id": 0,
                "cantidad": "10.0000",
                "precio": "7.990000",
                "descuento": "0.00",
                "referencia": "T260806-MA-017-B",
                "observaciones": "TEST B",
            }
        ],
    }
    committed_b, state_after_b = r.run_cycle(
        "B", payload_b, "79.90", replay_commit=False
    )
    r.assert_one_commit_delta(initial["business"], state_after_b["business"])

    r.assert_gate()
    negative_payload = deepcopy(payload_b)
    negative_payload["request_id"] = r.REQUEST_NEGATIVE
    negative_payload["cabecera"]["importe_esperado"] = "79.91"
    before_negative = r.snapshot()
    negative = r.api_json(
        "POST", "/albaranes/material", r.post_bytes(negative_payload)
    )
    errors = negative.get("validations", {}).get("errors") or []
    if (
        negative.get("operation") != "validate"
        or negative.get("ok") is not False
        or negative.get("would_create") is not False
        or len(errors) != 1
    ):
        r.fail(f"negative validate returned unexpected result: {negative}")
    error = errors[0]
    if (
        error.get("field") != "cabecera.importe_esperado"
        or Decimal(str(error.get("expected"))) != Decimal("79.90")
        or Decimal(str(error.get("received"))) != Decimal("79.91")
    ):
        r.fail(f"negative validate returned unexpected error: {error}")
    after_negative = r.snapshot()
    if after_negative != before_negative:
        r.fail("negative validate changed rows, counters or idempotency")
    r.emit(
        "NEGATIVE_VALIDATE",
        {
            "ok": False,
            "would_create": False,
            "request_id": r.REQUEST_NEGATIVE,
            "error": error,
            "business_unchanged": True,
            "counters_unchanged": True,
            "idempotency_unchanged": True,
        },
    )

    final = r.snapshot()
    rows_by_request = {
        row["request_id"]: row for row in final["idempotency"]["rows"]
    }
    if set(rows_by_request) != {r.REQUEST_A, r.REQUEST_B}:
        r.fail("final controlled idempotency set is not exact")
    if any(row["status"] != "completed" for row in rows_by_request.values()):
        r.fail("one final idempotency record is not completed")
    r.emit(
        "FINAL_RESULT",
        {
            "target_id": r.TARGET_ID,
            "dataset_epoch": r.DATASET_EPOCH,
            "cycle_a": {
                "albaran_id": a_id,
                "serie": a_get["albaran"]["AMA_serie"],
                "numero": int(a_get["albaran"]["AMA_numero"]),
                "provider_id": 209,
                "total": str(a_get["albaran"]["AMA_importe"]),
                "target_get_confirmed": True,
                "replay_previously_confirmed": True,
            },
            "cycle_b": r.summary(committed_b),
            "resume_table_counts_before": initial["business"]["counts"],
            "table_counts_after": final["business"]["counts"],
            "resume_table_delta": r.table_delta(
                initial["business"], final["business"]
            ),
            "resume_counter_delta": r.counter_delta(
                initial["business"], final["business"]
            ),
            "idempotency_rows": final["idempotency"]["rows"],
            "negative_no_state_change": True,
            "supabase_touched": False,
            "facturas_touched": False,
        },
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            f"OPERATOR_ERROR={type(error).__name__}: {error}",
            file=sys.stderr,
            flush=True,
        )
        raise
