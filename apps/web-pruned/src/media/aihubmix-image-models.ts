// Reference: apps/web/src/media/aihubmix-image-models.ts
import type { MediaModel } from './models';
export type AIHubMixCatalogType = 'image_generation' | 'video' | 'tts';
export async function fetchAIHubMixModels(type?: AIHubMixCatalogType): Promise<MediaModel[]> { return []; }
export function fetchAIHubMixImageModels(config?: any): any { return null; }
export function mergeAihubmixModels(base: MediaModel[], live: MediaModel[]): MediaModel[] { return base; }
export const mergeAihubmixImageModels = mergeAihubmixModels;
export function useAIHubMixModels(type?: AIHubMixCatalogType, enabled?: boolean): MediaModel[] { return []; }
export function useAIHubMixImageModels(enabled?: boolean): MediaModel[] { return []; }
export function useAIHubMixVideoModels(enabled?: boolean): MediaModel[] { return []; }
export function useAIHubMixAudioModels(enabled?: boolean): MediaModel[] { return []; }
export function useByokImageModelOptions(config?: any): any[] { return []; }
export function useByokVideoModelOptions(config?: any): any[] { return []; }
export function useByokSpeechModelOptions(config?: any): any[] { return []; }
