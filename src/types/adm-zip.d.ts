// Minimal type declarations for adm-zip (ships no types). Only the subset used
// by AdmZipExtractor is declared.
declare module "adm-zip" {
  interface IZipEntry {
    entryName: string;
    isDirectory: boolean;
    getData(): Buffer;
  }

  class AdmZip {
    constructor(buffer?: Buffer | string);
    getEntries(): IZipEntry[];
  }

  export = AdmZip;
}
