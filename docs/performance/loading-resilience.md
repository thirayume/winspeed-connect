# Loading and unsaved-edit resilience

## Scope

This change addresses blocking network feedback, edits overwritten by background refreshes,
and redundant read load. It does not change document approval rules, SQL privileges,
native writers, database targets, or database schemas.

## Confirmed failure paths

1. The shared API helper displayed a full-screen pointer-blocking overlay for almost every request.
2. A sales event refreshed the order list; that refreshed the active trip object. The sales editor
   initialization effect depended on that object and replaced all unsaved fields.
3. Warehouse refresh temporarily removed PickingQueue from the React tree, losing the state of
   its open weighing/loading editor.
4. Socket callbacks and five-second backend polling could start more reads while earlier reads
   were still running. Dashboard cache misses were not coalesced.
5. Cold-session profile lookup failures logged the user out even for temporary connectivity errors.
   An old request's 401 could also clear a newer login.
6. Trip setup closed without a discard warning and could adopt a refreshed revision while the
   user was still editing an older snapshot. It now retains the opening revision, guards close
   and navigation, freezes only its own controls while saving, and retains values on conflict.

## Resulting behavior

- A delayed, nonblocking activity badge replaces the overlay. Fast requests do not flash it;
  long requests explain that the user should wait for the result before submitting again.
- Sales, quotation, user, profile and weighing editors pause their own controls during a save;
  background reads remain nonblocking. Failed saves retain the inputs for review.
- Sales initialization follows opening/changing the document, not trip refreshes. Late initial
  responses are discarded after the editor is disposed.
- Warehouse editors remain mounted during refresh, including when their list becomes empty.
- Sales, quotations, user/profile edits and weighing/loading edits register unsaved changes for portal
  navigation, logout, Access As, database switching and browser unload. These guards are not
  durable draft storage, and browser crashes or a genuinely revoked session can still lose work.
  No password, reset output or business draft is copied to browser storage by the guards.
- A delayed initial profile read cannot overwrite details already being edited, and responses
  from a disposed profile or previous login are ignored.
- Quotation expiry-only edits also register as unsaved changes. Ops labels the WinSpeed
  weighing source explicitly; this is not proof of a connected physical scale.
- Identical concurrent GETs coalesce within the same token, database header, options and write
  generation. Results are independently cloned. Writes never coalesce or retry automatically.
  GET timeout is 60 seconds and mutation timeout is 120 seconds; a mutation timeout explicitly
  means the commit outcome is unknown. The operator must check the document before retrying.
- Realtime invalidations batch for 0.5–1 seconds, serialize, retain one trailing refresh and
  pause in hidden tabs. Backend polling skips rounds while its previous queries are unfinished.
- Dashboard stats and aging reads use bounded caches keyed by database target, database name
  and the resolved visibility scope. Cold reads coalesce. Existing five-minute TTL for global
  summaries is retained; scoped summaries use 30 seconds. Explicit refresh bypasses completed
  cache entries. Authorization and visibility are still evaluated for each request.
- Sales list pagination reads the filtered total with `COUNT_BIG(*) OVER()` in the same query
  as its rows. Empty first pages need no second scan; out-of-range later pages use the existing
  count query. Visibility, legacy cut-off, native document de-duplication and redaction stay
  unchanged. There is no new shared cache or persistent SQL object.
- Ops status exposes bounded latency histograms, active/peak HTTP requests and SQL wrapper
  timings without SQL text/parameters. P95 is a bucket upper bound, not an exact percentile.
  DB query timing includes waiting for a connection; direct transaction queries are outside
  these wrapper timings. Metrics reset when the backend restarts.

## Verification

Run from the repository root:

    npm test --prefix backend
    npm run build --prefix WSSale-App
    npm run test:resilience

Browser tests use fixture accounts and intercepted APIs only; they do not create documents
in a business database.

The regression suite covers retained sales/warehouse inputs, continued typing during slow
reads, navigation/close cancellation, read coalescing, token separation, late 401, transient
profile errors, timeout cleanup, no automatic write retry, hidden tabs and event serialization.
Trip tests additionally cover parent refresh, stale-revision conflicts, cancellation and reopening.
Backend tests exercise the actual stats/aging routers through HTTP with a recording DB stub:
12 simultaneous cold requests per endpoint/database execute one endpoint data query; the UAT
fixture never receives the production fixture. A separate 30-caller test checks coalescing,
rejection recovery and invalidation during an in-flight read.

These tests establish behavior under controlled latency/concurrency. They are not production
capacity measurements or proof that every SQL query meets a response-time objective.

## Operational validation

1. Record release SHA and database identity; keep UAT and production evidence separate.
2. With three or more UAT users, leave different edits open while another user changes a
   document. Confirm refreshes preserve fields and do not interrupt typing.
3. Record API P95/maximum/slow counts, active requests, SQL waits/blocking, CPU/memory,
   dataset size, duration and error rate during the same interval.
4. Increase read concurrency gradually on UAT, not on production. Do not repeatedly submit
   mutations as a load test.
5. Use execution-plan and wait evidence before changing indexes, pool sizes or SQL memory.
   Do not treat accumulated wait statistics or an idle snapshot as evidence of peak load.
6. Verify direct business operations, authorization and target pins before promotion.
   No migration is required for this patch.
