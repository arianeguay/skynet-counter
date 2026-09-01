import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['bun:sqlite'],
};

export default config;
