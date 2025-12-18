export interface Entry {
  path: string;
  offset: bigint;
  length: bigint;
}

export interface Footer {
  indexOffset: bigint;
  indexLength: bigint;
}

export interface BuildOptions {
}
