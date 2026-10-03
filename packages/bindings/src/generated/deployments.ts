export type DeploymentMap = Record<string, Record<string, `0x${string}`>>;

export const deployments: DeploymentMap = {
  "10143": {
    "ProtocolGovernance": "0xa752c4e79600270c7e4c31a660a01faa10b9c52a",
    "Guardian": "0x9edc3e9585e7797f88d397c07461d883505208f0",
    "HouseRegistry": "0x67ae784bb38ec4ed78b20c02d79566f4b2d5e0a2",
    "VerifierRegistry": "0x25d63b81e44cb261835b7fb38292abe101d874d2",
    "FlowExecutor": "0xa9ec8cc9eb40a4b1d75f28de3bfca608b3d793d7",
    "ReservationManager": "0x76f6a8914c7016afc21a4b2d777ec3c034fa1fa0",
    "PriceProtection": "0xa5ad4c207b31ab784ce0d16ef4794e8f064aeae6",
    "TermbookCore": "0xbbfa006d8b5621db17fe06e9f59dd6ddbfe7c056",
    "RiskEngine": "0xfe2bfa5efa4ba340d1024907fecef8b7c7e1aed5",
    "AccountFactory": "0xed40057da544ff6f6fb9dd8fb385f79fb45c4092",
    "IntegrationRegistry": "0x506bc56000bd82a99096543e41f826c45556da53",
    "InboxFactory": "0xe9be81e17110c538eac53680e3410bb411878ed6",
    "OracleRegistry": "0x5e6fadbfeb6fc9e996840fa0c0d370f36ee37d91",
    "HealthSource": "0xf46173ab613515e4e86867757ef5697939278022",
    "AccountHealthSource": "0x21202bd032daf48dac7407dc929b6c14c430fcac",
    "HouseVault": "0x32c130518fd5334e1f0a1ed16150fb53a6a12148",
    "RouteRegistry": "0xf4b44af0bca363fe5745645abde39dc031a42f8c",
    "NativeCollateralVault": "0xfbcef51f4477a4ba382c8f652913eccc7f5b9522",
    "CollateralHealthReader": "0x534fa22ebf60819e1e6cdfaa2c486e646ffb9354",
    "WormholeEvmMessageClient": "0xd5b28e827e0f6a4eecb9d0a8a463b838441c9f55",
    "WormholeEthereumVerifier": "0x2d8594d73c36ab1f69bf386f0c2d02a239333e49",
    "WormholeSolanaAccountClient": "0xe1b80f54499e981aa5bb90b39ea6333bb96dc095",
    "SolanaVerifier": "0x8f31f37ffd1fe41d05c916eb096a06a5860ff1bb"
  },
  "11155111": {
    "ProtocolGovernance": "0xb600e2412867286724d4e0929697ce6ae614936f",
    "AuthorizationClient": "0x072be9a579fe1ed24e071bc905f873fc79a1d6b1",
    "RecoveryClient": "0xf6892f773a185c7157d2349e661def741a2384a2",
    "WormholeMonadVerifier": "0x5bb0eb823a4fcb686f6d355f1cc34fbce9e6f7ff",
    "SourceRecoveryVault": "0xc570b2f0419a8a4c28998e1923142a2f6a814f08",
    "RemoteCollateralController": "0x886739b9b623ed85dbb60366da54f1a32222243f",
    "CollateralVault": "0xf7A7c4Cf2AFe66a0AcF94388daa3770654474411",
    "WormholeEthereumPublisher": "0x2ac3642c4bb71433d444f35ec649690f2570a297"
  }
};

export const solanaDeployments = {
  "devnet": {
    "network": "devnet",
    "genesis": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    "programId": "FTj5kb9Z7JDpGNWD2NowGgz67zP3VxUKwLgKEFSTrYg1",
    "programDataAddress": "FrFDeTcd89kCguSUXNFBunsbrs6qfM8bFgJAGcp3KxUF",
    "programDataHash": "0x3ce90fa05cc664fb84a0fc436522a3f74bf57a59da94f1a555e06dce66413092",
    "emitter": "FrjxusEAfzgfTM8M5ZJ3yc5VgFZXyGRQqUFKxFAbyxMj",
    "immutable": true,
    "deploymentSignature": "NRtYLfojYsPnn6XfbjEwmRNHPAHxpBZLCypRCfw3eVWkoarcjG26BPJCoVYKNcVegYbJAbqDqUWqQuqHhH5KxdQ"
  }
} as const;
