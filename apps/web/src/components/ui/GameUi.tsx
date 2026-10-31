import { type AssetRefDto, type DangerTierDto, type ItemRarityDto } from '@tibia-idle/contracts';
import { type SupportedLocale, t } from '@tibia-idle/i18n';
import {
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useState
} from 'react';
import { type AssetCategory, GameIcon } from '../../assets/assetRegistry.js';

export interface GameWindowHeaderProps {
  title: string;
  iconKey?: string | undefined;
  iconCategory?: AssetCategory | undefined;
  collapsible?: boolean | undefined;
  collapsed?: boolean | undefined;
  onToggleCollapse?: (() => void) | undefined;
  minimizeLabel?: string | undefined;
  expandLabel?: string | undefined;
  rightSlot?: ReactNode;
  testId?: string | undefined;
}

export function GameWindowHeader({
  title,
  iconKey,
  iconCategory,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  minimizeLabel = 'Minimize',
  expandLabel = 'Expand',
  rightSlot,
  testId
}: GameWindowHeaderProps) {
  return (
    <div className="game-window-header" data-testid={testId}>
      <div className="game-window-title-group">
        {iconKey && <GameIcon iconKey={iconKey} category={iconCategory} size={14} />}
        <span className="game-window-title">{title}</span>
      </div>
      <div className="game-window-actions">
        {rightSlot}
        {collapsible && onToggleCollapse && (
          <button
            type="button"
            className="game-window-collapse-btn"
            aria-expanded={!collapsed}
            aria-label={collapsed ? expandLabel : minimizeLabel}
            title={collapsed ? expandLabel : minimizeLabel}
            onClick={onToggleCollapse}
          >
            {collapsed ? '+' : '−'}
          </button>
        )}
      </div>
    </div>
  );
}

export interface GameWindowProps {
  title: string;
  iconKey?: string;
  iconCategory?: AssetCategory;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  minimizeLabel?: string;
  expandLabel?: string;
  headerRight?: ReactNode;
  testId?: string;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}

export function GameWindow({
  title,
  iconKey,
  iconCategory,
  collapsible = false,
  defaultCollapsed = false,
  minimizeLabel,
  expandLabel,
  headerRight,
  testId,
  bodyClassName = '',
  className = '',
  children
}: GameWindowProps) {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);

  return (
    <section
      className={`game-window ${collapsed ? 'is-collapsed' : ''} ${className}`.trim()}
      data-testid={testId}
    >
      <GameWindowHeader
        title={title}
        iconKey={iconKey}
        iconCategory={iconCategory}
        collapsible={collapsible}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
        minimizeLabel={minimizeLabel}
        expandLabel={expandLabel}
        rightSlot={headerRight}
      />
      {!collapsed && <div className={`game-window-body ${bodyClassName}`.trim()}>{children}</div>}
    </section>
  );
}

export interface GameButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'tab';
  size?: 'sm' | 'md';
  active?: boolean;
  testId?: string;
}

export function GameButton({
  variant = 'default',
  size = 'md',
  active = false,
  testId,
  className = '',
  type = 'button',
  children,
  ...rest
}: GameButtonProps) {
  return (
    <button
      type={type}
      data-testid={testId}
      aria-pressed={active ? true : rest['aria-pressed']}
      className={`game-btn game-btn-${variant} game-btn-${size} ${active ? 'is-active' : ''} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface ProgressBarProps {
  variant: 'hp' | 'mana' | 'xp' | 'skill';
  percent: number;
  label?: string | undefined;
  valueText?: string | undefined;
  testId?: string | undefined;
}

export function ProgressBar({ variant, percent, label, valueText, testId }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, Math.floor(percent)));
  return (
    <div className="game-progress-group" data-testid={testId}>
      {(label || valueText) && (
        <div className="game-progress-meta">
          {label && <span className="game-progress-label">{label}</span>}
          {valueText && <span className="game-progress-value">{valueText}</span>}
        </div>
      )}
      <div
        className="game-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
      >
        <div
          className={`game-progress-fill game-progress-${variant}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export interface StatRowProps {
  label: string;
  value: ReactNode;
  subBarVariant?: 'hp' | 'mana' | 'xp' | 'skill';
  subBarPercent?: number;
  muted?: boolean;
  highlight?: boolean;
  title?: string;
  testId?: string;
}

export function StatRow({
  label,
  value,
  subBarVariant,
  subBarPercent,
  muted = false,
  highlight = false,
  title,
  testId
}: StatRowProps) {
  return (
    <div
      className={`game-stat-row ${muted ? 'is-muted' : ''} ${highlight ? 'is-highlight' : ''}`.trim()}
      title={title}
      data-testid={testId}
    >
      <div className="game-stat-main">
        <dt className="game-stat-label">{label}</dt>
        <dd className="game-stat-value">{value}</dd>
      </div>
      {subBarVariant !== undefined && subBarPercent !== undefined && (
        <ProgressBar variant={subBarVariant} percent={subBarPercent} />
      )}
    </div>
  );
}

export interface ItemSlotProps {
  slotId: string;
  label: string;
  iconKey?: string | undefined;
  asset?: AssetRefDto | undefined;
  category?: AssetCategory | undefined;
  state?: ('empty' | 'occupied' | 'selected' | 'disabled') | undefined;
  rarity?: ItemRarityDto | undefined;
  stackCount?: number | undefined;
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  testId?: string | undefined;
}

export function ItemSlot({
  slotId,
  label,
  iconKey = 'chest',
  asset,
  category = 'equipment',
  state = 'empty',
  rarity,
  stackCount,
  selected = false,
  disabled = false,
  onSelect,
  testId
}: ItemSlotProps) {
  const effectiveState = disabled
    ? 'disabled'
    : selected
      ? 'selected'
      : state;

  return (
    <button
      type="button"
      data-testid={testId}
      data-slot-id={slotId}
      data-slot-state={effectiveState}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      title={label}
      onClick={onSelect}
      className={`game-item-slot state-${effectiveState} ${rarity ? `rarity-${rarity}` : ''}`.trim()}
    >
      <GameIcon asset={asset} iconKey={iconKey} category={category} size={18} />
      <span className="game-item-slot-caption">{label}</span>
      {typeof stackCount === 'number' && stackCount > 1 && (
        <span className="game-item-slot-stack">{stackCount}</span>
      )}
    </button>
  );
}

export interface MonsterRowProps {
  creatureId: string;
  name: string;
  levelText: string;
  dangerTier: DangerTierDto;
  dangerLabel: string;
  asset?: AssetRefDto;
  selected?: boolean;
  progressPercent?: number;
  progressText?: string;
  onSelect?: () => void;
  testId?: string;
  children?: ReactNode;
}

export function MonsterRow({
  creatureId,
  name,
  levelText,
  dangerTier,
  dangerLabel,
  asset,
  selected = false,
  progressPercent,
  progressText,
  onSelect,
  testId,
  children
}: MonsterRowProps) {
  const interactive = Boolean(onSelect);
  return (
    <div
      data-testid={testId}
      data-creature-id={creatureId}
      className={`game-monster-row ${selected ? 'is-selected' : ''}`.trim()}
    >
      <div className="game-monster-row-header">
        {interactive ? (
          <button
            type="button"
            className="game-monster-select-btn"
            aria-pressed={selected}
            onClick={onSelect}
          >
            <GameIcon asset={asset} iconKey="skull" category="monster" size={18} />
            <span className="game-monster-name">{name}</span>
            <span className="game-monster-level">{levelText}</span>
          </button>
        ) : (
          <div className="game-monster-static">
            <GameIcon asset={asset} iconKey="skull" category="monster" size={18} />
            <span className="game-monster-name">{name}</span>
            <span className="game-monster-level">{levelText}</span>
          </div>
        )}
        <span className={`game-tag game-tag-danger-${dangerTier}`}>{dangerLabel}</span>
      </div>
      {progressPercent !== undefined && (
        <ProgressBar variant="skill" percent={progressPercent} valueText={progressText} />
      )}
      {children && <div className="game-monster-extra">{children}</div>}
    </div>
  );
}

export interface GameTabItem<T extends string = string> {
  readonly id: T;
  readonly label: string;
  readonly iconKey?: string;
  readonly testId?: string;
}

export interface GameTabsProps<T extends string = string> {
  tabs: readonly GameTabItem<T>[];
  activeTab: T;
  onSelectTab: (id: T) => void;
  ariaLabel: string;
  testId?: string;
}

export function GameTabs<T extends string = string>({
  tabs,
  activeTab,
  onSelectTab,
  ariaLabel,
  testId
}: GameTabsProps<T>) {
  return (
    <div className="game-tabs-bar" role="tablist" aria-label={ariaLabel} data-testid={testId}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-testid={tab.testId}
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            className={`game-tab-btn ${isActive ? 'is-active' : ''}`.trim()}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.iconKey && <GameIcon iconKey={tab.iconKey} size={13} />}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface GameTooltipData {
  readonly title: string;
  readonly subtitle?: string;
  readonly description: string;
  readonly source?: string;
  readonly rarityLabel?: string;
}

export interface GameTooltipProps {
  data: GameTooltipData | null;
  closeLabel: string;
  onClose?: () => void;
  testId?: string;
}

export function GameTooltip({ data, closeLabel, onClose, testId }: GameTooltipProps) {
  useEffect(() => {
    if (!data || !onClose) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [data, onClose]);

  if (!data) return null;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && onClose) {
      onClose();
    }
  };

  return (
    <div
      className="game-tooltip-box"
      role="region"
      aria-label={data.title}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid={testId}
    >
      <div className="game-tooltip-header">
        <div>
          <strong className="game-tooltip-title">{data.title}</strong>
          {data.subtitle && <span className="game-tooltip-subtitle"> — {data.subtitle}</span>}
        </div>
        {onClose && (
          <button
            type="button"
            className="game-window-collapse-btn"
            aria-label={closeLabel}
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      {data.rarityLabel && <div className="game-tooltip-meta">{data.rarityLabel}</div>}
      <p className="game-tooltip-desc">{data.description}</p>
      {data.source && <div className="game-tooltip-source">{data.source}</div>}
    </div>
  );
}

export interface GameLogEntry {
  readonly id: string;
  readonly time: string;
  readonly channel: 'system' | 'hunt' | 'loot';
  readonly tone: 'info' | 'warning' | 'Authority';
  readonly text: string;
}

export interface GameLogProps {
  locale: SupportedLocale;
  entries: readonly GameLogEntry[];
  maxEntries?: number;
  testId?: string;
}

export function GameLog({ locale, entries, maxEntries = 25, testId = 'game-log-panel' }: GameLogProps) {
  const [activeChannel, setActiveChannel] = useState<'system' | 'hunt' | 'loot'>('system');
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const visibleEntries = entries
    .filter((entry) => entry.channel === activeChannel)
    .slice(-maxEntries);

  const tabs: readonly GameTabItem<'system' | 'hunt' | 'loot'>[] = [
    { id: 'system', label: t(locale, 'log.tabSystem'), testId: 'log-tab-system' },
    { id: 'hunt', label: t(locale, 'log.tabHunt'), testId: 'log-tab-hunt' },
    { id: 'loot', label: t(locale, 'log.tabLoot'), testId: 'log-tab-loot' }
  ];

  return (
    <section
      className={`game-window game-log-window ${collapsed ? 'is-collapsed' : ''}`.trim()}
      data-testid={testId}
    >
      <div className="game-window-header">
        <div className="game-window-title-group">
          <GameIcon iconKey="crest" size={13} />
          <span className="game-window-title">{t(locale, 'window.console')}</span>
          <GameTabs
            tabs={tabs}
            activeTab={activeChannel}
            onSelectTab={(ch) => {
              setActiveChannel(ch);
              setCollapsed(false);
            }}
            ariaLabel={t(locale, 'window.console')}
            testId="game-log-tabs"
          />
        </div>
        <div className="game-window-actions">
          <button
            type="button"
            className="game-window-collapse-btn"
            data-testid="game-log-collapse-btn"
            aria-expanded={!collapsed}
            aria-label={collapsed ? t(locale, 'window.expand') : t(locale, 'window.minimize')}
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? '+' : '−'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="game-log-body" data-testid="game-log-entries">
          {visibleEntries.length === 0 ? (
            <p className="game-log-empty" data-testid="game-log-empty">
              {activeChannel === 'hunt'
                ? t(locale, 'log.emptyHuntLog')
                : t(locale, 'log.emptyLootLog')}
            </p>
          ) : (
            <ul className="game-log-list">
              {visibleEntries.map((entry) => (
                <li key={entry.id} className={`game-log-line tone-${entry.tone}`}>
                  <span className="game-log-time">[{entry.time}]</span>{' '}
                  <span className="game-log-text">{entry.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
