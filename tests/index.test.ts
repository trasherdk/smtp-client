/// <reference types="node" />

import net from "node:net";
import { describe, it, expect } from "vitest";
import { LineBuffer } from "@trasherdk/line-buffer";
import { SMTPServer } from "smtp-server";
import { SMTPClient } from "../src/index.js";

const buffer = new LineBuffer();

/** `0` = ephemeral port when *listening* only. Clients must use the assigned port from `start()`. */
const LISTEN_PORT_EPHEMERAL = 0;

/** Placeholder port for `SMTPClient` in tests that never call `connect()`. */
const OFFLINE_CLIENT_PORT = 1;

function clientForPort(port: number) {
  return { port, host: "127.0.0.1" as const };
}

function createSmtpServer() {
  const server = new SMTPServer({ secure: false, authOptional: true });
  let port = 0;
  return {
    start: () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ port: LISTEN_PORT_EPHEMERAL, host: "127.0.0.1" }, () => {
          server.removeListener("error", reject);
          const addr = server.server.address();
          if (addr && typeof addr !== "string") {
            port = addr.port;
          }
          if (!port) {
            reject(new Error("could not read SMTP test server port"));
            return;
          }
          console.info(
            `[smtp-client tests] SMTPServer listening on 127.0.0.1:${port}`,
          );
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    get port() {
      return port;
    },
  };
}

/**
 * Raw TCP mock for replies smtp-server cannot produce (bad greeting codes,
 * EHLO failure + HELO success, scripted AUTH challenges, STARTTLS failure).
 */
function createMockTcpServer() {
  const server = net.createServer();
  let port = 0;
  const api = server as net.Server & {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    readonly port: number;
  };
  api.start = () =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(LISTEN_PORT_EPHEMERAL, "127.0.0.1", () => {
        server.removeListener("error", reject);
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          port = addr.port;
        }
        if (!port) {
          reject(new Error("could not read mock TCP test port"));
          return;
        }
        console.info(
          `[smtp-client tests] mock TCP server listening on 127.0.0.1:${port}`,
        );
        resolve();
      });
    });
  api.stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  Object.defineProperty(api, "port", { get: () => port });
  return api;
}

describe("SMTPClient", () => {
  it("parseEnhancedReplyCode should parse ESMTP reply code", () => {
    const c = new SMTPClient();
    c._extensions = ["ENHANCEDSTATUSCODES"];
    expect(c.parseEnhancedReplyCode("555 5.5.5 Error")).toBe("5.5.5");
  });

  it("parseReplyText should parse SMTP and ESMTP reply message", () => {
    const c = new SMTPClient();
    expect(c.parseReplyText("555 5.5.5 Error")).toBe("5.5.5 Error");
    c._extensions = ["ENHANCEDSTATUSCODES"];
    expect(c.parseReplyText("555 5.5.5 Error")).toBe("Error");
  });

  it("getDataSizeLimit should return email size limit", () => {
    const c = new SMTPClient();
    c._extensions = ["SIZE 100"];
    expect(c.getDataSizeLimit()).toBe(100);
  });

  it("getAuthMechanisms should return a list of available authentication mechanisms", () => {
    const c = new SMTPClient();
    c._extensions = ["AUTH login PLAIN"];
    expect(c.getAuthMechanisms()).toEqual(["LOGIN", "PLAIN"]);
  });

  it("connect should connect to the SMTP server", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    expect(await c.connect()).toBe("220");

    await c.close();
    await s.stop();
  });

  it("connect throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("300 mx.test.com ESMTP\r\n");
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    try {
      await expect(c.connect()).rejects.toThrow();
    } finally {
      await c.close().catch(() => {});
      await s.stop();
    }
  });

  it("helo should send the HELO command", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();
    expect(await c.helo({ hostname: "foo" })).toBe("250");

    await c.close();
    await s.stop();
  });

  it("helo throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    await expect(c.helo({ hostname: "foo" })).rejects.toMatchObject({
      message: "foo",
    });

    await c.close();
    await s.stop();
  });

  it("ehlo should send the EHLO command and retrieve supported extensions", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    expect(c.hasExtension("8BITMIME")).toBe(false);
    expect(c.hasExtension("STARTTLS")).toBe(false);
    expect(await c.ehlo({ hostname: "foo" })).toBe("250");
    expect(c.hasExtension("8BITMIME")).toBe(true);
    expect(c.hasExtension("STARTTLS")).toBe(true);

    await c.close();
    await s.stop();
  });

  it("ehlo throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    await expect(c.ehlo({ hostname: "foo" })).rejects.toMatchObject({
      message: "foo",
    });

    await c.close();
    await s.stop();
  });

  it("greet should send the EHLO command and retrieve supported extensions", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    expect(c.hasExtension("8BITMIME")).toBe(false);
    expect(c.hasExtension("STARTTLS")).toBe(false);
    expect(await c.greet({ hostname: "foo" })).toBe("250");
    expect(c.hasExtension("8BITMIME")).toBe(true);
    expect(c.hasExtension("STARTTLS")).toBe(true);

    await c.close();
    await s.stop();
  });

  it("greet should fall back to HELO when EHLO is not supported", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", (data) => {
        const line = buffer.feed(data)[0];
        if (!line) return;
        const isValid = line === "HELO foo";
        const code = isValid ? "500" : "220";
        socket.write(`${code} foo\r\n`);
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    expect(c.hasExtension("8BITMIME")).toBe(false);
    expect(c.hasExtension("STARTTLS")).toBe(false);
    expect(await c.greet()).toBe("220");
    expect(c.hasExtension("8BITMIME")).toBe(false);
    expect(c.hasExtension("STARTTLS")).toBe(false);

    await c.close();
    await s.stop();
  });

  it("greet throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    await expect(c.greet({ hostname: "foo" })).rejects.toMatchObject({
      message: "foo",
    });

    await c.close();
    await s.stop();
  });

  it("mail should send the MAIL command", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();
    await c.greet({ hostname: "test" });
    expect(await c.mail({ from: "sender@example.com" })).toBe("250");

    await c.close();
    await s.stop();
  });

  it("mail throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    await expect(c.mail({ from: "foo" })).rejects.toMatchObject({
      message: "foo",
    });

    await c.close();
    await s.stop();
  });

  it("rcpt should send the RCPT command", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();
    await c.greet({ hostname: "test" });
    await c.mail({ from: "sender@example.com" });
    expect(await c.rcpt({ to: "rcpt@example.com" })).toBe("250");

    await c.close();
    await s.stop();
  });

  it("rcpt throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    await expect(c.rcpt({ to: "foo" })).rejects.toMatchObject({
      message: "foo",
    });

    await c.close();
    await s.stop();
  });

  it("noop should send the NOOP command (ping)", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();
    expect(await c.noop()).toBe("250");

    await c.close();
    await s.stop();
  });

  it("noop throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    await expect(c.noop()).rejects.toMatchObject({ message: "foo" });

    await c.close();
    await s.stop();
  });

  it("rset should send the RSET command (reset/flush)", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();
    expect(await c.rset()).toBe("250");

    await c.close();
    await s.stop();
  });

  it("rset throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    await expect(c.rset()).rejects.toMatchObject({ message: "foo" });

    await c.close();
    await s.stop();
  });

  it("quit should send the QUIT command", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();
    expect(await c.quit()).toBe("221");

    await c.close();
    await s.stop();
  });

  it("quit throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500-foo    bar\r\n");
        socket.write("500 fin\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    await expect(c.quit()).rejects.toMatchObject({ message: "foo bar fin" });

    await c.close();
    await s.stop();
  });

  it("data should send the DATA command with the appended . at the end", async () => {
    const s = createSmtpServer();
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();
    await c.greet({ hostname: "test" });
    await c.mail({ from: "a@example.com" });
    await c.rcpt({ to: "b@example.com" });
    expect(await c.data("bar")).toBe("250");

    await c.close();
    await s.stop();
  });

  it("data throws an error if the response code is not 2xx/3xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    await c.connect();

    await expect(c.data("x")).rejects.toMatchObject({ message: "foo" });

    await c.close();
    await s.stop();
  });

  it("data throws an error if the source size exceeds the allowable limit", () => {
    const c = new SMTPClient(clientForPort(OFFLINE_CLIENT_PORT));
    c._extensions = ["SIZE 10"];

    expect(() => c.data("", { sourceSize: 100 })).toThrow(
      "Message size exceeds the allowable limit (10 bytes)",
    );
  });

  it("authPlain should send the AUTH PLAIN command", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", (data) => {
        const line = buffer.feed(data)[0];
        if (!line) return;
        if (line === "AUTH PLAIN AGZvbwBiYXI=") {
          socket.write("235 Accepted\r\n");
        } else {
          socket.write("500 Error\r\n");
        }
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    c._extensions = ["AUTH PLAIN"];
    await c.connect();
    expect(await c.authPlain({ username: "foo", password: "bar" })).toBe("235");

    await c.close();
    await s.stop();
  });

  it("authPlain throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo    bar\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    c._extensions = ["AUTH PLAIN"];
    await c.connect();

    await expect(c.authPlain()).rejects.toMatchObject({ message: "foo bar" });

    await c.close();
    await s.stop();
  });

  it("authLogin should send the AUTH LOGIN command", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", (data) => {
        const line = buffer.feed(data)[0];
        if (!line) return;
        if (line === "AUTH LOGIN") {
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (line === "Zm9v") {
          socket.write("334 UGFzc3dvcmQ6\r\n");
        } else if (line === "YmFy") {
          socket.write("235 Accepted\r\n");
        } else {
          socket.write("500 Error\r\n");
        }
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    c._extensions = ["AUTH LOGIN"];
    await c.connect();
    expect(await c.authLogin({ username: "foo", password: "bar" })).toBe("235");

    await c.close();
    await s.stop();
  });

  it("authLogin throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo    bar\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    c._extensions = ["AUTH LOGIN"];
    await c.connect();

    await expect(c.authLogin()).rejects.toMatchObject({ message: "foo bar" });

    await c.close();
    await s.stop();
  });

  it("secure throws an error if the response code is not 2xx", async () => {
    const s = createMockTcpServer();
    s.on("connection", (socket) => {
      socket.write("220 mx.test.com ESMTP\r\n");
      socket.on("data", () => {
        socket.write("500 foo\r\n");
      });
    });
    await s.start();

    const c = new SMTPClient(clientForPort(s.port));
    c._extensions = ["STARTTLS"];
    await c.connect();

    await expect(c.secure()).rejects.toMatchObject({ message: "foo" });

    await c.close();
    await s.stop();
  });
});
