// Second-level "sub-type" rail for the Home input card.
import type { IconName } from '../Icon';

export type SubChipParentId = 'prototype' | 'deck';

export interface HomeHeroSubChip {
  slug: string;
  label: string;
  icon: IconName;
}

const PARENT_IDS: readonly SubChipParentId[] = ['prototype', 'deck'];

export function subChipsForChip(
  chipId: string | null,
  plugins: any[],
): HomeHeroSubChip[] {
  return [];
}

export function filterPluginsBySubChip(
  plugins: any[],
  parent: SubChipParentId,
  subcategorySlug: string,
): any[] {
  return [];
}

export { PARENT_IDS };
