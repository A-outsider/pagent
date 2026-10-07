export const BOSS_SEND_INTERVAL_MS = 2_000;
export const BOSS_SEND_BATCH_LIMIT = 30;

export interface BossSendOutcome {
  /** verified confirms sending; skipped means no new send was needed or attempted. */
  status: 'verified' | 'skipped' | 'unverified' | 'error';
  detail?: string;
}

export interface BossSendQueueInput {
  recipientIds: readonly string[];
  send: (recipientId: string, signal: AbortSignal) => Promise<BossSendOutcome>;
  signal?: AbortSignal;
  onResult?: (result: BossSendOutcome & { recipientId: string }) => Promise<void>;
}

export interface BossSendQueueResult {
  status: 'completed' | 'stopped' | 'aborted';
  /** Every started callback is recorded, including skips and uncertain or failed attempts. */
  results: Array<BossSendOutcome & { recipientId: string }>;
  /** Only recipients whose callback has never started in this batch. */
  remainingRecipientIds: string[];
}

interface QueueClock {
  /** Monotonic milliseconds. */
  now: () => number;
  /** Resolve when the delay expires or the signal aborts. */
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function waitForTurn(turn: Promise<void>, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = () => {
      signal.removeEventListener('abort', finish);
      resolve(!signal.aborted);
    };
    if (signal.aborted) return finish();
    signal.addEventListener('abort', finish, { once: true });
    void turn.then(finish);
  });
}

/** Creates an isolated queue. Production callers should use runBossSendQueue. */
export function createBossSendQueue(clock: QueueClock = { now: () => performance.now(), sleep }) {
  let tail = Promise.resolve();
  let lastCompletedAt: number | undefined;

  return async function run({ recipientIds, send, onResult, signal = new AbortController().signal }: BossSendQueueInput): Promise<BossSendQueueResult> {
    const ids = [...recipientIds];
    if (ids.length > BOSS_SEND_BATCH_LIMIT) {
      throw new RangeError(`A send batch may contain at most ${BOSS_SEND_BATCH_LIMIT} recipients`);
    }
    if (ids.some((id) => typeof id !== 'string' || !id.trim() || id !== id.trim())) {
      throw new TypeError('Recipient IDs must be non-empty trimmed strings');
    }
    if (new Set(ids).size !== ids.length) {
      throw new TypeError('A send batch may not contain duplicate recipient IDs');
    }

    const results: BossSendQueueResult['results'] = [];
    const result = (status: BossSendQueueResult['status']): BossSendQueueResult => ({
      status,
      results,
      remainingRecipientIds: ids.slice(results.length),
    });
    if (!ids.length) return result(signal.aborted ? 'aborted' : 'completed');

    const previous = tail;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    // An aborted waiter can release its own gate without bypassing its predecessor.
    tail = previous.then(() => held);
    try {
      if (!await waitForTurn(previous, signal)) return result('aborted');
      for (const recipientId of ids) {
        while (!signal.aborted && lastCompletedAt !== undefined) {
          const remaining = BOSS_SEND_INTERVAL_MS - (clock.now() - lastCompletedAt);
          if (remaining <= 0) break;
          await clock.sleep(remaining, signal);
        }
        if (signal.aborted) return result('aborted');

        let outcome: BossSendOutcome;
        try {
          // Even on abort, await the callback before releasing the shared lock.
          outcome = await send(recipientId, signal);
          if (!outcome || !['verified', 'skipped', 'unverified', 'error'].includes(outcome.status)) {
            throw new TypeError('The send callback returned an invalid outcome');
          }
        } catch (error) {
          outcome = { status: 'error', detail: error instanceof Error ? error.message : String(error) };
        }
        // Preparation can delay dispatch, so space from completion, not callback start.
        lastCompletedAt = clock.now();
        results.push({ ...outcome, recipientId });
        await onResult?.({ ...outcome, recipientId });
        if (signal.aborted) return result('aborted');
        if (outcome.status !== 'verified' && outcome.status !== 'skipped') return result('stopped');
      }
      return result('completed');
    } finally {
      release();
    }
  };
}

/** Shared across calls in this runtime; route all pages through this background instance. */
export const runBossSendQueue = createBossSendQueue();
