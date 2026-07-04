import { google, type calendar_v3 } from "googleapis";

import type { CalendarService } from "../../domain/ports";
import type { CalendarEvent } from "../../domain/types";
import type { GoogleOAuthClient } from "./googleAuth";

// Adapter: creates events on Google Calendar via the Calendar API, reusing the
// shared OAuth client (the same consent that Gmail uses — the calendar.events
// scope is already in GOOGLE_SCOPES). No reminders are configured: the user
// opted out, so events are inserted with an empty overrides list.
export class GoogleCalendarService implements CalendarService {
  private readonly calendar: calendar_v3.Calendar;

  constructor(
    auth: GoogleOAuthClient,
    // Which calendar to write to; "primary" targets the account's main calendar.
    private readonly calendarId: string = "primary",
  ) {
    this.calendar = google.calendar({ version: "v3", auth });
  }

  async createEvent(event: CalendarEvent): Promise<{ id: string; htmlLink: string }> {
    const res = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary: event.title,
        description: event.description,
        start: { dateTime: event.startIso, timeZone: event.timeZone },
        end: { dateTime: event.endIso, timeZone: event.timeZone },
        // No reminders: the user opted out of appointment alerts.
        reminders: { useDefault: false, overrides: [] },
      },
    });

    const id = res.data.id;
    if (!id) throw new Error("Google Calendar did not return an event id");
    return { id, htmlLink: res.data.htmlLink ?? "" };
  }
}
