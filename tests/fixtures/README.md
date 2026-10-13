# Accepted migration baselines

Captured from the Swift implementation at commit `19d89be`, after verifying agreement with the Rust store. These files contain synthetic test graphs, not user projects.

- `store-scenarios.json`: normalized outputs of the 42 operations in `tests/store-scenarios.cjs`. Absolute paths, formatting-dependent revisions, commit identifiers, commit contents and error wording are excluded; history counts remain.
- `legacy-fingerprints.json`: node and edge fingerprints for the two shipped samples with Unicode and escaping cases added by `tests/tauri-compat.cjs`.

Do not regenerate these fixtures from the implementation under test. Review expected changes alongside deliberate schema or behaviour changes.
