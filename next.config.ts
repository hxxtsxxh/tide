import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Prepared context, fixtures and oracle must never be traced into the deployed bundle.
  outputFileTracingExcludes: { '*': ['.searchhack/**'] },
};

export default nextConfig;
