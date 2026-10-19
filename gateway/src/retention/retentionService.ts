import type { Store } from "../store/repositories.js";

export type RetentionConfig = {
  conversationDays: number;
  leadMonths: number;
  intervalMs: number;
};

function parsePositiveInt(value: string | undefined, name: string): number {
  if (value === undefined) {
    throw new Error(`${name} is undefined`);
  }
  if (value.trim() === "") {
    throw new Error(`${name} is empty string`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

export function parseRetentionConfig(env: Record<string, string | undefined>): RetentionConfig {
  const conversationDaysRaw = env.CONVERSATION_RETENTION_DAYS ?? "90";
  const leadMonthsRaw = env.LEAD_RETENTION_MONTHS ?? "12";
  const intervalMsRaw = env.RETENTION_INTERVAL_MS ?? "3600000";

  const conversationDays = parsePositiveInt(conversationDaysRaw, "CONVERSATION_RETENTION_DAYS");
  const leadMonths = parsePositiveInt(leadMonthsRaw, "LEAD_RETENTION_MONTHS");
  const intervalMs = parsePositiveInt(intervalMsRaw, "RETENTION_INTERVAL_MS");

  return { conversationDays, leadMonths, intervalMs };
}

// Subtract months from date in UTC, clamp day to last day of target month if needed
export function subtractMonthsUtc(date: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 0) {
    throw new Error("months must be a non-negative integer");
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  let targetYear = year;
  let targetMonth = month - months;
  while (targetMonth < 0) {
    targetMonth += 12;
    targetYear -= 1;
  }

  // Get last day of target month
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  const targetDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(Date.UTC(targetYear, targetMonth, targetDay, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

export async function runRetention(
  store: Store,
  config: Pick<RetentionConfig, "conversationDays" | "leadMonths">,
  now: Date
): Promise<{
  conversationsPurged: number;
  leadsPurged: number;
  conversationCutoff: Date;
  leadCutoff: Date;
}> {
  const conversationCutoff = new Date(now.getTime() - config.conversationDays * 86400000);
  const leadCutoff = subtractMonthsUtc(now, config.leadMonths);

  const conversationsPurged = await store.retention.purgeConversationsBefore(conversationCutoff);
  const leadsPurged = await store.retention.purgeLeadsBefore(leadCutoff);

  return { conversationsPurged, leadsPurged, conversationCutoff, leadCutoff };
}

export function startRetentionScheduler(
  store: Store,
  config: RetentionConfig,
  deps?: {
    now?: () => Date;
    onResult?: (result: {
      conversationsPurged: number;
      leadsPurged: number;
      conversationCutoff: Date;
      leadCutoff: Date;
    }) => void;
    onError?: (error: unknown) => void;
    setIntervalFn?: (callback: () => void, ms: number) => unknown;
    clearIntervalFn?: (handle: unknown) => void;
  }
): { stop: () => void } {
  const nowFn = deps?.now ?? (() => new Date());
  const onResult = deps?.onResult ?? (() => {});
  const onError = deps?.onError ?? (() => {});
  const setIntervalFn = deps?.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
  const clearIntervalFn = deps?.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));

  let running = false;
  let timer: unknown = null;

  async function runOnce() {
    if (running) {
      // Skip if previous run not finished
      return;
    }
    running = true;
    try {
      const result = await runRetention(store, { conversationDays: config.conversationDays, leadMonths: config.leadMonths }, nowFn());
      onResult(result);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }

  runOnce();

  timer = setIntervalFn(() => {
    runOnce();
  }, config.intervalMs);

  if (typeof timer === "object" && timer !== null && "unref" in timer && typeof (timer as { unref: unknown }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }

  return {
    stop() {
      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
    },
  };
}
