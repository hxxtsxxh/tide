// Version-controlled switch for the finite, authored, client-only Simulation Lab (SPEC.md
// "Simulation deployment policy"). No environment variable: the deployer does not upload one.
// The lab never calls a server endpoint, model or URL fetch, and its results are mode=fixture.
// Set to false to remove the lab after the event. Product/API/health default mode stays 'live'.
export const SIMULATION_LAB_ENABLED = true;
export const DEFAULT_PRODUCT_MODE = 'live' as const;
