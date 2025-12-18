export interface Entry {
  path: string;
  offset: bigint;
  length: bigint;
  flags: number;
}

export interface Footer {
  indexOffset: bigint;
  indexLength: bigint;
}

export interface BuildOptions {
  compress?: boolean;
}
