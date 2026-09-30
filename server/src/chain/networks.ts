import { env } from "../config/env.js";

export function ethereumSourceChain(): number {
  return env.monadChainId === 10143 ? 11155111 : 1;
}

export function ethereumWormholeChain(): number {
  return env.monadChainId === 10143 ? 10002 : 2;
}

export function monadWormholeChain(): number {
  return env.monadChainId === 10143 ? 10009 : 48;
}
