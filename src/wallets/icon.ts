/**
 * Wallet icons announced by browser wallets (EIP-6963 `info.icon`, Wallet Standard `icon`). Both standards
 * require an RFC 2397 data URI; only raster or SVG image data URIs are kept, so an announced icon can
 * never make the dashboard fetch a remote URL (tracking) or load anything but an inert `<img>`. Anything
 * else is dropped and the picker shows a monogram instead.
 */
const IMAGE_DATA_URI = /^data:image\/(?:png|svg\+xml|webp|jpeg|gif)[;,]/i;
/** Upper bound for an icon data URI (wallets ship small SVG/PNG icons; this keeps a hostile one cheap). */
const MAX_ICON_LENGTH = 200_000;

export function safeWalletIcon(icon: unknown): string | undefined {
  if (typeof icon !== "string") return undefined;
  const s = icon.trim();
  return s.length <= MAX_ICON_LENGTH && IMAGE_DATA_URI.test(s) ? s : undefined;
}
