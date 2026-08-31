/**
 * `amalgam auth` — a terminal front end for ModelRuntime's login flows.
 * Credentials land in ~/.amalgam/auth.json, which .gitignore excludes.
 */
import { createInterface } from "node:readline/promises";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export function listProviders(modelRuntime: ModelRuntime): void {
  console.log("Providers (`amalgam auth <provider>` to sign in):\n");
  for (const provider of modelRuntime.getProviders()) {
    const status = modelRuntime.getProviderAuthStatus(provider.id);
    const methods = [provider.auth.apiKey ? "api_key" : undefined, provider.auth.oauth ? "oauth" : undefined]
      .filter(Boolean)
      .join(", ");
    const state = status.configured ? `configured (${status.source ?? "stored"})` : "not configured";
    console.log(`  ${provider.id.padEnd(20)} ${state.padEnd(28)} ${methods}  ${provider.name}`);
  }
}

export async function login(modelRuntime: ModelRuntime, providerId: string): Promise<void> {
  const provider = modelRuntime.getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}. Run \`amalgam auth\` to list them.`);
  }
  const type = await chooseMethod(provider.auth.apiKey !== undefined, provider.auth.oauth !== undefined);
  await modelRuntime.login(providerId, type, {
    prompt: async (request) => {
      if (request.type === "select") {
        console.log(request.message);
        request.options.forEach((option, index) => console.log(`  ${index + 1}) ${option.label}`));
        const choice = Number(await ask("Choice: ", false));
        const option = request.options[choice - 1];
        if (!option) {
          throw new Error("No such choice");
        }
        return option.id;
      }
      return ask(`${request.message} `, request.type === "secret");
    },
    notify: (event) => {
      if (event.type === "auth_url") {
        console.log(`\nOpen this URL to authorise:\n  ${event.url}\n${event.instructions ?? ""}`);
      } else if (event.type === "device_code") {
        console.log(`\nOpen ${event.verificationUri} and enter the code: ${event.userCode}\n`);
      } else {
        console.log(event.message);
      }
    },
  });
  console.log(`Signed in to ${providerId}.`);
}

async function chooseMethod(hasApiKey: boolean, hasOAuth: boolean): Promise<"api_key" | "oauth"> {
  if (hasOAuth && !hasApiKey) {
    return "oauth";
  }
  if (hasApiKey && !hasOAuth) {
    return "api_key";
  }
  const answer = await ask("Sign in with (1) OAuth or (2) API key? ", false);
  return answer.trim() === "1" ? "oauth" : "api_key";
}

/** Reads one line. Hidden input needs raw mode, so it only works on a TTY. */
async function ask(prompt: string, hidden: boolean): Promise<string> {
  if (!hidden || !process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await rl.question(prompt)).trim();
    } finally {
      rl.close();
    }
  }
  return readHidden(prompt);
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 0x03) {
          finish(new Error("Cancelled"));
          return;
        }
        if (byte === 0x0d || byte === 0x0a) {
          finish();
          return;
        }
        if (byte === 0x7f || byte === 0x08) {
          value = value.slice(0, -1);
        } else if (byte >= 0x20) {
          value += String.fromCharCode(byte);
        }
      }
    };
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value.trim());
      }
    };
    process.stdin.on("data", onData);
  });
}
