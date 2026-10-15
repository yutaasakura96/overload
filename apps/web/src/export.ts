import type { ExportPage } from '@overload/api-contract';
import { api } from './api';
import { localDate } from './dates';
import { confirmedAccountData, currentAccount } from './query';

// S10's export (docs/07 §2, docs/09 F7): the client pages through every section and builds the
// file in the browser, since one response could pass Vercel's 4.5 MB cap.

const SECTIONS = ['profile', 'exercises', 'routines', 'workouts'] as const;

type Section = (typeof SECTIONS)[number];
type ExportFile = { exportedAt: string } & Record<Section, ExportPage['items'][number][]>;

export function exportAccountIsCurrent(userId: string) {
  const account = currentAccount();
  return account.status === 'confirmed' && account.userId === userId;
}

/** Every section, each read to its last page. `onSection` hears which one is being read. */
export async function readExport(
  userId: string,
  onSection: (index: number) => void,
): Promise<ExportFile> {
  const read = async (section: Section, index: number) => {
    if (!exportAccountIsCurrent(userId)) throw new Error('Export account changed');
    onSection(index);
    const items: ExportPage['items'][number][] = [];
    let cursor: string | undefined;
    do {
      if (!exportAccountIsCurrent(userId)) throw new Error('Export account changed');
      const page = await confirmedAccountData(() =>
        api.GET('/api/me/export', { params: { query: { section, limit: 100, cursor } } }),
      );
      if (!exportAccountIsCurrent(userId)) throw new Error('Export account changed');
      if (page.section !== section) throw new Error('Export answered another section');
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return items;
  };
  const exportedAt = new Date().toISOString();
  return {
    exportedAt,
    profile: await read('profile', 0),
    exercises: await read('exercises', 1),
    routines: await read('routines', 2),
    workouts: await read('workouts', 3),
  };
}

export const SECTION_COUNT = SECTIONS.length;

/** `overload-export-2026-11-04.json`, dated in the user's time zone. */
export const exportFileName = (timeZone: string) =>
  `overload-export-${localDate(Date.now(), timeZone)}.json`;

/** Hands the file to the browser to save. */
export function saveExport(file: ExportFile, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked after the click has been handled, or some browsers save nothing.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
