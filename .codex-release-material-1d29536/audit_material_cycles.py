from __future__ import annotations

import run_material_cycles as r


r.assert_gate()
state = r.snapshot()
controlled = {row["request_id"]: row for row in state["idempotency"]["rows"]}
if set(controlled) != {r.REQUEST_A, r.REQUEST_B}:
    r.fail("controlled idempotency rows are not exactly A and B")
if any(row["status"] != "completed" or row["phase"] != "commit" for row in controlled.values()):
    r.fail("a controlled request is not completed")
if state["business"]["references"] != {
    "T260806-MA-017-B": 1,
    "T260806-MA-209-A": 1,
}:
    r.fail("controlled references are not unique")
if state["business"]["markers"] != {
    f"NETAGRO-MA:{r.REQUEST_A}": 1,
    f"NETAGRO-MA:{r.REQUEST_B}": 1,
}:
    r.fail("controlled markers are not unique")
r.emit(
    "FINAL_READ_ONLY_AUDIT",
    {
        "gate": True,
        "target_id": r.TARGET_ID,
        "dataset_epoch": r.DATASET_EPOCH,
        "counts": state["business"]["counts"],
        "counters": r.counter_values(state["business"]),
        "references": state["business"]["references"],
        "markers": state["business"]["markers"],
        "controlled_idempotency": controlled,
        "negative_request_absent": r.REQUEST_NEGATIVE not in controlled,
    },
)
