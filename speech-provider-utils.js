function createSpeechProviderRegistry(rawProviders, options = {}) {
  if (!Array.isArray(rawProviders) || !rawProviders.length) {
    throw new TypeError("音声プロバイダを1件以上指定してください");
  }

  const providers = new Map();
  for (const rawProvider of rawProviders) {
    const id = String(rawProvider?.id || "").trim();
    const label = String(rawProvider?.label || id).trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new TypeError(`音声プロバイダIDが不正です: ${id || "(空)"}`);
    }
    if (providers.has(id)) throw new TypeError(`音声プロバイダIDが重複しています: ${id}`);
    if (typeof rawProvider?.synthesize !== "function") {
      throw new TypeError(`音声合成関数がありません: ${id}`);
    }
    providers.set(id, Object.freeze({
      id,
      label: label || id,
      synthesize: rawProvider.synthesize,
      capabilities: Object.freeze({
        sentenceStreaming: Boolean(rawProvider.capabilities?.sentenceStreaming)
      })
    }));
  }

  const fallbackIds = [...new Set(
    (Array.isArray(options.fallbackIds) ? options.fallbackIds : [])
      .map((id) => String(id || "").trim())
      .filter((id) => providers.has(id))
  )];

  return Object.freeze({
    get(id) {
      return providers.get(String(id || ""));
    },
    list() {
      return [...providers.values()];
    },
    getFallbackChain(preferredId) {
      const preferred = providers.get(String(preferredId || ""));
      const ids = [preferred?.id, ...fallbackIds].filter(Boolean);
      return [...new Set(ids)].map((id) => providers.get(id));
    },
    supports(providerId, capability) {
      return Boolean(providers.get(String(providerId || ""))?.capabilities?.[capability]);
    }
  });
}

module.exports = { createSpeechProviderRegistry };
