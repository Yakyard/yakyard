// Adapted from tldraw/cloudflare-workers-unfurl. MIT License, Copyright 2024 tldraw GB Ltd. https://github.com/tldraw/cloudflare-workers-unfurl
/**
 * @template Value
 * @typedef {Object} GoodResult
 * @property {true} ok - The success status.
 * @property {Value} value - The data extracted from the URL.
 */

/**
 * @template Error
 * @typedef {Object} BadResult
 * @property {false} ok - The success status.
 * @property {Error} error - The error
 */

/**
 * @template Value, Error
 * @typedef {GoodResult<Value> | BadResult<Error>} Result
 */

/**
 * @typedef {Object} UnfurledData
 * @property {string} [title] - The title extracted from the URL.
 * @property {string} [description] - The description extracted from the URL.
 * @property {string} [image] - The image URL extracted from the URL.
 * @property {string} [favicon] - The favicon URL extracted from the URL.
 * @property {number} [imageWidth] - The intrinsic width of the image, if reported (og:image:width, falling back to twitter:player:width).
 * @property {number} [imageHeight] - The intrinsic height of the image, if reported (og:image:height, falling back to twitter:player:height).
 */

/**
 * @typedef {'bad-param' | 'failed-fetch'} UnfurlError
 */

const validContentTypes = [
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "image/*",
];

/**
 *
 * @param {string} contentType
 * @returns {boolean}
 */
function isValidContentType(contentType) {
  return (
    // allow unspecified, try to parse it anyway
    !contentType ||
    contentType.startsWith("image/") ||
    validContentTypes.some((valid) => contentType.startsWith(valid))
  );
}

// Link previews may only fetch public web pages: http(s), normal ports, no private or local hosts.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[)|\.local$|\.internal$|\.localhost$|^\d+$|^[\d.]+$/i;
export function safeFetchUrl(u) {
  let p;
  try { p = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(p.protocol) || p.username || p.password) return false;
  if (PRIVATE_HOST.test(p.hostname) || !p.hostname.includes('.')) return false;
  if (p.port && !["80", "443"].includes(p.port)) return false;
  return true;
}
const MAX_HTML = 512 * 1024;

/**
 * Handles the unfurling of a URL by extracting metadata such as title, description, image, and favicon.
 * @param {string} url - The URL to unfurl.
 * @returns {Promise<Result<UnfurledData, UnfurlError>>} - A promise that resolves to an object containing the extracted metadata, or null if an error occurs.
 */
export async function unfurl(url) {
  if (typeof url !== "string" || !safeFetchUrl(url)) {
    return { ok: false, error: "bad-param" };
  }

  // cloudflare has a built-in HTML parser/rewriter called HTMLRewriter. in order to use it, we
  // need to define classes that act as event handlers for certain elements, attributes, etc.
  // see https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/
  const meta$ = new MetaExtractor();
  const title$ = new TextExtractor();
  const icon$ = new IconExtractor();

  try {
    const headers = new Headers();
    for (const contentType of validContentTypes) {
      headers.append("accept", contentType);
    }
    // Some sites block requests that don't have a user agent.
    headers.append(
      "user-agent",
      "Mozilla/5.0 (compatible; YakyardBot/1.0; link preview)"
    );
    // Follow redirects by hand so every hop is checked again.
    let res, u = url;
    for (let hop = 0; ; hop++) {
      if (hop > 4 || !safeFetchUrl(u)) return { ok: false, error: "bad-param" };
      res = await fetch(u, { headers, redirect: "manual" });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, error: "failed-fetch" };
      u = new URL(loc, u).href;
    }
    url = u;
    if (!res.ok || !isValidContentType(res.headers.get("content-type") ?? "")) {
      return { ok: false, error: "failed-fetch" };
    }
    if (res.headers.get("content-type")?.startsWith("image/")) {
      return {
        ok: true,
        value: {
          image: url,
          title: new URL(url).pathname.split("/").pop() || undefined,
        },
      };
    }
    // Read at most 512 KB of the page; the tags we need are near the top.
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    while (got < MAX_HTML) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
    reader.cancel().catch(() => {});
    await new HTMLRewriter()
      .on("meta", meta$)
      .on("title", title$)
      .on("link", icon$)
      .transform(new Response(new Blob(chunks), { headers: res.headers }))
      .blob();
  } catch {
    return { ok: false, error: "failed-fetch" };
  }

  // we don't know exactly what we'll end up with, so this is a best-effort extraction
  const { og, twitter } = meta$;
  const title =
    og["og:title"] ?? twitter["twitter:title"] ?? title$.string ?? undefined;
  const description =
    og["og:description"] ??
    twitter["twitter:description"] ??
    meta$.description ??
    undefined;
  let image =
    og["og:image:secure_url"] ??
    og["og:image"] ??
    twitter["twitter:image"] ??
    undefined;
  let favicon = icon$.appleIcon ?? icon$.icon ?? undefined;

  if (image && !image?.startsWith("http")) {
    image = new URL(image, url).href;
  }
  if (favicon && !favicon?.startsWith("http")) {
    favicon = new URL(favicon, url).href;
  }

  // Prefer the OpenGraph image dimensions, falling back to the Twitter player card dimensions
  // (some providers, e.g. Vimeo, report both; others only one).
  const imageWidth =
    parseDimension(og["og:image:width"]) ??
    parseDimension(twitter["twitter:player:width"]);
  const imageHeight =
    parseDimension(og["og:image:height"]) ??
    parseDimension(twitter["twitter:player:height"]);

  return {
    ok: true,
    value: {
      title,
      description,
      image,
      favicon,
      imageWidth,
      imageHeight,
    },
  };
}

/**
 * Parses an OpenGraph dimension value (a string number of pixels) into a positive number, or
 * returns undefined when it's missing or not a valid positive integer.
 * @param {string|null|undefined} value
 * @returns {number|undefined}
 */
function parseDimension(value) {
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Extracts text from HTML elements.
 */
class TextExtractor {
  /**
   * The accumulated text extracted from elements.
   * @type {string}
   */
  string = "";

  /**
   * Handles an incoming piece of text.
   * @param {Object} param - The text object.
   * @param {string} param.text - The incoming text.
   */
  text({ text }) {
    this.string += text;
  }
}

/**
 * Extracts metadata from HTML elements.
 */
class MetaExtractor {
  /**
   * The Open Graph (og) metadata extracted from elements.
   * @type {Object.<string, string|null>}
   */
  og = {};

  /**
   * The Twitter metadata extracted from elements.
   * @type {Object.<string, string|null>}
   */
  twitter = {};

  /**
   * The description extracted from elements.
   * @type {string|null}
   */
  description = null;

  /**
   * Handles an incoming element.
   * @param {Element} element - The incoming element.
   */
  element(element) {
    const property = element.getAttribute("property");
    const name = element.getAttribute("name");

    if (property && property.startsWith("og:")) {
      this.og[property] = element.getAttribute("content");
    } else if (name && name.startsWith("twitter:")) {
      this.twitter[name] = element.getAttribute("content");
    } else if (name === "description") {
      this.description = element.getAttribute("content");
    }
  }
}

/**
 * Extracts favicon URLs from HTML elements.
 */
class IconExtractor {
  /**
   * The Apple touch icon URL extracted from elements.
   * @type {string|null}
   */
  appleIcon = null;

  /**
   * The favicon URL extracted from elements.
   * @type {string|null}
   */
  icon = null;

  /**
   * Handles an incoming element.
   * @param {Element} element - The incoming element.
   */
  element(element) {
    if (element.getAttribute("rel") === "icon") {
      this.icon = element.getAttribute("href");
    } else if (element.getAttribute("rel") === "apple-touch-icon") {
      this.appleIcon = element.getAttribute("href");
    }
  }
}
