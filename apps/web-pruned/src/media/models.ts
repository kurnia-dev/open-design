// Reference: apps/web/src/media/models.ts
export type MediaProviderId = string;
export type AudioKind = 'music' | 'speech' | 'sfx';
export type MediaAspect = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
export interface MediaModel { id: string; name: string; label: string; providerId: string; surface: string; [key: string]: any; }
export interface MediaProvider { id: MediaProviderId; name: string; label: string; [key: string]: any; }
export const MEDIA_PROVIDERS: MediaProvider[] = [];
export const IMAGE_MODELS: MediaModel[] = [];
export const VIDEO_MODELS: MediaModel[] = [];
export const AUDIO_MODELS_BY_KIND: Record<AudioKind, MediaModel[]> = { music: [], speech: [], sfx: [] };
export const MEDIA_ASPECTS: MediaAspect[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
export const VIDEO_LENGTHS_SEC: number[] = [3, 5, 8, 10, 15, 30];
export const AUDIO_DURATIONS_SEC: number[] = [5, 10, 15, 30, 60, 120];
export const DEFAULT_IMAGE_MODEL: string = '' as string;
export const DEFAULT_VIDEO_MODEL: string = '' as string;
export const DEFAULT_AUDIO_MODEL: Record<AudioKind, string> = { music: '' as string, speech: '' as string, sfx: '' as string };
export function findMediaModel(id: string): MediaModel | null { return null; }
export function findProvider(id: MediaProviderId): MediaProvider | null { return null; }
export function mediaModelProviderId(id: string): MediaProviderId | undefined { return undefined; }
export function modelIdsBySurface(): { image: string[]; video: string[]; audio: string[] } { return { image: [], video: [], audio: [] }; }
export function groupByProvider(models: MediaModel[]): Array<{ provider: MediaProvider; models: MediaModel[] }> { return []; }
