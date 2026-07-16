export interface TestamentVerseCounts {
  [key: string]: number[];
}

export interface BibleVerseCounts {
  OT: TestamentVerseCounts;
  NT: TestamentVerseCounts;
}
