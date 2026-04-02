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
      if (prompt.length > 20000) {
        return Response.json(
          { error: "Input too long (max 20000 characters)" },
          { status: 400, headers: corsHeaders }
        );
      }

      const response = await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages: [
            {
              role: "system",
              content: `You turn structured GitHub pull-request lists into an HTML report.

Goals:
- For EVERY pull request, explain what the author actually did or changed: scope, main changes, and outcome or intent. Use the title, labels, and description/body when provided; infer carefully from the title only when the body is missing—do not invent file names or features that are not implied.
- Write exactly 2 or 3 full sentences per PR (not one short line). Be specific and concrete; avoid generic phrases like "improved the codebase" unless the title/body supports it.
- Group PRs by repository. Order repos alphabetically or by relevance (same repo together).

HTML rules:
- Use <h3> for each repository name (full repo path, e.g. owner/name).
- Under each <h3>, use <ul> and one <li> per PR. Set class on each <li> to exactly one of: merged, open, closed (matching PR state: merged vs open vs closed-unmerged).
- Inside each <li>, start with <strong>#number Title</strong>, then the status and key date in plain text, then use <p> tags for each of the 2–3 sentences of detail (one <p> per sentence is fine).
- You may use <strong> and <p> inside <li>. Do not use markdown. No preamble, no "Here is a summary", no overall conclusion section, no bullet list of highlights across all repos—only per-repo sections as specified.

If there are many PRs, keep each PR to 2–3 sentences and stay substantive; do not skip PRs.`,
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 8192,
          temperature: 0.35,
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
