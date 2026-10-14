function serialize(value: unknown): string {
  return JSON.stringify(value, (key, item: unknown) => {
    if (/^(?:privateKey|raw|rawTransaction|signature|apiKey|secret|authorization|password)$/i.test(key)) return "[redacted]";
    if (item instanceof Error) return { name: item.name };
    if (typeof item === "bigint") return item.toString();
    if (key === "reason" && typeof item === "string") return item.split("\n")[0]!.replace(/https?:\/\/\S+/g, "[endpoint]");
    if (typeof item === "string" && item.length > 512) return "[truncated]";
    return item;
  });
}

export const logger = {
  info: (msg: string, extra?: unknown) =>
    console.log(serialize({ level: "info", msg, extra })),
  warn: (msg: string, extra?: unknown) =>
    console.warn(serialize({ level: "warn", msg, extra })),
  error: (msg: string, extra?: unknown) =>
    console.error(serialize({ level: "error", msg, extra })),
};
