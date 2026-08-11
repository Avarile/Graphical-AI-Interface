/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The store is data/modules.db, opened through a path built at runtime, which
  // the output tracer cannot see by following imports — so on a serverless
  // deploy neither it nor the seed file would be there and every module route
  // would fail. Naming them here is what gets them packaged with the routes.
  //
  // modules.json is still needed at runtime: it seeds an empty database, and
  // /api/export writes it back out.
  outputFileTracingIncludes: {
    '/api/modules': ['./modules.json', './data/**'],
    '/api/modules/[id]': ['./data/**'],
    '/api/export': ['./modules.json', './data/**'],
  },
};

export default nextConfig;
