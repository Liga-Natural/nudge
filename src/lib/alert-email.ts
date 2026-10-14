import nodemailer from "nodemailer";

// Emails the owner when something important breaks (uses the same Gmail SMTP as login).
// Push cannot be used for this: the phones' push addresses live in the database that may be down.
export async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.ALERT_EMAIL || process.env.OWNER_EMAIL;
  if (!host || !user || !pass || !to) {
    console.error("alert email not configured; would have sent:", subject);
    return false;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 8000,
      socketTimeout: 8000,
    });
    await transport.sendMail({ from: process.env.SMTP_FROM || user, to, subject, text });
    return true;
  } catch (e) {
    console.error("alert email failed:", e instanceof Error ? e.message : e);
    return false;
  }
}
