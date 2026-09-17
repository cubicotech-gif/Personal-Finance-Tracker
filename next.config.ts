import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // A service worker in dev caches stale chunks and makes every change a
  // mystery. Only build it for real deploys.
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist({
  reactStrictMode: true,
});
