type Cron = {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  dayOfMonthAny: boolean;
  dayOfWeekAny: boolean;
};

const minuteMs = 60_000;
const searchMinutes = 366 * 24 * 60;

export function cronError(expression: string): string {
  try {
    parseCron(expression);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Cron is invalid";
  }
}

export function latestCronSlot(expression: string, now: Date): Date | null {
  const cron = parseCron(expression);
  let cursor = truncateMinute(now);
  for (let step = 0; step < searchMinutes; step += 1) {
    if (cursor.getTime() <= now.getTime() && matches(cron, cursor)) {
      return cursor;
    }
    cursor = new Date(cursor.getTime() - minuteMs);
  }
  return null;
}

export function nextCronSlot(expression: string, after: Date): Date {
  const cron = parseCron(expression);
  let cursor = truncateMinute(after);
  if (cursor.getTime() <= after.getTime()) {
    cursor = new Date(cursor.getTime() + minuteMs);
  }
  for (let step = 0; step < searchMinutes; step += 1) {
    if (matches(cron, cursor)) {
      return cursor;
    }
    cursor = new Date(cursor.getTime() + minuteMs);
  }
  throw new Error("Cron has no upcoming run");
}

function truncateMinute(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()));
}

function parseCron(expression: string): Cron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("Cron must be five fields: minute hour day month weekday");
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    minute: parseField(minute ?? "", 0, 59),
    hour: parseField(hour ?? "", 0, 23),
    dayOfMonth: parseField(dayOfMonth ?? "", 1, 31),
    month: parseField(month ?? "", 1, 12),
    dayOfWeek: parseWeekday(dayOfWeek ?? ""),
    dayOfMonthAny: dayOfMonth === "*",
    dayOfWeekAny: dayOfWeek === "*",
  };
}

function parseWeekday(field: string): Set<number> {
  const values = parseField(field, 0, 7);
  if (values.has(7)) {
    values.delete(7);
    values.add(0);
  }
  return values;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  if (!field) {
    throw new Error("Cron has an empty field");
  }
  for (const part of field.split(",")) {
    const stepMatch = /^(\*|\d+-\d+)\/(\d+)$/.exec(part);
    const range = stepMatch ? stepMatch[1] ?? "*" : part;
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error("Cron step must be a positive whole number");
    }
    let start = min;
    let end = max;
    if (range !== "*") {
      const bounds = /^(\d+)-(\d+)$/.exec(range);
      const single = /^(\d+)$/.exec(range);
      if (bounds) {
        start = Number(bounds[1]);
        end = Number(bounds[2]);
      } else if (single && !stepMatch) {
        start = Number(single[1]);
        end = start;
      } else if (!single && !bounds) {
        throw new Error("Cron has an invalid field");
      }
    }
    if (start < min || end > max || start > end) {
      throw new Error("Cron field is outside its range");
    }
    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }
  if (values.size === 0) {
    throw new Error("Cron has an empty field");
  }
  return values;
}

function matches(cron: Cron, instant: Date): boolean {
  if (!cron.minute.has(instant.getUTCMinutes()) || !cron.hour.has(instant.getUTCHours()) || !cron.month.has(instant.getUTCMonth() + 1)) {
    return false;
  }
  const dayOfMonth = cron.dayOfMonth.has(instant.getUTCDate());
  const dayOfWeek = cron.dayOfWeek.has(instant.getUTCDay());
  if (cron.dayOfMonthAny && cron.dayOfWeekAny) {
    return true;
  }
  if (cron.dayOfMonthAny) {
    return dayOfWeek;
  }
  if (cron.dayOfWeekAny) {
    return dayOfMonth;
  }
  return dayOfMonth || dayOfWeek;
}
