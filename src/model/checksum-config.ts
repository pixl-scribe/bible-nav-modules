export interface VerseChecksum {
  sid: string;
  checksum: number;
}

export interface ChapterChecksum {
  sid: string;
  checksum: number;
  verseChecksums: VerseChecksum[];
}

export interface BookChecksum {
  bookCode: string;
  checksum: number;
  chapterChecksums: ChapterChecksum[];
}

export interface TestamentChecksum {
  testament: 'OT' | 'NT';
  checksum: number;
  bookChecksums: BookChecksum[];
}

export interface ModuleChecksum {
  checksum: number;
  testamentChecksums: TestamentChecksum[];
}
