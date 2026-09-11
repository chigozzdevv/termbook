export type AppAction = {
  capability: string;
  params: Record<string, unknown>;
  target?: `0x${string}`;
  data?: `0x${string}`;
};
