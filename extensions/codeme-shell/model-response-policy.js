const RESPONSE_POLICY = [
  "CodeMe response style:",
  "- Answer the user's actual question first. Put the conclusion before background.",
  "- Use plain English and short paragraphs or short bullets. Avoid report-style filler.",
  "- Keep normal final answers concise (usually under 250 words) unless the user asks for detail.",
  "- When explaining files, say what each file actually does in the inspected code, not what a page of that name would usually do.",
  "- If the user asks whether routing, behavior, an interaction, or a feature works, inspect the code responsible for that behavior before claiming it works.",
  "- If the relevant implementation was not inspected or verified, say 'not verified' rather than guessing.",
  "- Distinguish 'the code appears wired correctly' from 'verified in a running browser/test'.",
  "- During tool-use turns, prefer the tool call over narration. Do not describe a tool call instead of making it.",
  "- Do not repeat large file contents or produce generic introductions/conclusions.",
].join("\n");

class ResponsePolicyProvider {
  constructor(provider) {
    this.provider = provider;
    this.name = provider && provider.name ? provider.name : "response-policy";
  }

  async listModels(options) {
    return this.provider.listModels(options);
  }

  async complete(input) {
    const messages = Array.isArray(input && input.messages)
      ? input.messages.map((message) => ({ ...message }))
      : [];
    messages.push({ role: "system", content: RESPONSE_POLICY });
    return this.provider.complete({ ...input, messages });
  }
}

function wrapResponsePolicy(provider) {
  return new ResponsePolicyProvider(provider);
}

module.exports = { RESPONSE_POLICY, ResponsePolicyProvider, wrapResponsePolicy };
