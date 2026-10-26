/*
 * Where a picture lives. Normally that's its path; in the one-file build (tools/bundle.mjs) the
 * page carries every asset inside itself, and this hands back a blob URL of that copy instead.
 * (Fetched files, the models and the JSON lists, go through the same copies by way of fetch.)
 */
export const assetUrl = (p) => (typeof window !== 'undefined' && window.__assetURL ? window.__assetURL(p) : p);
