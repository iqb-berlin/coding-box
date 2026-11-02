const MIB = 1024 * 1024;

// Shared by HTTP uploads, remote bundle downloads and archive validation.
export const RESOURCE_PACKAGE_LIMITS = {
  maxArchiveBytes: 128 * MIB,
  maxEntryBytes: 64 * MIB,
  maxExtractedBytes: 512 * MIB,
  maxEntries: 10_000,
  maxEntryNameBytes: 1024,
  maxPathDepth: 32
};
