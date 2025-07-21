export default function handler(req, res) {
  res.status(200).json({
    hasKV: !!process.env.KV_URL,
    nodeVersion: process.version,
    kvUrl: process.env.KV_URL ? "present" : "missing",
    allKvVars: {
      KV_URL: process.env.KV_URL ? "present" : "missing",
      KV_REST_API_URL: process.env.KV_REST_API_URL ? "present" : "missing", 
      KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ? "present" : "missing"
    }
  });
}
