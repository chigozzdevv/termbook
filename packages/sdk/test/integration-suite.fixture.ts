import { acceptanceCases, rejectionCases, type IntegrationSuite } from '@termbook/schema';
import { encodeAbiParameters, keccak256, toFunctionSelector, type Hex } from 'viem';
export const suiteAddress = (digit: string) => `0x${digit.repeat(40)}` as Hex;
export const suiteWord = (digit: string) => `0x${digit.repeat(64)}` as Hex;
export function sampleSuite(options: Partial<Pick<IntegrationSuite, 'core' | 'versionId' | 'manifestHash' | 'actors'>> = {}): IntegrationSuite {
  const core = options.core ?? suiteAddress('1');
  const actors = options.actors ?? { borrower: suiteAddress('b'), keeper: suiteAddress('c'), unauthorized: suiteAddress('d') };
  const block = { number: '1', hash: suiteWord('a') };
  return { format: 1, chainId: 143, core, versionId: options.versionId ?? suiteWord('b'), manifestHash: options.manifestHash ?? suiteWord('c'),
    mode: 'deployment', sourceBlock: block, actors,
    contracts: [...new Set([core, ...'123456789abcdef'.split('').map(suiteAddress)])].map((target) => ({ target, codeHash: keccak256('0x1234') })),
    exclusions: [], cases: (Object.keys(acceptanceCases) as (keyof typeof acceptanceCases)[]).map((id) => ({ id,
      observations: ['before', 'after'].map((phase) => ({ id: phase, target: core, from: actors.borrower,
        signature: 'function state() view returns (uint256)', data: toFunctionSelector('state()'),
        result: encodeAbiParameters([{ type: 'uint256' }], [1n]), block, types: ['uint256'], phase: phase as 'before' | 'after' })),
      transactions: [], simulations: [{ id: 'control', from: actors.keeper, to: core, data: toFunctionSelector('act()'), value: '0', block, reverted: false, result: '0x' },
        ...(rejectionCases.includes(id) ? [{ id: 'rejection', from: actors.unauthorized, to: core, data: toFunctionSelector('act()'), value: '0', block, reverted: true, result: '0x12345678', control: 'control' }] : [])],
      assertions: [{ label: 'state comparison', left: { observation: 'before', index: 0 }, operator: 'eq', right: { observation: 'after', index: 0 } }],
    })),
  };
}
