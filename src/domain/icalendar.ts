// Minimal, pure iCalendar (RFC 5545) helpers. Used to turn a forwarded
// appointment-confirmation email's .ics attachment into a calendar event.
// Zero external deps so it lives in the domain and any layer can route on it.
// Scope is deliberately small: parse VEVENT summary/start/end for the common
// "cita confirmada" case, skipping cancellations. Recurrence, attendees and
// exotic timezone rules are out of scope.

export interface ParsedIcsEvent {
  title: string; // SUMMARY (may be empty; caller can fall back to the subject)
  startIso: string; // ISO 8601 (with "Z" for UTC, else local + timeZone)
  endIso: string; // DTEND, or start + 1h when the invite omits it
  description?: string;
  location?: string;
  timeZone: string; // TZID of the event, or the provided default
}

// Detects an iCalendar payload by its "BEGIN:VCALENDAR" preamble. ICS is text
// (UTF-8/ASCII), so we sniff the first bytes and tolerate a leading BOM.
export function isIcsBuffer(buffer: Buffer): boolean {
  if (buffer.length < 15) return false;
  const head = buffer.toString("utf8", 0, 256).replace(/^\uFEFF/, "").trimStart();
  return /^BEGIN:VCALENDAR/i.test(head);
}

// Parses every non-cancelled VEVENT out of an iCalendar text. Dates are
// resolved as follows:
//   - "...Z"     → kept as UTC ("...Z"), displayed in `defaultTimeZone`.
//   - TZID param → local time string + that TZID as the event timeZone.
//   - floating   → local time string + `defaultTimeZone`.
//   - VALUE=DATE → all-day, emitted at 00:00 in `defaultTimeZone`.
// Cancellations (METHOD:CANCEL or STATUS:CANCELLED) are skipped so a
// "cita cancelada" mail never creates a ghost event.
export function parseIcsEvents(
  text: string,
  defaultTimeZone: string,
): ParsedIcsEvent[] {
  // RFC 5545 line folding: a CRLF followed by a space/tab continues the line.
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  let method = "";
  const events: ParsedIcsEvent[] = [];
  let cur:
    | {
        summary?: string;
        description?: string;
        location?: string;
        status?: string;
        start?: { iso: string; timeZone: string };
        end?: { iso: string; timeZone: string };
      }
    | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.toUpperCase() === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line.toUpperCase() === "END:VEVENT") {
      if (cur) {
        const cancelled =
          method.toUpperCase() === "CANCEL" ||
          (cur.status ?? "").toUpperCase() === "CANCELLED";
        if (!cancelled && cur.start) {
          const startIso = cur.start.iso;
          const timeZone = cur.start.timeZone;
          const endIso = cur.end?.iso ?? defaultEnd(startIso);
          events.push({
            title: cur.summary ?? "",
            startIso,
            endIso,
            description: cur.description,
            location: cur.location,
            timeZone,
          });
        }
      }
      cur = null;
      continue;
    }

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = left.split(";");
    const propName = (name ?? "").toUpperCase();
    const params = parseParams(paramParts);

    if (!cur) {
      // Top-level property (before/after any VEVENT).
      if (propName === "METHOD") method = value.trim();
      continue;
    }

    switch (propName) {
      case "SUMMARY":
        cur.summary = unescapeText(value);
        break;
      case "DESCRIPTION":
        cur.description = unescapeText(value);
        break;
      case "LOCATION":
        cur.location = unescapeText(value);
        break;
      case "STATUS":
        cur.status = value.trim();
        break;
      case "DTSTART":
        cur.start = parseIcsDate(value.trim(), params, defaultTimeZone) ?? cur.start;
        break;
      case "DTEND":
        cur.end = parseIcsDate(value.trim(), params, defaultTimeZone) ?? cur.end;
        break;
    }
  }

  return events;
}

function parseParams(parts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    out[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return out;
}

// Converts an iCalendar date/date-time value into an ISO 8601 string plus the
// timeZone Google should interpret it in. Returns null on malformed input.
function parseIcsDate(
  value: string,
  params: Record<string, string>,
  defaultTimeZone: string,
): { iso: string; timeZone: string } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  const time = hh ? `${hh}:${mi}:${ss}` : "00:00:00";
  if (z) {
    // UTC instant; display it in the patient's zone.
    return { iso: `${y}-${mo}-${d}T${time}Z`, timeZone: defaultTimeZone };
  }
  const tzid = params.TZID;
  return {
    iso: `${y}-${mo}-${d}T${time}`,
    timeZone: tzid && tzid.length > 0 ? tzid : defaultTimeZone,
  };
}

// Default a missing DTEND to one hour after the start.
function defaultEnd(startIso: string): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return startIso;
  return new Date(start.getTime() + 60 * 60 * 1000).toISOString();
}

// Unescapes RFC 5545 TEXT values (\\n, \\,, \\;, \\\\).
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}
