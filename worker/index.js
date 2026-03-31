// Allowed origins — add your deployed domain here
const ALLOWED_ORIGINS = [
  "https://github-history-ai.mayursuryawanshi.workers.dev",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://127.0.0.1:5500",
];

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const isAllowed = ALLOWED_ORIGINS.some((o) => origin.startsWith(o));
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request);

    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers: corsHeaders }
      );
    }

    try {
      const { prompt } = await request.json();

      if (!prompt || typeof prompt !== "string") {
        return Response.json(
          { error: "Missing or invalid prompt" },
          { status: 400, headers: corsHeaders }
        );
      }

      // Cap input length to prevent abuse
      if (prompt.length > 15000) {
        return Response.json(
          { error: "Input too long (max 15000 characters)" },
          { status: 400, headers: corsHeaders }
        );
      }

      const response = await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages: [
            {
              role: "system",
              content:
                "You output concise HTML summaries of GitHub PR data. Only use <h3>, <ul>, <li> tags. No introductions, no overall summaries, no key highlights, no filler text. Just the data grouped by repo.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 4096,
          temperature: 0.7,
        }
      );

      return Response.json(
        { summary: response.response },
        { headers: corsHeaders }
      );
    } catch (err) {
      console.error("Worker error:", err);
      return Response.json(
        { error: "AI inference failed" },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
