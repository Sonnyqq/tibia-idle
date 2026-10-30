import { type AssetRefDto } from '@tibia-idle/contracts';

/**
 * Approved licensed sprite URLs mapped by assetId.
 * Remains empty until third-party or commissioned sprites are approved in assets/ASSET_REGISTER.csv.
 */
const LICENSED_SPRITE_REGISTRY: Readonly<Record<string, string>> = {};

export type ResolvedAssetSource =
  | { readonly kind: 'sprite'; readonly assetId: string; readonly url: string }
  | { readonly kind: 'vector'; readonly assetId: string; readonly iconKey: string };

export function resolveAssetSource(
  asset?: AssetRefDto,
  fallbackIconKey = 'crest'
): ResolvedAssetSource {
  const id = asset?.assetId ?? `ui.${fallbackIconKey}`;
  const licensedUrl = LICENSED_SPRITE_REGISTRY[id];
  if (licensedUrl) {
    return { kind: 'sprite', assetId: id, url: licensedUrl };
  }
  return {
    kind: 'vector',
    assetId: id,
    iconKey: asset?.fallbackIconKey ?? fallbackIconKey
  };
}

export interface GameIconProps {
  asset?: AssetRefDto;
  iconKey?: string;
  size?: number;
}

export function GameIcon({ asset, iconKey = 'crest', size = 20 }: GameIconProps) {
  const resolved = resolveAssetSource(asset, iconKey);
  if (resolved.kind === 'sprite') {
    return (
      <img
        src={resolved.url}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        data-asset-id={resolved.assetId}
        className="game-icon"
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-asset-id={resolved.assetId}
      data-icon-key={resolved.iconKey}
      className="game-icon"
    >
      {renderVectorPaths(resolved.iconKey)}
    </svg>
  );
}

function renderVectorPaths(iconKey: string) {
  switch (iconKey) {
    case 'sword':
    case 'swords':
    case 'weapon':
      return (
        <>
          <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
          <path d="m13 19 6-6" />
          <path d="m16 16 4 4" />
        </>
      );
    case 'bow':
    case 'ammunition':
      return (
        <>
          <path d="M4 20C14 20 20 14 20 4" />
          <path d="M4 20 20 4" />
          <path d="m6 14 4 4" />
        </>
      );
    case 'shield':
      return <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
    case 'skull':
    case 'bone':
      return (
        <>
          <circle cx="12" cy="10" r="6" />
          <path d="M9 16v3h6v-3" />
          <circle cx="10" cy="10" r="1" />
          <circle cx="14" cy="10" r="1" />
        </>
      );
    case 'chest':
      return (
        <>
          <rect x="3" y="6" width="18" height="14" rx="2" />
          <path d="M3 11h18" />
          <path d="M12 11v3" />
        </>
      );
    case 'helmet':
      return (
        <>
          <path d="M4 14a8 8 0 0 1 16 0v5H4v-5z" />
          <path d="M12 6v8" />
        </>
      );
    case 'armor':
      return <path d="m6 4 3 2h6l3-2 2 5-3 2v9H7v-9L4 9l2-5z" />;
    case 'ring':
    case 'amulet':
    case 'orb':
      return (
        <>
          <circle cx="12" cy="13" r="6" />
          <path d="m10 5 2-2 2 2-2 2-2-2z" />
        </>
      );
    case 'coin':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8" />
        </>
      );
    default:
      return (
        <>
          <polygon points="12 2 19 8 16 20 8 20 5 8 12 2" />
          <circle cx="12" cy="12" r="2" />
        </>
      );
  }
}
