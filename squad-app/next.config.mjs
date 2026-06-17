/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // webhooks may take a moment with HMAC verify + DB writes
    serverComponentsExternalPackages: ["@anthropic-ai/sdk"],
  },
};

export default nextConfig;
