/// <reference types="node" />

/**
 * Integration send — not run by `pnpm test`. Run with `pnpm test:live` + `.env`.
 * Relay: MAIL_HOST, MAIL_FROM, MAIL_TO (mailbox on your server).
 * Direct MX: MAIL_FROM + MAIL_TO_MX (any external inbox).
 * MX is resolved from MAIL_TO_MX’s domain; STARTTLS when advertised.
 * TLS: `servername` defaults to the connected host (override with MAIL_TLS_SERVERNAME).
 * SMTP_TLS_CA is merged with Node’s default roots so a relay self-signed CA does not break public MX verification.
 * If verify still fails: MAIL_TLS_INSECURE=1 (tests only), NODE_EXTRA_CA_CERTS, or fix OS CA bundle.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";
import tls from "node:tls";
import { resolveMx } from "node:dns/promises";
import dotenv from "dotenv";
import { describe, it } from "vitest";
import { SMTPClient } from "../src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(packageRoot, ".env") });

const mailFrom = process.env.MAIL_FROM?.trim();
const mailTo = process.env.MAIL_TO?.trim();
const mailToMx = process.env.MAIL_TO_MX?.trim();
const mailHost = process.env.MAIL_HOST?.trim();

const relayPort = process.env.MAIL_PORT ? Number(process.env.MAIL_PORT) : 587;
const implicitTlsRelay =
  relayPort === 465 ||
  process.env.MAIL_SECURE === "1" ||
  process.env.MAIL_SECURE === "true";

const MX_PORT = 25;

function domainFromAddress (addr: string): string | null {
  const i = addr.lastIndexOf("@");
  if (i < 0 || i >= addr.length - 1) return null;
  const d = addr.slice(i + 1).trim();
  return d.length ? d : null;
}

function clientEhloHostname (): string {
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

function messageBody (subject: string, to: string): string {
  const date = new Date().toUTCString();
  const headers = [
    `From: <${mailFrom}>`,
    `To: <${to}>`,
    `Date: ${date}`,
    `Subject: ${subject}`,
  ].join("\r\n");
  return `${headers}\r\n\r\nSent at ${new Date().toISOString()}\r\n`;
}

const tlsInsecure =
  process.env.MAIL_TLS_INSECURE === "1" ||
  process.env.MAIL_TLS_INSECURE === "true";
const rejectUnauthorized = tlsInsecure ? false : undefined;

const tlsCaPath =
  process.env.SMTP_TLS_CA?.trim() || process.env.SMTP_TLS_CERT;
const tlsCaExtraPem =
  tlsCaPath && fs.existsSync(tlsCaPath)
    ? fs.readFileSync(tlsCaPath, "utf8")
    : undefined;

/** Without merging, `ca` replaces Node’s default roots and public MX (Gmail, etc.) fails with “unable to get local issuer certificate”. */
const tlsCa =
  tlsCaExtraPem !== undefined
    ? [...tls.rootCertificates, tlsCaExtraPem]
    : undefined;

const mailTlsServername = process.env.MAIL_TLS_SERVERNAME?.trim();

const tlsBaseOpts = {
  ...(tlsCa !== undefined ? { ca: tlsCa } : {}),
  ...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
};

/** TLS options for a connection to `host` (SNI / cert name; override with MAIL_TLS_SERVERNAME). */
function tlsOptsForHost (host: string) {
  return {
    ...tlsBaseOpts,
    servername: mailTlsServername ?? host,
  };
}

const hasRelay = Boolean(mailHost && mailFrom && mailTo);
const hasMx = Boolean(mailFrom && mailToMx);

const hasAnyLive = hasRelay || hasMx;

async function primaryMxHost (to: string): Promise<string> {
  const domain = domainFromAddress(to);
  if (!domain) {
    throw new Error("invalid recipient address");
  }
  const records = await resolveMx(domain);
  if (!records.length) {
    throw new Error(`no MX records for ${domain}`);
  }
  records.sort((a, b) => a.priority - b.priority);
  return records[0].exchange.replace(/\.$/, "");
}

async function greetWithAutoStartTls (
  c: SMTPClient,
  timeout: number,
  tlsHost: string,
): Promise<void> {
  await c.greet({ hostname: mailEhloHost, timeout });
  if (!implicitTlsRelay && c.hasExtension("STARTTLS")) {
    await c.secure({ timeout, ...tlsOptsForHost(tlsHost) });
    await c.greet({ hostname: mailEhloHost, timeout });
  }
}

describe.skipIf(!hasAnyLive)("live send", () => {
  it.skipIf(!hasRelay)(
    `relay via MAIL_HOST (${mailHost ?? "—"})`,
    async () => {
      const c = new SMTPClient({
        host: mailHost!,
        port: relayPort,
        secure: implicitTlsRelay,
        timeout: 60_000,
        ...tlsOptsForHost(mailHost!),
      });

      const t = 60_000;
      const dataT = 120_000;

      try {
        await c.connect({ timeout: t });
        await greetWithAutoStartTls(c, t, mailHost!);

        await c.mail({ from: mailFrom!, timeout: t });
        await c.rcpt({ to: mailTo!, timeout: t });
        await c.data(messageBody("live send (relay)", mailTo!), {
          timeout: dataT,
        });
        await c.quit({ timeout: t });
      } finally {
        await c.close({ timeout: t }).catch(() => { });
      }
    },
  );

  it.skipIf(!hasMx)(
    "direct MX (MAIL_TO_MX)",
    async () => {
      const mxHost = await primaryMxHost(mailToMx!);
      console.info(`[smtp-client tests] MX ${mxHost}:${MX_PORT} → ${mailToMx}`);

      const c = new SMTPClient({
        host: mxHost,
        port: MX_PORT,
        secure: false,
        timeout: 60_000,
        ...tlsOptsForHost(mxHost),
      });

      const t = 60_000;
      const dataT = 120_000;

      try {
        await c.connect({ timeout: t });
        await c.greet({ hostname: mailEhloHost, timeout: t });
        if (c.hasExtension("STARTTLS")) {
          await c.secure({ timeout: t, ...tlsOptsForHost(mxHost) });
          await c.greet({ hostname: mailEhloHost, timeout: t });
        }

        await c.mail({ from: mailFrom!, timeout: t });
        await c.rcpt({ to: mailToMx!, timeout: t });
        await c.data(messageBody("live send (direct MX)", mailToMx!), {
          timeout: dataT,
        });
        await c.quit({ timeout: t });
      } finally {
        await c.close({ timeout: t }).catch(() => { });
      }
    },
  );
});
