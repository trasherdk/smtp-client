/// <reference types="node" />

import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";
import dotenv from "dotenv";
import { describe, it } from "vitest";
import { SMTPClient } from "../src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(packageRoot, ".env") });

const mailHost = process.env.MAIL_HOST?.trim();
const mailFrom = process.env.MAIL_FROM?.trim();
const mailTo = process.env.MAIL_TO?.trim();
const mailPort = process.env.MAIL_PORT ? Number(process.env.MAIL_PORT) : 25;

function domainFromAddress(addr: string): string | null {
  const i = addr.lastIndexOf("@");
  if (i < 0 || i >= addr.length - 1) return null;
  const d = addr.slice(i + 1).trim();
  return d.length ? d : null;
}

/**
 * EHLO is the *client* identity, not MAIL_HOST. Default: domain of MAIL_FROM (SPF alignment).
 * MAIL_EHLO_HOST overrides.
 */
function clientEhloHostname(): string {
  const explicit = process.env.MAIL_EHLO_HOST?.trim();
  if (explicit) return explicit;
  if (mailFrom) {
    const d = domainFromAddress(mailFrom);
    if (d) return d;
  }
  let h = os.hostname() ?? "";
  if (h.indexOf(".") < 0) {
    h = "[127.0.0.1]";
  } else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
    h = `[${h}]`;
  }
  return h || "localhost";
}

const mailEhloHost = clientEhloHostname();

function liveTestMessageBody(): string {
  const date = new Date().toUTCString();
  const headers = [
    `From: <${mailFrom}>`,
    `To: <${mailTo}>`,
    `Date: ${date}`,
    `Subject: smtp-client live test`,
  ].join("\r\n");
  return `${headers}\r\n\r\nSent at ${new Date().toISOString()}\r\n`;
}
const startTls =
  process.env.MAIL_STARTTLS === "1" || process.env.MAIL_STARTTLS === "true";
const implicitTls =
  process.env.MAIL_SECURE === "1" || process.env.MAIL_SECURE === "true";
const tlsInsecure =
  process.env.MAIL_TLS_INSECURE === "1" ||
  process.env.MAIL_TLS_INSECURE === "true";
const rejectUnauthorized = tlsInsecure ? false : undefined;

const tlsCaPath =
  process.env.SMTP_TLS_CA?.trim() || process.env.SMTP_TLS_CERT;
const tlsCa =
  tlsCaPath && fs.existsSync(tlsCaPath)
    ? fs.readFileSync(tlsCaPath)
    : undefined;

const mailTlsServername = process.env.MAIL_TLS_SERVERNAME?.trim();

const tlsOpts = {
  ...(tlsCa !== undefined ? { ca: tlsCa } : {}),
  ...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
  ...(mailTlsServername ? { servername: mailTlsServername } : {}),
};

const hasLiveConfig = Boolean(mailHost && mailFrom && mailTo);

describe.skipIf(!hasLiveConfig)("live mail server (MAIL_HOST, MAIL_FROM, MAIL_TO)", () => {
  it(`sends a minimal message via SMTPClient to ${mailHost}`, async () => {
    const c = new SMTPClient({
      host: mailHost!,
      port: mailPort,
      secure: implicitTls,
      timeout: 60_000,
      ...tlsOpts,
    });

    const t = 60_000;
    const dataT = 120_000;

    try {
      await c.connect({ timeout: t });
      await c.greet({ hostname: mailEhloHost, timeout: t });

      if (startTls) {
        await c.secure({ timeout: t, ...tlsOpts });
        await c.greet({ hostname: mailEhloHost, timeout: t });
      }

      await c.mail({ from: mailFrom!, timeout: t });
      await c.rcpt({ to: mailTo!, timeout: t });

      await c.data(liveTestMessageBody(), { timeout: dataT });

      await c.quit({ timeout: t });
    } finally {
      await c.close({ timeout: t }).catch(() => {});
    }
  });
});
