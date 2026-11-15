const SECRET_KEY = /(^|[-_])(authorization|api[-_]?key|token|secret|password|x[-_]?api[-_]?key|signature|credential)($|[-_])/i;
const BINARY_KEY = /^(?:b64_json|base64|inlineData|inline_data)$/i;

function redactKnown(value: string, secrets: readonly string[]): string {
  for (const secret of secrets) {
    if (!secret) continue;
    value = value.split(secret).join("[REDACTED]");
    value = value.split(encodeURIComponent(secret)).join("[REDACTED]");
  }
  return value;
}

function sanitizeString(value: string, secrets: readonly string[]): string {
  if (/^data:[^;,]+;base64,/i.test(value)) return `[BASE64_DATA_OMITTED length=${value.length}]`;
  const redactUrl = (raw: string): string => {
    try {
      const parsed = new URL(raw);
      parsed.username = "";
      parsed.password = "";
      for (const key of [...parsed.searchParams.keys()]) {
        if (SECRET_KEY.test(key) || /^(?:key|sig|access_token)$/i.test(key)) parsed.searchParams.set(key, "[REDACTED]");
      }
      return parsed.toString();
    } catch { return raw; }
  };
  value = value.replace(/https?:\/\/[^\s<>"']+/gi, redactUrl);
  value = value.replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]");
  return redactKnown(value, secrets);
}

export function sanitize(value: unknown, secrets: readonly string[] = [], seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return sanitizeString(value, secrets);
  if (value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return `[BINARY_OMITTED bytes=${value.byteLength}]`;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const safeKey = sanitizeString(key, secrets);
    output[safeKey] = SECRET_KEY.test(key) ? "[REDACTED]" : BINARY_KEY.test(key) ? "[BINARY_OMITTED]" : sanitize(item, secrets, seen);
  }
  return output;
}
