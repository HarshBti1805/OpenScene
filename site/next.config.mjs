/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  outputFileTracingRoot: new URL(".", import.meta.url).pathname,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
