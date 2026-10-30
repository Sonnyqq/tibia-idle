import { type AssetRefDto } from '@tibia-idle/contracts';

export type AssetCategory = 'monster' | 'item' | 'equipment' | 'vocation' | 'zone' | 'status';

/**
 * Approved licensed sprite URLs mapped by stable assetId.
 * Remains empty until third-party or commissioned sprites are approved in assets/ASSET_REGISTER.csv.
 */
const LICENSED_SPRITE_REGISTRY: Readonly<Record<string, string>> = {};

export type ResolvedAssetSource =
  | {
      readonly kind: 'sprite';
      readonly assetId: string;
      readonly category: AssetCategory;
      readonly url: string;
    }
  | {
      readonly kind: 'vector';
      readonly assetId: string;
      readonly category: AssetCategory;
      readonly iconKey: string;
    };

export function inferAssetCategory(assetId: string, iconKey: string): AssetCategory {
  if (assetId.startsWith('creature.') || assetId.startsWith('monster.')) return 'monster';
  if (assetId.startsWith('item.')) return 'item';
  if (assetId.startsWith('zone.')) return 'zone';
  if (assetId.startsWith('vocation.')) return 'vocation';
  if (
    [
      'helmet',
      'amulet',
      'weapon',
      'armor',
      'shield',
      'ring',
      'legs',
      'boots',
      'ammunition',
      'chest'
    ].includes(iconKey)
  ) {
    return 'equipment';
  }
  return 'status';
}

export function resolveAssetSource(
  asset?: AssetRefDto,
  fallbackIconKey = 'crest',
  explicitCategory?: AssetCategory
): ResolvedAssetSource {
  const iconKey = asset?.fallbackIconKey ?? fallbackIconKey;
  const category = explicitCategory ?? inferAssetCategory(asset?.assetId ?? '', iconKey);
  const id = asset?.assetId ?? `${category}.${iconKey}`;
  const licensedUrl = LICENSED_SPRITE_REGISTRY[id];
  if (licensedUrl) {
    return { kind: 'sprite', assetId: id, category, url: licensedUrl };
  }
  return {
    kind: 'vector',
    assetId: id,
    category,
    iconKey
  };
}

export interface GameIconProps {
  asset?: AssetRefDto | undefined;
  iconKey?: string | undefined;
  category?: AssetCategory | undefined;
  size?: number | undefined;
}

export function GameIcon({ asset, iconKey = 'crest', category, size = 16 }: GameIconProps) {
  const resolved = resolveAssetSource(asset, iconKey, category);
  if (resolved.kind === 'sprite') {
    return (
      <img
        src={resolved.url}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        data-asset-id={resolved.assetId}
        data-asset-category={resolved.category}
        className="game-icon game-icon-sprite"
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      data-asset-id={resolved.assetId}
      data-asset-category={resolved.category}
      data-icon-key={resolved.iconKey}
      className="game-icon"
    >
      {renderPixelVectorPaths(resolved.iconKey)}
    </svg>
  );
}

function renderPixelVectorPaths(iconKey: string) {
  switch (iconKey) {
    case 'sword':
    case 'swords':
    case 'weapon':
      return (
        <>
          <path d="M11 2h3v3L6 13H3v-3L11 2z" />
          <path d="M2 14l3-3M4 9l3 3" />
        </>
      );
    case 'bow':
    case 'ammunition':
      return (
        <>
          <path d="M3 13C10 13 13 10 13 3" />
          <path d="M3 13L13 3" />
          <path d="M9 3h4v4" />
        </>
      );
    case 'shield':
      return (
        <>
          <path d="M3 3h10v5c0 3.5-5 5.5-5 5.5S3 11.5 3 8V3z" />
          <path d="M8 3v10" />
        </>
      );
    case 'skull':
    case 'bone':
    case 'wraith':
      return (
        <>
          <rect x="3" y="2" width="10" height="8" />
          <path d="M5 10v3h6v-3" />
          <rect x="5" y="5" width="2" height="2" fill="currentColor" />
          <rect x="9" y="5" width="2" height="2" fill="currentColor" />
        </>
      );
    case 'rat':
    case 'beetle':
    case 'drake':
    case 'acolyte':
      return (
        <>
          <polygon points="8 2 14 6 12 13 4 13 2 6 8 2" />
          <rect x="5" y="6" width="2" height="2" fill="currentColor" />
          <rect x="9" y="6" width="2" height="2" fill="currentColor" />
          <path d="M6 10h4" />
        </>
      );
    case 'chest':
      return (
        <>
          <rect x="2" y="4" width="12" height="9" />
          <path d="M2 8h12" />
          <rect x="7" y="7" width="2" height="3" />
        </>
      );
    case 'helmet':
      return (
        <>
          <path d="M3 9V5l5-2 5 2v4H3z" />
          <path d="M3 9v4h3v-3h4v3h3V9" />
        </>
      );
    case 'armor':
      return <path d="M4 3l2 2h4l2-2 2 3-2 2v5H4V8L2 6l2-3z" />;
    case 'legs':
      return <path d="M4 3h8v4l-1 6H8V8H8v5H5L4 7V3z" />;
    case 'boots':
      return <path d="M3 4h4v6h3v3H3V4zm6 0h4v9h-2v-3H9V4z" />;
    case 'ring':
    case 'amulet':
    case 'orb':
    case 'staff':
      return (
        <>
          <rect x="4" y="6" width="8" height="7" />
          <polygon points="8 2 10 4 8 6 6 4 8 2" />
        </>
      );
    case 'coin':
      return (
        <>
          <rect x="3" y="3" width="10" height="10" />
          <path d="M8 5v6M6 8h4" />
        </>
      );
    case 'sewers':
    case 'crypt':
    case 'ridge':
      return (
        <>
          <rect x="2" y="2" width="12" height="12" />
          <path d="M5 14V7l3-2 3 2v7" />
        </>
      );
    default:
      return (
        <>
          <rect x="2" y="2" width="12" height="12" />
          <rect x="6" y="6" width="4" height="4" />
        </>
      );
  }
}
