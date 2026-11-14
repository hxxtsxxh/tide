# Request and evidence identity
Compute input_sha256 as SHA-256 of UTF-8 JSON containing exactly {mode, query, input, limits, fixture_id}, omitting fixture_id when absent. Use lexicographic recursive object-key sorting, compact separators (comma, colon), literal UTF-8 and standard JSON number forms. Exclude request_id and strategy so paired inputs have the same identity. No undefined/NaN/Infinity. This hash is not an authentication signature.

Every result evidence_id resolves to a returned evidence record. Fixture passages must be exact substrings of the supplied authored source text; content_sha256 hashes the exact UTF-8 text. Live sources carry actual observed fetched-text hashes. Quotes appearing in a page do not prove their claims true. fetched_at/retrieved_at is not the publication date or validity start.

For fixture mode, load source data from fixtures/worlds.json by fixture_id; deep-merge request.input over the world's input. For list values replace the entire list rather than merging indices. Both strategies operate on that same effective input. The evaluator's expected assertions are never sent to the app.
