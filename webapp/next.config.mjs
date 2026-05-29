/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: false,
  serverExternalPackages: ["hive-driver", "avsc"],
};
export default nextConfig;
