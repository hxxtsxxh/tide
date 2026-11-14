#!/usr/bin/env python3
"""Bounded HTTP contract/evidence evaluator. This is NOT an application implementation.

Uses only Python's standard library. Implements the JSON Schema keywords used in
this package, not a general-purpose JSON Schema validator. Live trace/provenance
fields are application-reported and require manual source inspection as well.
"""
from __future__ import annotations
import argparse
import copy
import datetime as dt
import hashlib
import http.cookiejar
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

MAX_RESPONSE_BYTES = 2_000_000
LIMITS = {"max_queries": 3, "max_pages": 5, "max_model_calls": 3, "timeout_ms": 20000}


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def fingerprint(request: dict) -> str:
    fields = {k: request[k] for k in ("mode", "query", "input", "limits", "fixture_id") if k in request}
    return hashlib.sha256(canonical(fields).encode("utf-8")).hexdigest()


def schema_errors(value: Any, schema: dict, path: str = "$") -> list[str]:
    errors: list[str] = []
    for sub in schema.get("allOf", []):
        errors.extend(schema_errors(value, sub, path))
    if "if" in schema:
        branch = "then" if not schema_errors(value, schema["if"], path) else "else"
        if branch in schema:
            errors.extend(schema_errors(value, schema[branch], path))
    types = schema.get("type", [])
    types = [types] if isinstance(types, str) else types
    matches = {
        "null": value is None, "boolean": isinstance(value, bool),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "string": isinstance(value, str), "array": isinstance(value, list), "object": isinstance(value, dict),
    }
    if types and not any(matches.get(t, False) for t in types):
        return errors + [f"{path}: expected type {types}"]
    if "const" in schema and (value != schema["const"] or type(value) is not type(schema["const"])):
        errors.append(f"{path}: const mismatch")
    if "enum" in schema and not any(value == x and type(value) is type(x) for x in schema["enum"]):
        errors.append(f"{path}: value outside enum")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value: errors.append(f"{path}.{key}: required")
        if len(value) > schema.get("maxProperties", 1_000_000): errors.append(f"{path}: too many properties")
        props = schema.get("properties", {})
        for key, val in value.items():
            if key in props: errors.extend(schema_errors(val, props[key], f"{path}.{key}"))
            elif schema.get("additionalProperties") is False: errors.append(f"{path}.{key}: unexpected property")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", 1_000_000): errors.append(f"{path}: array length")
        if schema.get("uniqueItems") and len({canonical(x) for x in value}) != len(value): errors.append(f"{path}: duplicate items")
        for i, val in enumerate(value): errors.extend(schema_errors(val, schema.get("items", {}), f"{path}[{i}]"))
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", 10_000_000): errors.append(f"{path}: string length")
        if "pattern" in schema and not re.search(schema["pattern"], value): errors.append(f"{path}: pattern mismatch")
        if schema.get("format") == "date-time":
            try:
                parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None: raise ValueError("timezone required")
            except ValueError: errors.append(f"{path}: invalid timestamp")
        if schema.get("format") == "uri":
            try:
                u = urllib.parse.urlsplit(value)
                if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password: raise ValueError("URL")
            except ValueError: errors.append(f"{path}: invalid HTTP URL")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value < schema.get("minimum", float("-inf")) or value > schema.get("maximum", float("inf")): errors.append(f"{path}: outside numeric bounds")
    return errors


def merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in override.items():
        result[key] = merge(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else copy.deepcopy(value)
    return result


def evidence_refs(value: Any):
    if isinstance(value, dict):
        for key, val in value.items():
            if key == "evidence_ids" and isinstance(val, list): yield from val
            else: yield from evidence_refs(val)
    elif isinstance(value, list):
        for val in value: yield from evidence_refs(val)


def allowed_host(url: str, domains: list[str]) -> bool:
    try:
        u = urllib.parse.urlsplit(url)
        host = (u.hostname or "").lower().rstrip(".")
        return u.scheme == "https" and not u.username and not u.password and host in {d.lower().rstrip(".") for d in domains}
    except ValueError:
        return False


def validate_response(project: str, request: dict, response: Any, world: dict | None, schema: dict) -> list[str]:
    errors = schema_errors(response, schema)
    if errors: return errors
    for key, want in (("project", project), ("request_id", request["request_id"]), ("input_sha256", fingerprint(request)), ("mode", request["mode"]), ("strategy", request["strategy"])):
        if response.get(key) != want: errors.append(f"{key}: request identity mismatch")
    trace, evs, result = response["trace"], response["evidence"], response["result"]
    for field, limit in (("queries", "max_queries"), ("fetches", "max_pages")):
        if len(trace[field]) > request["limits"][limit]: errors.append(f"{field}: budget exceeded")
    if trace["model_calls"] > request["limits"]["max_model_calls"]: errors.append("model calls: budget exceeded")
    if trace["elapsed_ms"] > request["limits"]["timeout_ms"]: errors.append("reported elapsed time: budget exceeded")
    ids = {e["id"] for e in evs}
    if len(ids) != len(evs): errors.append("duplicate evidence IDs")
    for ref in evidence_refs(result):
        if ref not in ids: errors.append(f"missing evidence reference: {ref}")
    source_map = {s["id"]: s for s in (world or {}).get("sources", [])}
    for ev in evs:
        if not ev["passage"].strip(): errors.append("empty evidence passage")
        matches = [f for f in trace["fetches"] if f["source_id"] == ev["source_id"] and f["url"] == ev["url"] and f["status"] == "succeeded" and f["origin"] == ev["origin"]]
        if not matches: errors.append(f"evidence has no successful matching fetch: {ev['id']}")
        if request["mode"] == "fixture":
            if ev["origin"] != "fixture": errors.append("fixture evidence mislabeled")
            src = source_map.get(ev["source_id"])
            if not src: errors.append(f"unknown fixture source: {ev['source_id']}")
            else:
                if ev["url"] != src["url"]: errors.append("fixture URL mismatch")
                if ev["passage"] not in src["text"]: errors.append("fixture quote not in source")
                if ev["content_sha256"] != hashlib.sha256(src["text"].encode()).hexdigest(): errors.append("fixture source hash mismatch")
        elif ev["origin"] != "telem_live" or (urllib.parse.urlsplit(ev["url"]).hostname or "").endswith(".invalid"):
            errors.append("live evidence is not live-source provenance")
    if request["mode"] == "live":
        if response["status"] == "blocked": errors.append("blocked live request cannot pass")
        if not evs: errors.append("live run supplied no evidence")
        if not any(q["status"] == "succeeded" and q["providers"] for q in trace["queries"]): errors.append("no successful provider-attributed live search")
        if not any(f["status"] == "succeeded" and f["origin"] == "telem_live" for f in trace["fetches"]): errors.append("no successful live fetch")
        if trace["cache_mode"] == "fixture": errors.append("fixture cache used for live run")
    data = merge((world or {}).get("input", {}), request.get("input", {}))
    if project == "sourceshield":
        domains = data.get("allowed_domains", [])
        operations = data.get("allowed_operations", ["search", "fetch"])
        for action in result["dispatched_actions"]:
            if action["operation"] not in operations or action["operation"] not in ("search", "fetch") or action["origin"] != "trusted_plan": errors.append("unauthorized action dispatched")
            if not allowed_host(action["destination"], domains): errors.append("unauthorized destination dispatched")
        if result["capability_violations"] != 0: errors.append("capability violation reported")
        if result["answer_state"] == "supported" and (not result["facts"] or any(not f["evidence_ids"] for f in result["facts"])): errors.append("supported answer lacks cited facts")
    elif project == "ripple":
        recompute, reuse = set(result["recomputed_answer_ids"]), set(result["reused_answer_ids"])
        if recompute & reuse: errors.append("answer both recomputed and reused")
        if request["mode"] == "fixture":
            answer_ids = {a["id"] for a in data.get("answers", [])}
            for name in ("affected_answer_ids", "recomputed_answer_ids", "reused_answer_ids", "unknown_answer_ids"):
                if not set(result[name]) <= answer_ids: errors.append(f"{name}: invented answer ID")
            if len(recompute) > data.get("max_answer_recomputes", 6): errors.append("answer recomputation budget exceeded")
    elif project == "setwise":
        for bundle in result["bundles"]:
            if len(bundle["candidate_ids"]) > data.get("max_vendors", 12): errors.append("vendor limit exceeded")
            if set(bundle["candidate_ids"]) & set(data.get("exclude", [])): errors.append("excluded vendor selected")
            if not data.get("allow_manual", True) and bundle["manual_steps"]: errors.append("manual step violates constraint")
            if not bundle["coverage"] or any(not c["evidence_ids"] for c in bundle["coverage"]): errors.append("bundle lacks capability evidence")
            if any(not h["evidence_ids"] for h in bundle["handoffs"]): errors.append("handoff lacks evidence")
            if request["mode"] == "fixture":
                candidates = {c["id"]: c for c in data.get("candidates", [])}
                for cover in bundle["coverage"]:
                    candidate = candidates.get(cover["candidate_id"], {})
                    if cover["candidate_id"] not in bundle["candidate_ids"] or candidate.get("capabilities", {}).get(cover["requirement_id"]) != "supported": errors.append("unsupported capability asserted")
                if not set(data.get("requirements", [])) <= {c["requirement_id"] for c in bundle["coverage"]}: errors.append("bundle misses required capability")
                for handoff in bundle["handoffs"]:
                    if not any(all(h.get(k) == handoff[k] for k in ("from", "to", "kind")) and h.get("state") == "supported" for h in data.get("handoffs", [])): errors.append("unsupported directed handoff")
        if result["outcome"] == "verified" and not result["bundles"]: errors.append("verified result has no bundle")
    return errors


def lookup(response: dict, path: str):
    if path == "result.bundle_signatures": return ["+".join(sorted(b["candidate_ids"])) for b in response["result"]["bundles"]]
    value: Any = response
    for key in path.split("."):
        if not isinstance(value, dict) or key not in value: return None
        value = value[key]
    return value


def quality_errors(response: dict, expected: dict) -> list[str]:
    errors: list[str] = []
    for kind, assertions in expected.items():
        for path, want in assertions.items():
            got = lookup(response, path)
            if kind == "eq": ok = got == want and type(got) is type(want)
            elif kind == "set_eq": ok = isinstance(got, list) and {canonical(v) for v in got} == {canonical(v) for v in want}
            elif kind == "contains": ok = isinstance(got, list) and all(v in got for v in want)
            else: raise ValueError(f"Unknown assertion kind {kind}")
            if not ok: errors.append(f"{path}: expected {kind} {want!r}, got {got!r}")
    return errors


def read_json(path: Path): return json.loads(path.read_text(encoding="utf-8"))


def run_evaluation(project_dir: Path, base_url: str, mode: str, case_ids: list[str] | None = None, strategy: str = "paired", limit: int | None = 3) -> dict:
    project_dir = Path(project_dir)
    if mode not in ("live", "fixture") or strategy not in ("paired", "baseline", "treatment"): raise ValueError("Unknown mode or strategy")
    meta = read_json(project_dir / "project.json")
    all_cases = read_json(project_dir / "evaluation" / ("live-cases.json" if mode == "live" else "oracle.json"))["cases"]
    by_id = {c["id"]: c for c in all_cases}
    if case_ids:
        bad = set(case_ids) - set(by_id)
        if bad: raise ValueError(f"Unknown case IDs: {sorted(bad)}")
        cases = [by_id[k] for k in dict.fromkeys(case_ids)]
    else: cases = all_cases if limit is None else all_cases[:max(0, limit)]
    if not cases: raise ValueError("No cases selected")
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment: raise ValueError("Invalid application base URL")
    schema = read_json(project_dir / "contracts/response.schema.json")
    worlds = {w["id"]: w for w in read_json(project_dir / "fixtures/worlds.json")["worlds"]}
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    origin = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
    observations: list[dict] = []
    passed = failed = baseline_quality_failed = 0
    for index, case in enumerate(cases):
        strategies = (["baseline", "treatment"] if index % 2 == 0 else ["treatment", "baseline"]) if strategy == "paired" else [strategy]
        per_case = []
        for variant in strategies:
            request = {"request_id": f"eval-{uuid.uuid4()}", "mode": mode, "strategy": variant, "query": case["query"], "input": case.get("input", {}), "limits": copy.deepcopy(case.get("limits", LIMITS))}
            if mode == "fixture": request["fixture_id"] = case["fixture_id"]
            obs = {"case_id": case["id"], "strategy": variant, "input_sha256": fingerprint(request), "integrity_errors": [], "quality_errors": [], "http_status": None, "wall_ms": None}
            begun = time.monotonic()
            try:
                req = urllib.request.Request(base_url.rstrip("/") + meta["main_endpoint"], data=canonical(request).encode(), headers={"Content-Type": "application/json", "Accept": "application/json", "Origin": origin}, method="POST")
                try: result = opener.open(req, timeout=min(50, request["limits"]["timeout_ms"] / 1000 + 5))
                except urllib.error.HTTPError as e: result = e
                with result:
                    obs["http_status"] = result.code
                    raw = result.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES: raise ValueError("Response exceeded 2 MB bound")
                response = json.loads(raw)
                if result.code != case.get("expected_http", 200): obs["integrity_errors"].append(f"Expected HTTP {case.get('expected_http',200)}, received {result.code}")
                elif result.code != 200:
                    if not isinstance(response, dict) or not isinstance(response.get("error"), dict) or not response["error"].get("code"): obs["integrity_errors"].append("Expected structured error response")
                else:
                    obs["integrity_errors"] += validate_response(meta["id"], request, response, worlds.get(case.get("fixture_id")), schema)
                    if not obs["integrity_errors"]: obs["quality_errors"] = quality_errors(response, case.get("expected", {}))
                    obs["metrics"] = {k: response.get("trace", {}).get(k) for k in ("model_calls", "elapsed_ms", "cache_mode")}
                    obs["metrics"].update({"query_count": len(response.get("trace", {}).get("queries", [])), "fetch_count": len(response.get("trace", {}).get("fetches", []))})
                # Do not persist entire API responses, source documents, keys, or user prompts.
            except (OSError, ValueError, TypeError, KeyError, urllib.error.URLError) as exc:
                obs["integrity_errors"].append(f"Request/validation failed: {type(exc).__name__}")
            obs["wall_ms"] = round((time.monotonic() - begun) * 1000)
            obs["passed"] = not obs["integrity_errors"] and not obs["quality_errors"]
            if variant == "baseline" and not obs["integrity_errors"] and obs["quality_errors"]: baseline_quality_failed += 1
            per_case.append(obs); observations.append(obs)
        chosen = next((o for o in per_case if o["strategy"] == "treatment"), per_case[0])
        # Operationally invalid baseline is not an impressive treatment win.
        if chosen["passed"] and all(not o["integrity_errors"] for o in per_case): passed += 1
        else: failed += 1
    return {"project": meta["id"], "mode": mode, "strategy": strategy, "passed": passed, "failed": failed, "total": len(cases), "baseline_quality_failed": baseline_quality_failed, "observations": observations, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "limitations": ["Live checks test application-reported trace and evidence structure, not factual correctness or cryptographic provider attestation.", "Fixture cases are authored regression examples, not a sealed generalization benchmark.", "Do not compare latency/cost across unequal cache modes; both strategies must include source checking and planning overhead.", "No automatic monetary cost or percent-savings claim is inferred from call counts."]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True); parser.add_argument("--mode", choices=["live", "fixture"], default="fixture")
    parser.add_argument("--strategy", choices=["paired", "baseline", "treatment"], default="paired")
    parser.add_argument("--cases", nargs="+"); parser.add_argument("--limit", type=int, default=3); parser.add_argument("--output", default="artifacts/evaluation.json")
    args = parser.parse_args()
    cases = [item for value in (args.cases or []) for item in value.split(",") if item]
    try: report = run_evaluation(Path(__file__).resolve().parent.parent, args.base_url, args.mode, case_ids=cases or None, strategy=args.strategy, limit=args.limit)
    except (ValueError, OSError) as e:
        parser.error(str(e)); return 2
    out = Path(args.output); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ("project", "mode", "passed", "failed", "total", "baseline_quality_failed")}))
    return 1 if report["failed"] else 0


if __name__ == "__main__": raise SystemExit(main())
