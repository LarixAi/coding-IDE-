# CodeMe agent instructions

This repository is CodeMe on Code - OSS. Do not copy leftover trees such as `Code-me-IDE-C.`.

## Tests ChatGPT, Codex, and Copilot must run

After changing agent, Composer, sandbox, or browser-interaction code, run:

```sh
sh scripts/test-ci.sh
```

That gate is the GitHub Actions `CI` check. It covers the scripted orchestration, tool contract, sandbox, Composer, and real Chromium click tests. Live Ollama/Qwen and n8n hub checks stay on developer machines.

Install Node 24. If a Chromium browser is present, the click test runs; otherwise it skips the live click and still checks the runner contract.

```sh
# optional: point at an installed Chrome/Brave
export CODEME_BROWSER=/usr/bin/google-chrome
```

Do not start Code - OSS or Ollama just to run `scripts/test-ci.sh`.
