// src/sdk/redact.ts

type AnyRecord = Record<string, unknown>;

export const REDACTED = '[REDACTED]';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function redactFields(fields: unknown[]): unknown[] {
  return fields.map((f) => {
    if (!f || typeof f !== 'object') return f;
    const rec = { ...(f as AnyRecord) };
    const name = typeof rec.name === 'string' ? rec.name : '';
    const hidden = rec.hidden === true || rec.type === 1;

    // Always redact the SSH private key field, even if hidden is false.
    const force = name === 'private_key';

    if ((hidden || force) && typeof rec.value === 'string') {
      rec.value = REDACTED;
    }
    return rec;
  });
}

export function redactItem(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item;
  const clone = deepClone(item as AnyRecord);

  // login.password / login.totp
  if (clone.login && typeof clone.login === 'object') {
    const login = clone.login as AnyRecord;
    if (typeof login.password === 'string') login.password = REDACTED;
    if (typeof login.totp === 'string') login.totp = REDACTED;
  }

  // passwordHistory[].password
  if (Array.isArray(clone.passwordHistory)) {
    clone.passwordHistory = clone.passwordHistory.map((h) => {
      if (!h || typeof h !== 'object') return h;
      const rec = { ...(h as AnyRecord) };
      if (typeof rec.password === 'string') rec.password = REDACTED;
      return rec;
    });
  }

  // card.number / card.code
  if (clone.card && typeof clone.card === 'object') {
    const card = clone.card as AnyRecord;
    if (typeof card.number === 'string') card.number = REDACTED;
    if (typeof card.code === 'string') card.code = REDACTED;
  }

  // identity fields that are typically sensitive
  if (clone.identity && typeof clone.identity === 'object') {
    const identity = clone.identity as AnyRecord;
    for (const k of ['ssn', 'passportNumber', 'licenseNumber']) {
      if (typeof identity[k] === 'string') identity[k] = REDACTED;
    }
  }

  // top-level fields
  if (Array.isArray(clone.fields)) {
    clone.fields = redactFields(clone.fields);
  }

  // attachments often include a signed download URL token; redact it by default.
  if (Array.isArray(clone.attachments)) {
    clone.attachments = clone.attachments.map((a) => {
      if (!a || typeof a !== 'object') return a;
      const rec = { ...(a as AnyRecord) };
      if (typeof rec.url === 'string') rec.url = REDACTED;
      return rec;
    });
  }

  return clone;
}
