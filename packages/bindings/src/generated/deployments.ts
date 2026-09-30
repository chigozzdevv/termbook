export type DeploymentMap = Record<string, Record<string, `0x${string}`>>;

export const deployments: DeploymentMap = {
  "10143": {
    "ProtocolGovernance": "0xc6d1ec8c0b410cb089a110685ba19ee9954be37c",
    "Guardian": "0x9edc3e9585e7797f88d397c07461d883505208f0",
    "HouseRegistry": "0x3aa105a2744ea6b17d6fd5acd060fb3b205e7129",
    "VerifierRegistry": "0x09a245e7a7953d7477a82dba9ba4415ee1d5f014",
    "FlowExecutor": "0x5bfd437144599b2906031f8036daa024fd77ef4a",
    "ReservationManager": "0x4420a2a6fc90e6551baf50d93448dff3a927483f",
    "PriceProtection": "0x404a45eda3fa4b2bdccf0f0264fd95f5cf32576b",
    "TermbookCore": "0xd12d4abf4df27c58623abb0a74f203f4216c1bbd",
    "RiskEngine": "0x3a4b10393796e5680dc6acabcc0da7639521aea1",
    "AccountFactory": "0xb600e2412867286724d4e0929697ce6ae614936f",
    "IntegrationRegistry": "0x072be9a579fe1ed24e071bc905f873fc79a1d6b1",
    "InboxFactory": "0xf6892f773a185c7157d2349e661def741a2384a2",
    "OracleRegistry": "0x5bb0eb823a4fcb686f6d355f1cc34fbce9e6f7ff",
    "HealthSource": "0xc570b2f0419a8a4c28998e1923142a2f6a814f08",
    "HouseVault": "0x9a38097d9ee21b5e6a6f3b74358ce2ead2105c90",
    "RouteRegistry": "0x3d8d8b7c03371ad791830fb5f63c5fbd28386a1e",
    "NativeCollateralVault": "0x02815928275683afe4e5e3f37f5bdb500f53df88",
    "CollateralHealthReader": "0x4203b18da04304bd261aa75f14871dceef0f732b",
    "WormholeEvmMessageClient": "0x2f677a62233240adeb52fe6afbba5e06ee4e27b7",
    "WormholeEthereumVerifier": "0x67c24977eea89716f8dd1668a8cb73fc9ba1c96d",
    "WormholeSolanaAccountClient": "0xe1b80f54499e981aa5bb90b39ea6333bb96dc095",
    "SolanaVerifier": "0x8f31f37ffd1fe41d05c916eb096a06a5860ff1bb"
  },
  "11155111": {
    "ProtocolGovernance": "0xc6d1ec8c0b410cb089a110685ba19ee9954be37c",
    "AuthorizationClient": "0x9edc3e9585e7797f88d397c07461d883505208f0",
    "RecoveryClient": "0x3aa105a2744ea6b17d6fd5acd060fb3b205e7129",
    "WormholeMonadVerifier": "0x09a245e7a7953d7477a82dba9ba4415ee1d5f014",
    "SourceRecoveryVault": "0x5bfd437144599b2906031f8036daa024fd77ef4a",
    "RemoteCollateralController": "0x4420a2a6fc90e6551baf50d93448dff3a927483f",
    "CollateralVault": "0xEa1D95605B4852038105Ed098AcE314e23e2A799",
    "WormholeEthereumPublisher": "0x404a45eda3fa4b2bdccf0f0264fd95f5cf32576b"
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
