/** Collapse event bursts, never overlap refreshes, retain one trailing invalidation. */
export function refreshQueue(run: () => Promise<unknown> | unknown, delay = 500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, pending = false, stopped = false, paused = false;
  function schedule() {
    if (stopped || paused || running || timer || !pending) return;
    timer = setTimeout(async () => {
      timer = undefined;
      if (stopped || paused) return;
      pending = false; running = true;
      try { await run(); } catch { /* consumers report their own read errors */ }
      finally { running = false; schedule(); }
    }, delay);
  }
  return {
    request() { if (!stopped) { pending = true; schedule(); } },
    pause(value: boolean) { paused = value; schedule(); },
    stop() { stopped = true; pending = false; clearTimeout(timer); },
  };
}
