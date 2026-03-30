/// <reference types="node" />

import os from "node:os";
import { SMTPChannel } from "@trasherdk/smtp-channel";
import type { SMTPChannelConfig } from "@trasherdk/smtp-channel";
import { SMTPResponseError } from "./errors.js";

export type { SMTPChannelConfig } from "@trasherdk/smtp-channel";
export { SMTPResponseError } from "./errors.js";

export interface ConnectClientOptions {
  timeout?: number;
}

export interface GreetOptions {
  hostname?: string | null;
  timeout?: number;
}

export interface MailOptions {
  from?: string | null;
  timeout?: number;
  utf8?: boolean;
}

export interface RcptOptions {
  to?: string | null;
  timeout?: number;
}

export interface DataOptions {
  sourceSize?: number;
  timeout?: number;
}

export interface AuthOptions {
  username?: string | null;
  password?: string | null;
  timeout?: number;
}

export interface SecureOptions {
  timeout?: number;
  /** When false, accepts self-signed or incomplete certificate chains (e.g. dev servers). */
  rejectUnauthorized?: boolean;
  /** Trusted CA(s) in PEM form — same as Node `tls.connect` `ca` (e.g. your server’s cert for self-signed setups). */
  ca?: string | Buffer | ArrayBufferView | ArrayBuffer | (Buffer | string)[];
  /** SNI server name; set when connecting by IP or when cert name differs from `host`. */
  servername?: string;
}

/**
 * Simple, promisified, protocol-based SMTP client extending SMTPChannel.
 */
export class SMTPClient extends SMTPChannel {
  _extensions: string[] = [];

  constructor(config: SMTPChannelConfig = {}) {
    super(config);
  }

  connect({ timeout: time = 0 }: ConnectClientOptions = {}): Promise<string> {
    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };

    return super.connect({ handler, timeout: time }).then((code) => {
      if (code && code.charAt(0) === "2") {
        return code;
      }
      throw this._createSMTPResponseError(lines);
    });
  }

  helo({ hostname = null, timeout: time = 0 }: GreetOptions = {}): Promise<string> {
    const h = hostname ?? this._getHostname();
    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const command = `HELO ${h}\r\n`;

    return this.write(command, { handler, timeout: time }).then((code) => {
      if (code && code.charAt(0) === "2") {
        return code;
      }
      throw this._createSMTPResponseError(lines);
    });
  }

  ehlo({ hostname = null, timeout: time = 0 }: GreetOptions = {}): Promise<string> {
    const h = hostname ?? this._getHostname();
    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const command = `EHLO ${h}\r\n`;

    return this.write(command, { handler, timeout: time }).then((code) => {
      if (code && code.charAt(0) === "2") {
        this._extensions = lines.slice(1).map((l) => this.parseReplyText(l));
        return code;
      }
      throw this._createSMTPResponseError(lines);
    });
  }

  greet({ hostname = null, timeout: time = 0 }: GreetOptions = {}): Promise<string> {
    return this.ehlo({ hostname, timeout: time }).catch(() =>
      this.helo({ hostname, timeout: time }),
    );
  }

  hasExtension(extension: string): boolean {
    return !!this._extensions.find((e) => e.split(" ")[0] === extension);
  }

  getDataSizeLimit(): number {
    const extension = this._extensions.find((e) => e.split(" ")[0] === "SIZE");
    if (extension) {
      return parseInt(extension.split(" ")[1], 10);
    }
    return 0;
  }

  getAuthMechanisms(): string[] {
    const extension = this._extensions.find((e) => e.split(" ")[0] === "AUTH");
    if (extension) {
      return extension
        .split(" ")
        .filter((e) => !!e)
        .map((e) => e.trim().toUpperCase())
        .slice(1);
    }
    return [];
  }

  parseEnhancedReplyCode(line: string): string | null {
    const isSupported = this.hasExtension("ENHANCEDSTATUSCODES");
    return isSupported ? line.substring(4).split(" ", 2)[0] : null;
  }

  parseReplyText(line: string): string {
    const isSupported = this.hasExtension("ENHANCEDSTATUSCODES");
    if (isSupported) {
      const parts = line.substring(4).split(/[\s](.+)?/, 2);
      return parts[1] ?? "";
    }
    return line.substring(4);
  }

  mail({ from = null, timeout: time = 0, utf8 = false }: MailOptions = {}): Promise<string> {
    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    let command = `MAIL FROM:<${from}>\r\n`;
    if (utf8) {
      if (!this.hasExtension("SMTPUTF8")) {
        throw new Error("Server does not support UTF8 mailboxes");
      }
      command = `MAIL FROM:<${from}> SMTPUTF8\r\n`;
    }

    return this.write(command, { handler, timeout: time }).then((code) => {
      if (code && code.charAt(0) === "2") {
        return code;
      }
      throw this._createSMTPResponseError(lines);
    });
  }

  rcpt({ to = null, timeout: time = 0 }: RcptOptions = {}): Promise<string> {
    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const command = `RCPT TO:<${to}>\r\n`;

    return this.write(command, { handler, timeout: time }).then((code) => {
      if (code && code.charAt(0) === "2") {
        return code;
      }
      throw this._createSMTPResponseError(lines);
    });
  }

  noop({ timeout: time = 0 }: { timeout?: number } = {}): Promise<string> {
    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const command = `NOOP\r\n`;

    return this.write(command, { handler, timeout: time }).then((code) => {
      if (code && code.charAt(0) === "2") {
        return code;
      }
      throw this._createSMTPResponseError(lines);
    });
  }

  rset({ timeout: time = 0 }: { timeout?: number } = {}): Promise<string> {
    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const command = `RSET\r\n`;

    return this.write(command, { handler, timeout: time }).then((code) => {
      if (code && code.charAt(0) === "2") {
        return code;
      }
      throw this._createSMTPResponseError(lines);
    });
  }

  quit({ timeout: time = 0 }: { timeout?: number } = {}): Promise<string> {
    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const command = `QUIT\r\n`;

    return this.write(command, { handler, timeout: time }).then((code) => {
      if (code && code.charAt(0) === "2") {
        return code;
      }
      throw this._createSMTPResponseError(lines);
    });
  }

  data(
    source: string,
    { sourceSize = 0, timeout: time = 0 }: DataOptions = {},
  ): Promise<string> {
    const sizeLimit = this.getDataSizeLimit();
    if (sizeLimit > 0 && sourceSize > sizeLimit) {
      throw new Error(
        `Message size exceeds the allowable limit (${sizeLimit} bytes)`,
      );
    }

    let lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const command = `DATA\r\n`;

    return this.write(command, { handler, timeout: time })
      .then((code) => {
        if (code && code.charAt(0) !== "3") {
          throw this._createSMTPResponseError(lines);
        }
        lines = [];
        return this.write(
          `${source.replace(/^\./gm, "..")}\r\n.\r\n`,
          { handler, timeout: time },
        );
      })
      .then((code) => {
        if (code && code.charAt(0) === "2") {
          return code;
        }
        throw this._createSMTPResponseError(lines);
      });
  }

  secure({
    timeout: time = 0,
    rejectUnauthorized,
    ca,
    servername,
  }: SecureOptions = {}): Promise<void> {
    const isPossible = this.hasExtension("STARTTLS");
    if (!isPossible) {
      throw new Error("SMTP server does not support TLS");
    }

    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const command = `STARTTLS\r\n`;

    return this.write(command, { handler, timeout: time })
      .then((code) => {
        if (code && code.charAt(0) !== "2") {
          throw this._createSMTPResponseError(lines);
        }
        return this.negotiateTLS({
          timeout: time,
          ...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
          ...(ca !== undefined ? { ca } : {}),
          ...(servername !== undefined ? { servername } : {}),
        });
      })
      .then(() => {
        this._extensions = [];
      });
  }

  authPlain({ username = null, password = null, timeout: time = 0 }: AuthOptions = {}): Promise<string> {
    const mechanisms = this.getAuthMechanisms();
    if (mechanisms.indexOf("PLAIN") === -1) {
      throw new Error(
        "SMTP server does not support the PLAIN authentication mechanism",
      );
    }

    const lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const token = Buffer.from(
      `\u0000${username ?? ""}\u0000${password ?? ""}`,
      "utf-8",
    ).toString("base64");
    const command = `AUTH PLAIN ${token}\r\n`;

    return this.write(command, { handler, timeout: time }).then((code) => {
      if (code && code.charAt(0) === "2") {
        return code;
      }
      throw this._createSMTPResponseError(lines);
    });
  }

  authLogin({ username = null, password = null, timeout: time = 0 }: AuthOptions = {}): Promise<string> {
    const mechanisms = this.getAuthMechanisms();
    if (mechanisms.indexOf("LOGIN") === -1) {
      throw new Error(
        "SMTP server does not support the LOGIN authentication mechanism",
      );
    }

    let lines: string[] = [];
    const handler = (line: string) => {
      lines.push(line);
    };
    const command = `AUTH LOGIN\r\n`;

    return this.write(command, { handler, timeout: time })
      .then(() => {
        if (lines[0] !== "334 VXNlcm5hbWU6") {
          throw this._createSMTPResponseError(lines);
        }
        lines = [];
        const userToken = Buffer.from(username ?? "", "utf-8").toString("base64");
        return this.write(`${userToken}\r\n`, { handler, timeout: time });
      })
      .then(() => {
        if (lines[0] !== "334 UGFzc3dvcmQ6") {
          throw this._createSMTPResponseError(lines);
        }
        lines = [];
        const passToken = Buffer.from(password ?? "", "utf-8").toString("base64");
        return this.write(`${passToken}\r\n`, { handler, timeout: time });
      })
      .then((code) => {
        if (code && code.charAt(0) === "2") {
          return code;
        }
        throw this._createSMTPResponseError(lines);
      });
  }

  _createSMTPResponseError(lines: string[]): SMTPResponseError {
    const line = lines[lines.length - 1];
    const code = this.parseReplyCode(line);
    const enhancedCode = this.parseEnhancedReplyCode(line);
    const message = lines
      .map((l) => this.parseReplyText(l))
      .join(" ")
      .replace(/\s\s+/g, " ")
      .trim();

    return new SMTPResponseError(message, code ?? "500", enhancedCode);
  }

  _getHostname(): string {
    let host = os.hostname() ?? "";

    if (host.indexOf(".") < 0) {
      host = "[127.0.0.1]";
    } else if (host.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
      host = `[${host}]`;
    }

    return host;
  }
}
