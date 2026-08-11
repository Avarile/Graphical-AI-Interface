/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // modules.json is opened through a path built at runtime, which the output
  // tracer cannot see by following imports — so on a serverless deploy the file
  // would simply not be there and GET /api/modules would 404. Naming it here
  // is what gets it packaged with the route.
  outputFileTracingIncludes: {
    '/api/modules': ['./modules.json'],
  },
};

export default nextConfig;
