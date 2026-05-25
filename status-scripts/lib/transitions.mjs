// Apply per-(model, check) transition rules when merging a fresh check result
// into the prior snapshot. Returns the merged CheckResultDetail-shaped object
// with `since_*` and `last_passed_*` fields updated.
//
// Only `pass` and {`fail`,`error`} count as concrete signals. `unknown` and
// `skipped` mean "no signal" and never trigger a transition — they preserve
// whatever bookkeeping the prior snapshot had.
//
// Transition table (signals only):
//   pass    -> failing : set since_* = current; copy last_passed_* from prior
//                        snapshot's master_sha/generated_at.
//   failing -> pass    : clear since_*; set last_passed_* = current.
//   unchanged signal   : carry since_* and last_passed_* forward.
//   no prior           : on pass set last_passed_* = current; on failing set
//                        since_* = current; on unknown/skipped set neither.
//   any -> unknown     : carry prior since_* and last_passed_* forward.
//   any -> skipped     : carry prior since_* and last_passed_* forward.

const SIGNAL = {
  pass: "pass",
  fail: "failing",
  error: "failing",
  unknown: "none",
  skipped: "none",
};

export function mergeCheckResult(
  prior, // CheckResultDetail | undefined — the previous snapshot's record
  fresh, // partial: { id, kind, label, status, ran_at, duration_ms?, error_message?, violations }
  current, // { sha, isoDate } — for the snapshot we are writing now
  priorSnapshot, // { sha, isoDate } — for the previous snapshot, used when prior was passing
) {
  const merged = {
    id: fresh.id,
    kind: fresh.kind,
    label: fresh.label,
    severity: fresh.severity,
    pass_label: fresh.pass_label,
    fail_label: fresh.fail_label,
    unknown_label: fresh.unknown_label,
    status: fresh.status,
    ran_at: fresh.ran_at,
    duration_ms: fresh.duration_ms,
    error_message: fresh.error_message,
    violations: fresh.violations ?? [],
  };

  const freshSig = SIGNAL[fresh.status] ?? "none";
  const priorSig = prior ? SIGNAL[prior.status] ?? "none" : undefined;

  // No prior record: seed bookkeeping based on the fresh signal only.
  if (!prior) {
    if (freshSig === "pass") {
      merged.last_passed_commit = current.sha;
      merged.last_passed_date = current.isoDate;
    } else if (freshSig === "failing") {
      merged.since_commit = current.sha;
      merged.since_date = current.isoDate;
    }
    // freshSig === "none" → leave both unset.
    return merged;
  }

  // Fresh has no signal (unknown/skipped): preserve prior bookkeeping verbatim.
  if (freshSig === "none") {
    merged.since_commit = prior.since_commit;
    merged.since_date = prior.since_date;
    merged.last_passed_commit = prior.last_passed_commit;
    merged.last_passed_date = prior.last_passed_date;
    return merged;
  }

  // Both prior and fresh have signals — apply the transition table.
  if (priorSig === "pass" && freshSig === "failing") {
    merged.since_commit = current.sha;
    merged.since_date = current.isoDate;
    merged.last_passed_commit = priorSnapshot.sha;
    merged.last_passed_date = priorSnapshot.isoDate;
  } else if (priorSig === "failing" && freshSig === "pass") {
    merged.last_passed_commit = current.sha;
    merged.last_passed_date = current.isoDate;
    // since_* cleared by omission
  } else if (priorSig === "none") {
    // Prior was unknown/skipped — treat like first observation of this signal.
    if (freshSig === "pass") {
      merged.last_passed_commit = current.sha;
      merged.last_passed_date = current.isoDate;
      // Carry any older last_passed forward only if newer is somehow older —
      // simpler: trust current as the most recent pass.
    } else {
      // failing — set since_* = current, carry forward last_passed_* if any.
      merged.since_commit = current.sha;
      merged.since_date = current.isoDate;
      merged.last_passed_commit = prior.last_passed_commit;
      merged.last_passed_date = prior.last_passed_date;
    }
  } else {
    // Same signal as before — carry bookkeeping forward.
    merged.since_commit = prior.since_commit;
    merged.since_date = prior.since_date;
    merged.last_passed_commit = prior.last_passed_commit;
    merged.last_passed_date = prior.last_passed_date;
  }

  return merged;
}

// Severity ordering for the model's `overall` rollup.
//   error > fail > unknown > pass > skipped
// `unknown` is above `pass` because a model with any unknown check should NOT
// roll up to "pass" — that would assert a clean bill of health we can't
// substantiate. `unknown` is below `fail`/`error` because those are concrete
// signals; `unknown` is the absence of one.
const ORDER = { error: 5, fail: 4, unknown: 3, pass: 2, skipped: 1 };

// `severity: "info"` checks are categorical — their states are categories
// (e.g. GPAD-compatible / causal-model), not verdicts. They're skipped from
// the rollup and from fail_count so a perfectly-good causal model doesn't
// look failing just because it doesn't fit GPAD.
function isCategorical(check) {
  return check.severity === "info";
}

export function summarizeOverall(checks) {
  let overall = "skipped";
  let failCount = 0;
  for (const c of checks) {
    if (isCategorical(c)) {
      continue;
    }
    if ((ORDER[c.status] ?? 0) > (ORDER[overall] ?? 0)) {
      overall = c.status;
    }
    if (c.status === "fail" || c.status === "error") {
      failCount++;
    }
  }
  return { overall, failCount };
}
