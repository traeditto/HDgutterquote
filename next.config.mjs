/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // sharp ships a native binary; it must stay external so Next.js does not try
  // to bundle it into the serverless function (which crashes it on Vercel).
  serverExternalPackages: ["sharp"],
}

export default nextConfig
