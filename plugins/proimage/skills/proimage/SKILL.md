---
name: proimage
description: Generate or edit images using configured ProImage MCP presets. Read the saved image path and the cost of each generation or edit.
---

# ProImage

Use `proimage_get_presets` to discover model presets and their capabilities. `proimage_generate` creates an image from a prompt. `proimage_edit` accepts absolute paths to reference images and an optional mask. Both tools use the configured default when `preset` is omitted and return the saved image's absolute path.

## Image generation costs

Each successful result includes `cost.usd` for that request. Quality, size, prompt length, and reference images can affect token usage.

- `cost.source: provider_reported` uses the amount reported by the provider in USD.
- `cost.source: openai_list_price` applies [OpenAI's standard token rates](https://developers.openai.com/api/docs/pricing#image-generation) to the usage returned for the request. This amount can differ from the account invoice.
- `cost.source: unavailable` means `cost.usd` is `null`. Report the amount as unavailable.

Provider token counts, when supplied, are included in `providerMetadata`.
