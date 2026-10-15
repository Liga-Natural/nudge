import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "@/lib/parser";
import { instantToWall, wallToInstant } from "@/lib/time";

const NY = "America/New_York";
// Wednesday, Oct 14, 2026, 4:30 PM in New York
const NOW = wallToInstant({ y: 2026, m: 10, d: 14, h: 16, mi: 30 }, NY);
const parse = (text: string, lang: "en" | "es" | "auto" = "auto") => parseQuickAdd(text, { now: NOW, tz: NY, lang });
const wall = (d: Date | null) => (d ? instantToWall(d, NY) : null);

describe("the examples from the handoff", () => {
  it("pay phone bill friday 5pm $45", () => {
    const r = parse("pay phone bill friday 5pm $45");
    expect(r.title).toBe("Pay phone bill");
    expect(r.type).toBe("payment");
    expect(r.amountCents).toBe(4500);
    expect(wall(r.dueAt)).toMatchObject({ m: 10, d: 16, h: 17, mi: 0 });
    expect(r.allDay).toBe(false);
  });

  it("math homework due tuesday", () => {
    const r = parse("math homework due tuesday");
    expect(r.title).toBe("Math homework");
    expect(r.type).toBe("homework");
    expect(r.allDay).toBe(true);
    expect(wall(r.dueAt)).toMatchObject({ m: 10, d: 20, h: 23, mi: 59 });
  });

  it("rent every month on the 1st $900", () => {
    const r = parse("rent every month on the 1st $900");
    expect(r.title).toBe("Rent");
    expect(r.type).toBe("payment");
    expect(r.amountCents).toBe(90000);
    expect(r.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    expect(wall(r.dueAt)).toMatchObject({ m: 11, d: 1 });
  });

  it("dentist oct 28 3pm remind me 1 day before", () => {
    const r = parse("dentist oct 28 3pm remind me 1 day before");
    expect(r.title).toBe("Dentist");
    expect(r.type).toBe("event");
    expect(wall(r.dueAt)).toMatchObject({ m: 10, d: 28, h: 15, mi: 0 });
    expect(r.reminderOffsetMinutes).toBe(1440);
  });
});

describe("more everyday phrases", () => {
  it("no date gives a warning, not a guess", () => {
    const r = parse("buy a birthday gift");
    expect(r.dueAt).toBeNull();
    expect(r.warnings).toContain("no_date");
  });

  it("a time in the past is flagged", () => {
    const r = parse("call mom oct 1 9am");
    expect(r.warnings).toContain("past");
  });

  it("every monday and wednesday", () => {
    const r = parse("soccer practice every monday and wednesday 6pm");
    expect(r.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(wall(r.dueAt)).toMatchObject({ d: 14, h: 18 }); // today is Wednesday and 6 PM is still ahead
  });

  it("every 2 weeks", () => {
    expect(parse("water plants every 2 weeks").rrule).toBe("FREQ=WEEKLY;INTERVAL=2");
  });

  it("amounts with commas and words", () => {
    expect(parse("tuition 1,250.50 dollars friday").amountCents).toBe(125050);
  });

  it("a tracking number is pulled out of the title", () => {
    const r = parse("package 1Z999AA10123456784 arriving friday");
    expect(r.trackingNumber).toBe("1Z999AA10123456784");
    expect(r.title.toLowerCase()).not.toContain("1z999");
    expect(r.warnings).toContain("package_later");
  });
});

describe("Spanish", () => {
  it("pagar luz viernes 5pm $45", () => {
    const r = parse("pagar luz viernes 5pm $45", "es");
    expect(r.type).toBe("payment");
    expect(r.amountCents).toBe(4500);
    expect(wall(r.dueAt)).toMatchObject({ d: 16, h: 17 });
  });

  it("tarea de matemáticas para el martes", () => {
    const r = parse("tarea de matemáticas para el martes", "es");
    expect(r.type).toBe("homework");
    expect(wall(r.dueAt)).toMatchObject({ d: 20 });
  });

  it("renta cada mes el 1 $900", () => {
    const r = parse("renta cada mes el 1 $900", "es");
    expect(r.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    expect(r.amountCents).toBe(90000);
  });

  it("cita con el dentista 28 de octubre 3pm recuérdame 1 día antes", () => {
    const r = parse("cita con el dentista 28 de octubre 3pm recuérdame 1 día antes", "es");
    expect(r.type).toBe("event");
    expect(r.reminderOffsetMinutes).toBe(1440);
    expect(wall(r.dueAt)).toMatchObject({ m: 10, d: 28, h: 15 });
  });
});
